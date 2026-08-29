export type Listener<A extends readonly unknown[]> = (...args: A) => void;

export class Emitter<Events extends Record<string, readonly unknown[]>> {
  private readonly listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    const set = (this.listeners[event] ??= new Set());
    set.add(fn);
    return () => this.off(event, fn);
  }


  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    this.listeners[event]?.delete(fn);
  }

  removeAllListeners(): void {
    for (const key of Object.keys(this.listeners)) {
      delete this.listeners[key as keyof Events];
    }
  }
  protected emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const set = this.listeners[event];
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (error) {
        console.error(`[emitter] listener for "${String(event)}" threw`, error);
      }
    }
  }
}
