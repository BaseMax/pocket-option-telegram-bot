import { describe, expect, it } from 'bun:test';
import {
  decodeFrame,
  parseAssets,
  parseBalance,
  parseClosedDeals,
  parseHistory,
  parseOpenOrderAck,
  parseOpenOrderFailure,
  parseTicks,
} from '../src/pocket/protocol.ts';

describe('decodeFrame', () => {
  it('unwraps JSON delivered as bytes', () => {
    const bytes = new TextEncoder().encode('{"balance":12.5}');
    expect(decodeFrame(bytes)).toEqual({ balance: 12.5 });
  });

  it('passes plain objects through and survives garbage', () => {
    expect(decodeFrame({ a: 1 })).toEqual({ a: 1 });
    expect(decodeFrame(new TextEncoder().encode('not json'))).toBeNull();
  });
});

describe('parseTicks', () => {
  it('reads a batched updateStream frame', () => {
    const ticks = parseTicks([
      ['GBPAUD_otc', 1787911237.51, 1.9532],
      ['GBPAUD_otc', 1787911237.92, 1.9533],
    ]);
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toEqual({ symbol: 'GBPAUD_otc', time: 1787911237.51, price: 1.9532 });
  });

  it('drops malformed entries instead of throwing', () => {
    expect(parseTicks([['X'], null, 5, ['Y', 1, 2]])).toHaveLength(1);
    expect(parseTicks(null)).toEqual([]);
  });
});

describe('parseHistory', () => {
  it('reads and sorts the seed ticks', () => {
    const history = parseHistory({
      asset: 'EURUSD',
      period: 60,
      history: [
        [200, 1.2],
        [100, 1.1],
      ],
    });
    expect(history?.symbol).toBe('EURUSD');
    expect(history?.ticks.map((t) => t.time)).toEqual([100, 200]);
  });

  it('also reads the object form used by loadHistoryPeriod', () => {
    const history = parseHistory({ asset: 'EURUSD', period: 5, data: [{ time: 10, close: 1.5 }] });
    expect(history?.ticks[0]).toEqual({ symbol: 'EURUSD', time: 10, price: 1.5 });
  });
});

describe('order acknowledgements', () => {
  it('reads successopenOrder', () => {
    const ack = parseOpenOrderAck({
      id: 'deal-1',
      requestId: 42,
      asset: 'EURUSD',
      amount: 5,
      openPrice: 1.08,
      openTimestamp: 1787911237,
      closeTimestamp: 1787911297,
    });
    expect(ack?.dealId).toBe('deal-1');
    expect(ack?.requestId).toBe(42);
    expect(ack?.openPrice).toBe(1.08);
  });

  it('returns null when there is no deal id to track', () => {
    expect(parseOpenOrderAck({ requestId: 42 })).toBeNull();
  });

  it('extracts a readable failure message', () => {
    expect(parseOpenOrderFailure({ error: 'insufficient funds', requestId: 7 })).toEqual({
      requestId: 7,
      error: 'insufficient funds',
    });
    expect(parseOpenOrderFailure('boom').error).toBe('boom');
  });
});

describe('parseClosedDeals', () => {
  it('reads the successcloseOrder wrapper', () => {
    const deals = parseClosedDeals({
      profit: 1.8,
      deals: [{ id: 'deal-1', profit: 1.8, asset: 'EURUSD', closePrice: 1.09, closeTimestamp: 1787911297 }],
    });
    expect(deals).toHaveLength(1);
    expect(deals[0]!.dealId).toBe('deal-1');
    expect(deals[0]!.profit).toBe(1.8);
  });

  it('reads the bare array form and keeps zero-profit draws', () => {
    const deals = parseClosedDeals([{ id: 'deal-2', profit: 0 }]);
    expect(deals[0]!.profit).toBe(0);
  });
});

describe('parseBalance and parseAssets', () => {
  it('reads a balance frame', () => {
    expect(parseBalance({ balance: 9876.54 })).toBe(9876.54);
    expect(parseBalance({})).toBeNull();
  });

  it('reads the positional asset rows', () => {
    const assets = parseAssets([[5, '#AAPL', 'Apple', 'stock', 2, 50, 60, 30, 3, 0, 170, 0, [], 1787961600, false]]);
    expect(assets[0]).toEqual({ symbol: '#AAPL', name: 'Apple', payout: 50, isOpen: false });
  });
});
