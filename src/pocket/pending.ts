/** One in-flight request waiting for the broker to answer. */
interface Pending<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Requests we have sent and not yet heard back about, keyed by request id.
 *
 * The broker answers most frames with the id we sent, but not always; when the id is missing the
 * answer belongs to the oldest request still waiting.
 */
export class PendingRequests<T> {
  private readonly entries = new Map<number, Pending<T>>();

  constructor(
    private readonly timeoutMs: number,
    private readonly timeoutMessage: string,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** Registers a request and returns the promise its answer will settle. */
  add(requestId: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.entries.delete(requestId);
        reject(new Error(this.timeoutMessage));
      }, this.timeoutMs);
      this.entries.set(requestId, { resolve, reject, timer });
    });
  }

  resolve(requestId: number, value: T): void {
    this.take(requestId)?.resolve(value);
  }

  /** For answers that came back without an id. */
  resolveOldest(value: T): void {
    const first = this.entries.keys().next();
    if (!first.done) this.resolve(first.value, value);
  }

  reject(requestId: number, error: Error): void {
    this.take(requestId)?.reject(error);
  }

  rejectAll(error: Error): void {
    for (const requestId of [...this.entries.keys()]) this.reject(requestId, error);
  }

  private take(requestId: number): Pending<T> | undefined {
    const pending = this.entries.get(requestId);
    if (!pending) return undefined;
    clearTimeout(pending.timer);
    this.entries.delete(requestId);
    return pending;
  }
}
