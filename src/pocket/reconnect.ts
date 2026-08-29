export interface ReconnectOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Consecutive failures against one endpoint before trying the next one. */
  failuresBeforeRotate?: number;
}

const DEFAULTS = {
  minDelayMs: 1_000,
  maxDelayMs: 15_000,
  failuresBeforeRotate: 3,
} as const;

/**
 * How long to wait before the next connection attempt, and which endpoint to try.
 *
 * The delay doubles per consecutive failure up to a ceiling, and every few failures the policy
 * moves to the next endpoint, so a single broken server cannot hold the bot offline.
 */
export class ReconnectPolicy {
  private readonly endpointCount: number;
  private readonly options: Required<ReconnectOptions>;
  private failures = 0;
  private index = 0;

  constructor(endpointCount: number, options: ReconnectOptions = {}) {
    this.endpointCount = Math.max(1, endpointCount);
    this.options = { ...DEFAULTS, ...options };
  }

  /** Index of the endpoint to use for the next attempt. */
  get endpointIndex(): number {
    return this.index;
  }

  get consecutiveFailures(): number {
    return this.failures;
  }

  /** Records a failed attempt and returns how long to wait and whether the endpoint changed. */
  recordFailure(): { delayMs: number; rotated: boolean } {
    this.failures += 1;

    const rotated = this.failures % this.options.failuresBeforeRotate === 0 && this.endpointCount > 1;
    if (rotated) this.index = (this.index + 1) % this.endpointCount;

    const delayMs = Math.min(this.options.minDelayMs * 2 ** (this.failures - 1), this.options.maxDelayMs);
    return { delayMs, rotated };
  }

  /** Called once a connection works, so the next outage starts from a short delay again. */
  reset(): void {
    this.failures = 0;
  }
}
