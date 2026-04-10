import { describe, it, assertEqual } from "./runner.js";
import { matchShortcut } from "../input/Shortcuts.js";

describe("Shortcuts", () => {
  it("matches plain key", () => {
    const r = matchShortcut({ key: "B", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false });
    assertEqual(r?.action, "tool:pencil");
  });
  it("matches ctrl+z = undo", () => {
    const r = matchShortcut({ key: "z", shiftKey: false, ctrlKey: true, metaKey: false, altKey: false });
    assertEqual(r?.action, "history:undo");
  });
  it("matches shift+R = filled rect", () => {
    const r = matchShortcut({ key: "R", shiftKey: true, ctrlKey: false, metaKey: false, altKey: false });
    assertEqual(r?.action, "tool:rect-filled");
  });
  it("returns null for unknown chord", () => {
    const r = matchShortcut({ key: "q", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false });
    assertEqual(r, null);
  });
  it("ctrl+shift+z is also redo", () => {
    const r = matchShortcut({ key: "z", shiftKey: true, ctrlKey: true, metaKey: false, altKey: false });
    assertEqual(r?.action, "history:redo");
  });
});
