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

  /**
   * parse 와 같지만 인식하지 못한 입력에 검정 대신 null 을 돌려준다.
   * 사용자가 색을 직접 입력하는 경로(배경 제거 프롬프트 등)는 반드시 이걸 써야
   * 한다. 예전에는 오타를 내면 조용히 검정이 지워졌다.
   */
  tryParse(input: string): RGBA | null {
    const s = input.trim().toLowerCase();
    if (s.length === 0) return null;
    if (s.startsWith("#")) {
      const hex = s.slice(1);
      if (!/^[0-9a-f]+$/.test(hex)) return null;
      const expand = (c: string): number => parseInt(c + c, 16);
      if (hex.length === 3) {
        return { r: expand(hex[0]!), g: expand(hex[1]!), b: expand(hex[2]!), a: 255 };
      }
      if (hex.length === 6 || hex.length === 8) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255,
        };
      }
      return null;
    }
    const m = s.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return null;
    const parts = m[1]!.split(",").map((p) => parseFloat(p.trim()));
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
    return {
      r: Math.round(parts[0]!),
      g: Math.round(parts[1]!),
      b: Math.round(parts[2]!),
      a: parts[3] !== undefined ? Math.round(parts[3]! * 255) : 255,
    };
  },

  /**
   * 허용오차(0~128)를 RGBA 제곱거리 임계값으로 바꾼다.
   * 채우기와 그라디언트가 같은 "허용" 값을 같은 뜻으로 쓰도록 여기 하나로 모았다
   * (예전에는 채우기만 ×3 이라 같은 값이 더 좁게 동작했다). 채널이 4개이므로 ×4.
   */
  toleranceSq(tolerance: number): number {
    return tolerance * tolerance * 4;
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
