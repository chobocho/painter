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

export function matchShortcut(e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): ShortcutAction | null {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const ctrl = e.ctrlKey || e.metaKey;
  for (const s of SHORTCUTS) {
    if (s.key !== key) continue;
    if (!!s.shift !== e.shiftKey) continue;
    if (!!s.ctrl !== ctrl) continue;
    if (!!s.alt !== e.altKey) continue;
    return s;
  }
  return null;
}
