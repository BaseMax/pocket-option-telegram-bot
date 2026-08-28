import { describe, expect, it } from 'bun:test';
import { resolveExpiry } from '../src/engine/expiry.ts';
import { candleCloseTime } from '../src/util/time.ts';
import type { Order } from '../src/types.ts';

function order(patch: Partial<Order>): Order {
  return {
    expiryMode: 'floating',
    durationSeconds: 60,
    candleCount: 1,
    timeframeSeconds: 60,
    ...patch,
  } as Order;
}

describe('resolveExpiry', () => {
  it('sends a fixed expiry as a plain duration', () => {
    const expiry = resolveExpiry(order({ expiryMode: 'fixed', durationSeconds: 90 }), 1000, 30);
    expect(expiry).toEqual({ durationSeconds: 90, brokerCloseTime: 1090, rolledForwardCandles: 0 });
  });

  it('sends a floating expiry as the close of the requested candle', () => {
    const entry = 1_787_911_237;
    const expiry = resolveExpiry(order({ candleCount: 1 }), entry, 5);
    expect(expiry.closeAtServerTime).toBe(candleCloseTime(entry, 60));
    expect(expiry.durationSeconds).toBeUndefined();
    expect(expiry.rolledForwardCandles).toBe(0);
  });

  it('counts candleCount candles from the one the fill lands in', () => {
    const entry = 1_787_911_237;
    const expiry = resolveExpiry(order({ candleCount: 3 }), entry, 5);
    expect(expiry.brokerCloseTime).toBe(candleCloseTime(entry, 60) + 120);
  });

  it('rolls forward when the candle would close inside the broker minimum', () => {
    const entry = 1_787_911_255; // 5 seconds before the minute closes
    const expiry = resolveExpiry(order({ candleCount: 1 }), entry, 30);
    expect(expiry.rolledForwardCandles).toBe(1);
    expect(expiry.brokerCloseTime - entry).toBeGreaterThanOrEqual(30);
    expect(expiry.brokerCloseTime).toBe(candleCloseTime(entry, 60) + 60);
  });
});
