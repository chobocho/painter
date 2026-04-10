// Tiny zero-dependency event emitter shared by stack/history/settings.

export type Listener<T> = (payload: T) => void;

export class Emitter<E> {
  private listeners: { [K in keyof E]?: Listener<E[K]>[] } = {};

  on<K extends keyof E>(event: K, fn: Listener<E[K]>): () => void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event]!.push(fn);
    return () => this.off(event, fn);
  }

  off<K extends keyof E>(event: K, fn: Listener<E[K]>): void {
    const arr = this.listeners[event];
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const arr = this.listeners[event];
    if (!arr) return;
    for (const fn of arr.slice()) fn(payload);
  }
}
