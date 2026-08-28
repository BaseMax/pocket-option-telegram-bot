import type { ApproachSide, Order } from '../types.ts';

export function resolveApproachSide(triggerPrice: number, referencePrice: number | null): ApproachSide {
  if (referencePrice === null || !Number.isFinite(referencePrice)) return 'any';
  if (referencePrice < triggerPrice) return 'below';
  if (referencePrice > triggerPrice) return 'above';
  return 'any';
}

export function crossed(previous: number, current: number, target: number): boolean {
  return (previous <= target && current >= target) || (previous >= target && current <= target);
}

export function isTouched(
  order: Pick<Order, 'triggerPrice' | 'approachSide'>,
  previousPrice: number | null,
  price: number,
): boolean {
  const { triggerPrice, approachSide } = order;
  if (approachSide === 'below') return price >= triggerPrice;
  if (approachSide === 'above') return price <= triggerPrice;

  if (price === triggerPrice) return true;
  return previousPrice !== null && crossed(previousPrice, price, triggerPrice);
}

export function describeWaiting(order: Pick<Order, 'triggerPrice' | 'approachSide'>): string {
  switch (order.approachSide) {
    case 'below':
      return `price rising to ${order.triggerPrice}`;
    case 'above':
      return `price falling to ${order.triggerPrice}`;
    default:
      return `price touching ${order.triggerPrice}`;
  }
}
