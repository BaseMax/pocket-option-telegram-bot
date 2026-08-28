import { formatDuration } from '../util/time.ts';
import { formatMoney } from './format.ts';
import type { AppConfig } from '../config.ts';
import type { OrderSpec } from '../types.ts';

/** How long the trade will stay open, whichever way its expiry is expressed. */
function effectiveDuration(spec: OrderSpec): number {
  return spec.expiryMode === 'fixed' ? spec.durationSeconds : spec.timeframeSeconds * spec.candleCount;
}

/** Checks an order against the configured guard rails, and says in Persian what is out of bounds. */
export function checkLimits(spec: OrderSpec, limits: AppConfig['limits']): string | null {
  if (spec.amount < limits.minAmount || spec.amount > limits.maxAmount) {
    return `مبلغ باید بین ${formatMoney(limits.minAmount)} و ${formatMoney(limits.maxAmount)} باشد.`;
  }
  const duration = effectiveDuration(spec);
  if (duration < limits.minDurationSeconds) {
    return `مدت معامله نباید کمتر از ${formatDuration(limits.minDurationSeconds)} باشد.`;
  }
  if (duration > limits.maxDurationSeconds) {
    return `مدت معامله نباید بیشتر از ${formatDuration(limits.maxDurationSeconds)} باشد.`;
  }
  return null;
}
