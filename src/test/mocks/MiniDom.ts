// A second-tier DOM mock that's "good enough" to drive UI panels (LayerPanel,
// ProjectPanel, etc.) end-to-end. The earlier `mocks/Dom.ts` was a flat
// element used by the InputAdapter integration tests; this one supports
// parent/child trees, real listener storage, and bubble propagation so we
// can dispatch a click on a deeply-nested input and watch it (or NOT)
// reach an ancestor click handler.

import { MockHTMLCanvasElement } from "./Canvas.js";

export interface MiniEvent {
  type: string;
  target?: MiniElement;
  cancelBubble: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export class MiniMouseEvent implements MiniEvent {
  type: string;
  cancelBubble = false;
  defaultPrevented = false;
  target?: MiniElement;
  constructor(type: string) { this.type = type; }
  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.cancelBubble = true; }
}

type Listener = (ev: MiniEvent) => void;

export class MiniElement {
  tagName: string;
  parentNode: MiniElement | null = null;
  children: MiniElement[] = [];
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  classList: { add: (s: string) => void; remove: (s: string) => void; toggle: (s: string, force?: boolean) => void; contains: (s: string) => boolean };
  dataset: Record<string, string> = {};
  private _className: string = "";
  get className(): string { return this._className; }
  set className(v: string) {
    this._className = v;
    this._classes = new Set(v.split(/\s+/).filter(Boolean));
  }
  textContent: string = "";
  title: string = "";
  type: string = "";
  value: string = "";
  min: string = "";
  max: string = "";
  step: string = "";
  checked: boolean = false;
  disabled: boolean = false;
  readOnly: boolean = false;
  width: number = 0;
  height: number = 0;
  private _innerHTML: string = "";
  private listeners: Map<string, Listener[]> = new Map();
  private _classes: Set<string> = new Set();

  constructor(tag: string = "DIV") {
    this.tagName = tag.toUpperCase();
    this.classList = {
      add: (s) => { this._classes.add(s); this.className = Array.from(this._classes).join(" "); },
      remove: (s) => { this._classes.delete(s); this.className = Array.from(this._classes).join(" "); },
      toggle: (s, force) => {
        const present = this._classes.has(s);
        const next = force === undefined ? !present : force;
        if (next) this._classes.add(s);
        else this._classes.delete(s);
        this.className = Array.from(this._classes).join(" ");
      },
      contains: (s) => this._classes.has(s),
    };
  }

  get innerHTML(): string { return this._innerHTML; }
  set innerHTML(v: string) {
    this._innerHTML = v;
    // Setting innerHTML detaches all children (matches the DOM semantics).
    for (const c of this.children) c.parentNode = null;
    this.children = [];
  }

  appendChild<T extends MiniElement>(c: T): T {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.children.push(c);
    return c;
  }

  removeChild<T extends MiniElement>(c: T): T {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    c.parentNode = null;
    return c;
  }

  setAttribute(k: string, v: string): void { this.attributes[k] = v; }
  getAttribute(k: string): string | null { return this.attributes[k] ?? null; }

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

  dispatchEvent(ev: MiniEvent): boolean {
    if (!ev.target) ev.target = this;
    let node: MiniElement | null = this;
    while (node) {
      const arr = node.listeners.get(ev.type);
      if (arr) {
        for (const fn of arr.slice()) {
          fn.call(node, ev);
          if (ev.cancelBubble) return !ev.defaultPrevented;
        }
      }
      if (ev.cancelBubble) return !ev.defaultPrevented;
      node = node.parentNode;
    }
    return !ev.defaultPrevented;
  }

  // Tree helpers used by tests.
  querySelector(selector: string): MiniElement | null {
    // Very limited: supports `.classname`, `#id`, `tagname`, or
    // ancestor-descendant pairs separated by spaces.
    const parts = selector.trim().split(/\s+/);
    const search = (node: MiniElement, partIdx: number): MiniElement | null => {
      const part = parts[partIdx]!;
      const matches = (n: MiniElement): boolean => {
        if (part.startsWith(".")) return n.classList.contains(part.slice(1));
        if (part.startsWith("#")) return n.attributes["id"] === part.slice(1);
        return n.tagName === part.toUpperCase();
      };
      for (const c of node.children) {
        if (matches(c)) {
          if (partIdx === parts.length - 1) return c;
          const deeper = search(c, partIdx + 1);
          if (deeper) return deeper;
        }
        const deeper = search(c, partIdx);
        if (deeper) return deeper;
      }
      return null;
    };
    return search(this, 0);
  }

  querySelectorAll(selector: string): MiniElement[] {
    const out: MiniElement[] = [];
    const part = selector.startsWith(".") ? selector.slice(1) : selector;
    const isClass = selector.startsWith(".");
    const isId = selector.startsWith("#");
    const visit = (n: MiniElement): void => {
      const ok = isClass
        ? n.classList.contains(part)
        : isId
          ? n.attributes["id"] === selector.slice(1)
          : n.tagName === selector.toUpperCase();
      if (ok) out.push(n);
      for (const c of n.children) visit(c);
    };
    for (const c of this.children) visit(c);
    return out;
  }
}

/**
 * Install a global `document` shim that returns MiniElement for arbitrary
 * tags and a real MockHTMLCanvasElement for "canvas". The DOM tree is
 * accumulated under a single root MiniElement so callers can walk it.
 */
export function installMiniDom(): MiniElement {
  const root = new MiniElement("BODY");
  const g = globalThis as unknown as Record<string, unknown>;
  g["document"] = {
    body: root,
    createElement(tag: string): MiniElement | MockHTMLCanvasElement {
      if (tag === "canvas") return new MockHTMLCanvasElement(300, 150);
      return new MiniElement(tag);
    },
    getElementById(id: string): MiniElement | null {
      return root.querySelector("#" + id);
    },
    addEventListener(_t: string, _f: unknown): void {},
    removeEventListener(_t: string, _f: unknown): void {},
  };
  return root;
}
