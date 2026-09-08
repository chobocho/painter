export interface ShortcutAction {
  key: string;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  action: string;
  description: string;
}

export const SHORTCUTS: ShortcutAction[] = [
  { key: "b", action: "tool:pencil", description: "Pencil" },
  { key: "e", action: "tool:eraser", description: "Eraser" },
  { key: "l", action: "tool:line", description: "Line" },
  { key: "r", action: "tool:rect", description: "Rectangle" },
  { key: "r", shift: true, action: "tool:rect-filled", description: "Filled Rectangle" },
  { key: "c", action: "tool:circle", description: "Circle" },
  { key: "c", shift: true, action: "tool:circle-filled", description: "Filled Circle" },
  { key: "f", action: "tool:fill", description: "Fill bucket" },
  { key: "g", action: "tool:gradient", description: "Gradient" },
  { key: "s", action: "tool:spray", description: "Spray" },
  { key: "k", action: "tool:eyedropper", description: "Eyedropper" },
  { key: "u", action: "tool:smudge", description: "Smudge" },
  { key: "p", action: "tool:pattern", description: "Pattern brush" },
  { key: "t", action: "tool:text", description: "Text" },
  { key: "[", action: "brush:dec", description: "Decrease brush size" },
  { key: "]", action: "brush:inc", description: "Increase brush size" },
  { key: "x", action: "color:swap", description: "Swap colors" },
  { key: "z", ctrl: true, action: "history:undo", description: "Undo" },
  { key: "y", ctrl: true, action: "history:redo", description: "Redo" },
  { key: "z", ctrl: true, shift: true, action: "history:redo", description: "Redo" },
  { key: "s", ctrl: true, action: "project:save", description: "Save project" },
  { key: "n", ctrl: true, shift: true, action: "layer:new", description: "New layer" },
  { key: "Delete", action: "layer:clear", description: "Clear layer" },
  { key: "m", action: "tool:mirror-toggle", description: "Toggle mirror" },
];

/**
 * KeyboardEvent.code 를 단축키 문자로 바꾼다.
 * 한글 IME 가 켜져 있으면 e.key 가 "ㅠ"(또는 "Process")로 와서 어떤 단축키도
 * 맞지 않는다. code 는 물리적 키라 IME 와 무관하므로 폴백으로 쓴다.
 */
function keyFromCode(code?: string): string | null {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (code === "BracketLeft") return "[";
  if (code === "BracketRight") return "]";
  if (code === "Delete") return "Delete";
  return null;
}

export function matchShortcut(e: { key: string; code?: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): ShortcutAction | null {
  const ctrl = e.ctrlKey || e.metaKey;
  const find = (key: string | null): ShortcutAction | null => {
    if (key === null) return null;
    for (const s of SHORTCUTS) {
      if (s.key !== key) continue;
      if (!!s.shift !== e.shiftKey) continue;
      if (!!s.ctrl !== ctrl) continue;
      if (!!s.alt !== e.altKey) continue;
      return s;
    }
    return null;
  };
  // e.key 가 먼저다. 영문 입력 상태에서는 지금까지와 완전히 동일하게 동작한다.
  return find(e.key.length === 1 ? e.key.toLowerCase() : e.key) ?? find(keyFromCode(e.code));
}
