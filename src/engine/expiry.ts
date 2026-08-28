import { nthCandleCloseTime } from '../util/time.ts';
import type { Order } from '../types.ts';

/**
 * How to ask the broker to close a trade. Exactly one of the two forms is sent: a fixed number of
 * seconds, or an absolute close time on the broker's clock for candle-aligned expiries.
 */
export interface Expiry {
  durationSeconds?: number;
  closeAtServerTime?: number;
  /** When the trade closes, on the broker's clock, whichever form was chosen. */
  brokerCloseTime: number;
  /** Candles the expiry had to skip to clear the broker's minimum trade length. */
  rolledForwardCandles: number;
}

/**
 * Works out when an order should expire, given the moment it fills.
 *
 * A floating expiry lands on a candle close, but a trade that would be shorter than the broker's
 * minimum is refused, so the close rolls forward one candle at a time until it is long enough.
 */
export function resolveExpiry(order: Order, entryTime: number, minDurationSeconds: number): Expiry {
  if (order.expiryMode === 'fixed') {
    return {
      durationSeconds: order.durationSeconds,
      brokerCloseTime: entryTime + order.durationSeconds,
      rolledForwardCandles: 0,
    };
  }

  const target = nthCandleCloseTime(entryTime, order.timeframeSeconds, order.candleCount);
  let close = target;
  while (close - entryTime < minDurationSeconds) close += order.timeframeSeconds;

  return {
    closeAtServerTime: close,
    brokerCloseTime: close,
    rolledForwardCandles: Math.round((close - target) / order.timeframeSeconds),
  };
}
