export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const Rect = {
  create(x: number, y: number, w: number, h: number): Rect {
    return { x, y, w, h };
  },
  empty(): Rect {
    return { x: 0, y: 0, w: 0, h: 0 };
  },
  isEmpty(r: Rect): boolean {
    return r.w <= 0 || r.h <= 0;
  },
  union(a: Rect, b: Rect): Rect {
    if (Rect.isEmpty(a)) return { ...b };
    if (Rect.isEmpty(b)) return { ...a };
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const x1 = Math.max(a.x + a.w, b.x + b.w);
    const y1 = Math.max(a.y + a.h, b.y + b.h);
    return { x, y, w: x1 - x, h: y1 - y };
  },
  intersect(a: Rect, b: Rect): Rect {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w);
    const y1 = Math.min(a.y + a.h, b.y + b.h);
    if (x1 <= x || y1 <= y) return Rect.empty();
    return { x, y, w: x1 - x, h: y1 - y };
  },
  fromPoints(x0: number, y0: number, x1: number, y1: number): Rect {
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    return { x, y, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  },
  expand(r: Rect, n: number): Rect {
    return { x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n };
  },
  clamp(r: Rect, bounds: Rect): Rect {
    return Rect.intersect(r, bounds);
  },
  contains(r: Rect, x: number, y: number): boolean {
    return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  },
};
