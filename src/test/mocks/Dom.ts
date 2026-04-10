// Minimal DOM element + event mocks. Only the surface area touched by
// InputAdapter is implemented. Used by integration tests to dispatch
// synthetic PointerEvents at a "canvas element" and verify that the tool
// + history pipeline runs end-to-end.

type Listener = (ev: MockEventLike) => void;

export interface MockEventLike {
  type: string;
  cancelable: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
  target?: unknown;
}

export class MockEvent implements MockEventLike {
  type: string;
  cancelable: boolean = true;
  defaultPrevented: boolean = false;
  target: unknown = null;
  constructor(type: string) { this.type = type; }
  preventDefault(): void { this.defaultPrevented = true; }
}

export class MockPointerEvent extends MockEvent {
  pointerId: number = 1;
  clientX: number;
  clientY: number;
  pressure: number;
  buttons: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  constructor(type: string, init: {
    clientX: number;
    clientY: number;
    pressure?: number;
    buttons?: number;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    pointerId?: number;
  }) {
    super(type);
    this.clientX = init.clientX;
    this.clientY = init.clientY;
    this.pressure = init.pressure ?? 0.5;
    this.buttons = init.buttons ?? 1;
    this.shiftKey = !!init.shiftKey;
    this.ctrlKey = !!init.ctrlKey;
    this.metaKey = !!init.metaKey;
    this.altKey = !!init.altKey;
    this.pointerId = init.pointerId ?? 1;
  }
}

export class MockKeyboardEvent extends MockEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  constructor(type: string, init: { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }) {
    super(type);
    this.key = init.key;
    this.shiftKey = !!init.shiftKey;
    this.ctrlKey = !!init.ctrlKey;
    this.metaKey = !!init.metaKey;
    this.altKey = !!init.altKey;
  }
}

export class MockHTMLElement {
  tagName: string = "DIV";
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  private listeners: Map<string, Listener[]> = new Map();
  capturedPointers: number[] = [];

  constructor(width: number = 0, height: number = 0, left: number = 0, top: number = 0) {
    this.rect = { left, top, right: left + width, bottom: top + height, width, height };
  }

  setRect(left: number, top: number, width: number, height: number): void {
    this.rect = { left, top, right: left + width, bottom: top + height, width, height };
  }

  getBoundingClientRect(): DOMRect {
    return this.rect as unknown as DOMRect;
  }

  addEventListener(type: string, fn: Listener, _opts?: unknown): void {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  dispatchEvent(event: MockEventLike): boolean {
    event.target = this;
    const arr = this.listeners.get(event.type);
    if (!arr) return true;
    for (const fn of arr.slice()) fn.call(this, event);
    return !event.defaultPrevented;
  }

  setPointerCapture(id: number): void { this.capturedPointers.push(id); }
  releasePointerCapture(id: number): void {
    const i = this.capturedPointers.indexOf(id);
    if (i >= 0) this.capturedPointers.splice(i, 1);
  }
  hasPointerCapture(id: number): boolean { return this.capturedPointers.includes(id); }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
}

/**
 * Install a minimal `window` global with `addEventListener`/`removeEventListener`
 * so InputAdapter's keyboard handling code path doesn't crash in Node tests.
 */
export function installWindowGlobal(): MockHTMLElement {
  const win = new MockHTMLElement();
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g["window"]) g["window"] = win as unknown as Window;
  return win;
}
