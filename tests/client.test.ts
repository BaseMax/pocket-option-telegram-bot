import { describe, expect, it } from 'bun:test';
import { PocketOptionClient } from '../src/pocket/client.ts';
import { parseSsid } from '../src/util/ssid.ts';
import { defaultServers } from '../src/pocket/servers.ts';
import type { ClosedDeal } from '../src/pocket/protocol.ts';
import type { Tick } from '../src/types.ts';

function client(): PocketOptionClient {
  const auth = parseSsid(
    '42["auth",{"sessionToken":"tok","uid":"34417524","lang":"fa","currentUrl":"cabinet/demo-quick-high-low","isChart":1}]',
    'demo',
  );
  return new PocketOptionClient({
    mode: 'demo',
    auth,
    servers: defaultServers('demo'),
    serverTimeOffset: 7200,
    label: 'test',
    ackTimeoutMs: 1000,
  });
}

describe('PocketOptionClient frame routing', () => {
  it('treats auth/success as authentication', () => {
    const c = client();
    let authenticated = false;
    c.on('authenticated', () => {
      authenticated = true;
    });
    c.handleEvent('auth/success', []);
    expect(authenticated).toBe(true);
  });

  it('still accepts the legacy successauth event', () => {
    const c = client();
    let authenticated = false;
    c.on('authenticated', () => {
      authenticated = true;
    });
    c.handleEvent('successauth', [{}]);
    expect(authenticated).toBe(true);
  });

  it('infers authentication from account-scoped data', () => {
    const c = client();
    let authenticated = false;
    const balances: number[] = [];
    c.on('authenticated', () => {
      authenticated = true;
    });
    c.on('balance', (value) => balances.push(value));
    c.handleEvent('successupdateBalance', [{ balance: 9876.54 }]);
    expect(authenticated).toBe(true);
    expect(balances).toEqual([9876.54]);
    expect(c.balance).toBe(9876.54);
  });

  it('reports both spellings of an auth rejection', () => {
    for (const event of ['NotAuthorized', 'auth/error']) {
      const c = client();
      const reasons: string[] = [];
      c.on('authFailed', (reason) => reasons.push(reason));
      c.handleEvent(event, []);
      expect(c.isAuthRejected).toBe(true);
      expect(reasons[0]).toContain(event);
      c.handleEvent(event, []);
      expect(reasons).toHaveLength(1);
    }
  });

  it('publishes ticks and remembers the last price per symbol', () => {
    const c = client();
    const ticks: Tick[] = [];
    c.on('tick', (tick) => ticks.push(tick));
    c.handleEvent('updateStream', [
      [
        ['GBPAUD_otc', 1787911237.5, 1.9532],
        ['EURUSD', 1787911237.6, 1.0854],
      ],
    ]);
    expect(ticks).toHaveLength(2);
    expect(c.lastPrice('GBPAUD_otc')?.price).toBe(1.9532);
    expect(c.lastPrice('EURUSD')?.price).toBe(1.0854);
  });

  it('publishes settled deals from successcloseOrder', () => {
    const c = client();
    const deals: ClosedDeal[] = [];
    c.on('dealClosed', (deal) => deals.push(deal));
    c.handleEvent('successcloseOrder', [{ deals: [{ id: 'deal-1', profit: 1.8, closePrice: 1.96 }] }]);
    expect(deals[0]?.dealId).toBe('deal-1');
    expect(deals[0]?.profit).toBe(1.8);
  });

  it('learns the broker clock offset from an order acknowledgement', () => {
    const c = client();
    const openTimestamp = Date.now() / 1000 + 10_800 + 3;
    c.handleEvent('successopenOrder', [{ id: 'deal-1', requestId: 1, openTimestamp }]);
    expect(c.timeOffset).toBe(10_800);
  });

  it('ignores a nonsensical clock offset rather than corrupting expiries', () => {
    const c = client();
    c.handleEvent('successopenOrder', [{ id: 'deal-1', openTimestamp: 1 }]);
    expect(c.timeOffset).toBe(7200);
  });
});
