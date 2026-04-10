export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, RGBA> = {
  red: { r: 255, g: 0, b: 0, a: 255 },
  orange: { r: 255, g: 165, b: 0, a: 255 },
  yellow: { r: 255, g: 255, b: 0, a: 255 },
  green: { r: 0, g: 128, b: 0, a: 255 },
  blue: { r: 0, g: 0, b: 255, a: 255 },
  lightblue: { r: 173, g: 216, b: 230, a: 255 },
  lightgreen: { r: 144, g: 238, b: 144, a: 255 },
  brown: { r: 165, g: 42, b: 42, a: 255 },
  purple: { r: 128, g: 0, b: 128, a: 255 },
  pink: { r: 255, g: 192, b: 203, a: 255 },
  gray: { r: 128, g: 128, b: 128, a: 255 },
  lightgray: { r: 211, g: 211, b: 211, a: 255 },
  black: { r: 0, g: 0, b: 0, a: 255 },
  white: { r: 255, g: 255, b: 255, a: 255 },
};

export const Color = {
  parse(s: string): RGBA {
    if (NAMED[s]) return { ...NAMED[s]! };
    if (s.startsWith("#")) {
      if (s.length === 4) {
        const r = parseInt(s[1]! + s[1]!, 16);
        const g = parseInt(s[2]! + s[2]!, 16);
        const b = parseInt(s[3]! + s[3]!, 16);
        return { r, g, b, a: 255 };
      }
      if (s.length === 7) {
        return {
          r: parseInt(s.slice(1, 3), 16),
          g: parseInt(s.slice(3, 5), 16),
          b: parseInt(s.slice(5, 7), 16),
          a: 255,
        };
      }
      if (s.length === 9) {
        return {
          r: parseInt(s.slice(1, 3), 16),
          g: parseInt(s.slice(3, 5), 16),
          b: parseInt(s.slice(5, 7), 16),
          a: parseInt(s.slice(7, 9), 16),
        };
      }
    }
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1]!.split(",").map((p) => parseFloat(p.trim()));
      return {
        r: Math.round(parts[0] ?? 0),
        g: Math.round(parts[1] ?? 0),
        b: Math.round(parts[2] ?? 0),
        a: parts[3] !== undefined ? Math.round(parts[3]! * 255) : 255,
      };
    }
    return { r: 0, g: 0, b: 0, a: 255 };
  },

  toCss(c: RGBA): string {
    return `rgba(${c.r},${c.g},${c.b},${(c.a / 255).toFixed(3)})`;
  },

  toHex(c: RGBA): string {
    const h = (n: number) => n.toString(16).padStart(2, "0");
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  },

  distanceSq(a: RGBA, b: RGBA): number {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return dr * dr + dg * dg + db * db;
  },

  equals(a: RGBA, b: RGBA): boolean {
    return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
  },

  lerp(a: RGBA, b: RGBA, t: number): RGBA {
    return {
      r: Math.round(a.r + (b.r - a.r) * t),
      g: Math.round(a.g + (b.g - a.g) * t),
      b: Math.round(a.b + (b.b - a.b) * t),
      a: Math.round(a.a + (b.a - a.a) * t),
    };
  },
};
