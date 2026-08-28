/**
 * Waits for the first value a subscription delivers.
 *
 * Every "ask the broker and wait" in this project has the same shape: the value may already be
 * known, otherwise we listen for it, nudge the broker, and give up after a deadline. `onTimeout`
 * decides what a deadline means: return a fallback value, or throw to reject.
 */
export function awaitEvent<T>(options: {
  /** The value we already have, when the wait can be skipped entirely. */
  known?: () => T | null;
  /** Registers the listener and returns its unsubscribe function. */
  subscribe: (deliver: (value: T) => void) => () => void;
  timeoutMs: number;
  onTimeout: () => T;
  /** Sent after subscribing, for values the broker only reports when asked. */
  request?: () => void;
}): Promise<T> {
  const known = options.known?.() ?? null;
  if (known !== null) return Promise.resolve(known);

  return new Promise<T>((resolve, reject) => {
    const finish = (run: () => T): void => {
      clearTimeout(timer);
      off();
      try {
        resolve(run());
      } catch (error) {
        reject(error);
      }
    };

    const timer = setTimeout(() => finish(options.onTimeout), options.timeoutMs);
    const off = options.subscribe((value) => finish(() => value));
    options.request?.();
  });
}
