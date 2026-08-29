import { describe, expect, it } from 'bun:test';
import { ReconnectPolicy } from '../src/pocket/reconnect.ts';

describe('ReconnectPolicy', () => {
  it('backs off exponentially up to the ceiling', () => {
    const policy = new ReconnectPolicy(1, { minDelayMs: 1000, maxDelayMs: 8000 });
    const delays = [1, 2, 3, 4, 5, 6].map(() => policy.recordFailure().delayMs);
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
  });

  it('moves to the next endpoint every few failures and wraps around', () => {
    const policy = new ReconnectPolicy(2, { failuresBeforeRotate: 2 });
    expect(policy.endpointIndex).toBe(0);

    expect(policy.recordFailure().rotated).toBe(false);
    expect(policy.recordFailure().rotated).toBe(true);
    expect(policy.endpointIndex).toBe(1);

    policy.recordFailure();
    policy.recordFailure();
    expect(policy.endpointIndex).toBe(0);
  });

  it('never rotates when there is only one endpoint', () => {
    const policy = new ReconnectPolicy(1, { failuresBeforeRotate: 2 });
    policy.recordFailure();
    policy.recordFailure();
    expect(policy.endpointIndex).toBe(0);
  });

  it('starts over from the shortest delay once a connection works', () => {
    const policy = new ReconnectPolicy(1, { minDelayMs: 1000, maxDelayMs: 8000 });
    policy.recordFailure();
    policy.recordFailure();
    policy.reset();

    expect(policy.consecutiveFailures).toBe(0);
    expect(policy.recordFailure().delayMs).toBe(1000);
  });

  it('keeps the endpoint it rotated to after a reset', () => {
    const policy = new ReconnectPolicy(3, { failuresBeforeRotate: 1 });
    policy.recordFailure();
    policy.reset();
    expect(policy.endpointIndex).toBe(1);
  });
});
