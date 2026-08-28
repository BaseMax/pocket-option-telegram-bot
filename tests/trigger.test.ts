import { describe, expect, it } from 'bun:test';
import { crossed, isTouched, resolveApproachSide } from '../src/engine/trigger.ts';

describe('resolveApproachSide', () => {
  it('reports which way the price must travel', () => {
    expect(resolveApproachSide(1.5, 1.4)).toBe('below');
    expect(resolveApproachSide(1.5, 1.6)).toBe('above');
    expect(resolveApproachSide(1.5, 1.5)).toBe('any');
    expect(resolveApproachSide(1.5, null)).toBe('any');
  });
});

describe('crossed', () => {
  it('detects the target inside the travelled segment, in both directions', () => {
    expect(crossed(1.0, 1.2, 1.1)).toBe(true);
    expect(crossed(1.2, 1.0, 1.1)).toBe(true);
    expect(crossed(1.0, 1.05, 1.1)).toBe(false);
  });
});

describe('isTouched', () => {
  it('fires when a rising market reaches the trigger', () => {
    const order = { triggerPrice: 1.5, approachSide: 'below' as const };
    expect(isTouched(order, 1.49, 1.499)).toBe(false);
    expect(isTouched(order, 1.499, 1.5)).toBe(true);
  });

  it('fires on a gap that jumps straight over the trigger', () => {
    const order = { triggerPrice: 1.5, approachSide: 'below' as const };
    expect(isTouched(order, 1.49, 1.62)).toBe(true);
  });

  it('does not fire on the far side for a directional order', () => {
    const order = { triggerPrice: 1.5, approachSide: 'below' as const };
    expect(isTouched(order, 1.4, 1.3)).toBe(false);
  });

  it('fires when a falling market reaches the trigger', () => {
    const order = { triggerPrice: 1.5, approachSide: 'above' as const };
    expect(isTouched(order, 1.51, 1.505)).toBe(false);
    expect(isTouched(order, 1.505, 1.5)).toBe(true);
    expect(isTouched(order, 1.505, 1.42)).toBe(true);
  });

  it('needs an exact hit or a crossing when no side is known', () => {
    const order = { triggerPrice: 1.5, approachSide: 'any' as const };
    expect(isTouched(order, null, 1.51)).toBe(false);
    expect(isTouched(order, null, 1.5)).toBe(true);
    expect(isTouched(order, 1.49, 1.51)).toBe(true);
  });
});
