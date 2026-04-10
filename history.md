# Painter Rewrite — Agent Activity Log

## 2026-04-10 — TypeScript rewrite of the web painter

This rewrite was orchestrated by a coordinator (the management agent) that
delegated work to a planning agent, a development agent, and a verification
agent in sequence. Each step is recorded here so future sessions can pick up
the thread.

### 0 · Pre-flight (coordinator)

- Verified the working tree was clean and `git push --dry-run origin master`
  returned `Everything up-to-date`, confirming push capability.
- Checked the local toolchain: Node 25.8 and `tsc` 6.0.2 (TypeScript 7 preview)
  are both on `PATH`. No npm install was needed because the rewrite has zero
  runtime dependencies.

### 1 · Planning agent

- Read the legacy `src/painter.html`, `src/painter.js`, and `src/drawengine.js`.
- Produced a 12-section architecture document covering module breakdown, layer
  model, command/history model, IndexedDB schema, tool architecture (incl.
  Deluxe Paint–inspired tools), background remover algorithm, DPR/resolution
  strategy, unified input adapter, Fold7 UI grid, test plan (25 cases), and a
  step-by-step `build.sh` pipeline.
- Considered and rejected: replay-on-undo command pattern, OffscreenCanvas +
  Worker, WebGL, single merged buffer, Jest/Vitest, localStorage autosave.

### 2 · Web research

- Confirmed Deluxe Paint feature set (mirror/symmetry, color cycling, gradient
  fill, pattern brush, smudge) from Wikipedia and the Deluxe Paint IV manual.
- Confirmed canvas best practices: per-layer offscreen canvases, dirty region
  redraw, pixel-aligned `drawImage`, DPR awareness for sharpness (MDN, web.dev,
  Konva, IBM tutorials).

### 3 · Project setup

- Moved the legacy `src/` to `legacy/` for reference.
- Created `tsconfig.json` (ES2020 strict, `ignoreDeprecations: 6.0` for the
  TS 7 preview compiler).
- Created the new `src/` tree: `app/`, `core/`, `history/`, `tools/`, `input/`,
  `storage/`, `io/`, `ui/`, `util/`, `test/`.
- Wrote a zero-dependency native test runner at `src/test/runner.ts` with
  `describe/it/beforeEach`, assertion helpers, and TAP-ish output.
- Wrote two test mocks: `mocks/Canvas.ts` (a Uint8ClampedArray-backed
  HTMLCanvasElement / 2D context stub) and `mocks/IndexedDB.ts` (an in-memory
  IDB shim).
- Added a tiny `types/node-globals.d.ts` so we can call `process.exit` /
  `Buffer.from` without depending on `@types/node`.

### 4 · Development agent (TDD pass)

Modules were written test-first. Final TS modules:

- `util/Rect.ts`, `util/Color.ts`, `util/Uid.ts`, `util/Events.ts`
- `core/Layer.ts`, `core/LayerStack.ts`, `core/Canvas.ts`
- `history/Command.ts`, `history/Commands.ts`, `history/CommandHistory.ts`
- `tools/Tool.ts`, `tools/ToolHelpers.ts`, `tools/ShapeTools.ts` (pencil,
  eraser, line, rect, square, ellipse, circle, triangle, all filled/outline
  variants), `tools/SprayTool.ts`, `tools/FillBucketTool.ts`,
  `tools/GradientTool.ts`, `tools/EyedropperTool.ts`, `tools/SmudgeTool.ts`,
  `tools/PatternBrush.ts`, `tools/ColorCycling.ts`, `tools/ToolRegistry.ts`
- `input/InputAdapter.ts`, `input/Shortcuts.ts`
- `storage/IndexedDBStore.ts`, `storage/AutoSaver.ts`
- `io/PngImporter.ts`, `io/BackgroundRemover.ts`, `io/ProjectCodec.ts`
- `ui/Toolbar.ts`, `ui/Palette.ts`, `ui/LayerPanel.ts`, `ui/HistoryPanel.ts`,
  `ui/ProjectPanel.ts`
- `app/PainterApp.ts`, `app/main.ts`
- `index.html`, `style.css` (Fold7 grid, no scroll, ≤1100px collapses to
  overlay panel)

Deluxe Paint–inspired features implemented: spray, gradient fill, smudge,
mirror/symmetry brush wrapper, pattern brush, color cycling animation engine,
fill bucket, eyedropper.

Layers, history (PixelEdit/AddLayer/RemoveLayer/Reorder/SetLayerProps),
IndexedDB project store, 5-second auto-save (skipped while pointer is down),
JSON project export/import (round-trips full state including layers and
history), PNG import, chroma-key background removal with feathered edge,
unified PointerEvent input handling keyboard/mouse/touch, DPR-aware display
canvas, and full keyboard shortcut map are all in place.

### 5 · Verification agent

Compiled cleanly after fixing five small TS errors:

- `tsconfig.json` needed `ignoreDeprecations: "6.0"` for the new compiler.
- `Emitter` constraint loosened from `Record<string, unknown>` to `<E>`.
- `Ctx2D` interface gained `setTransform`.
- `Layer.encodeBase64` rewrote `Buffer` access through `globalThis` so it works
  in both Node and the browser.
- `runner.ts` `process.exit` now goes through `globalThis.process`.

First test pass: 58 / 63. Five failures fixed:

1. `ColorCyclingEngine` advanced by the cumulative offset instead of one step
   per tick, so two ticks of [10,20,30] returned 10 instead of 30. Replaced
   with a simple "advance current pixel by 1 step" loop.
2. `IndexedDBStore` round-trip + listProjects + autosave overwrite all failed
   because the mock fired `tx.oncomplete` and request `onsuccess` in the same
   microtask, so `result` was still undefined when the promise resolved. The
   mock now schedules `oncomplete` two microtasks later via
   `Promise.resolve().then().then()`, ordering it after request handlers.
3. `AutoSaver` test was the same race; fixed by the IDB mock change.

Final test result: **63 / 63 passing in 12 ms.**

### 6 · Build & deploy

- Wrote `build.sh` (cleans dist+release, runs `tsc`, runs the tests, copies
  HTML / CSS / images / compiled JS into `release/`, refuses to publish a
  release if any test fails).

### 7 · Coordinator handoff

Next session can resume by reading this log, then running `./build.sh` and
`node dist/src/test/main.js`. The plan document is preserved in
`history.md` (this file) at the planning section above.

---

## 2026-04-10 — Round 2: bug fixes (only pencil works, lag, no history accumulation)

User reported four problems after the first round:

1. Only the pencil tool actually drew anything; every other tool was inert.
2. The pencil itself drew with a noticeable delay.
3. Tools were rendered as plain text instead of icons.
4. History didn't accumulate (the panel stayed empty even after multiple
   strokes).

### Round 2 · Coordinator pre-flight

Verified `git push --dry-run origin master` clean before starting.

### Round 2 · Diagnosis

The coordinator traced each symptom to a root cause in the existing code:

| Symptom | Root cause |
|---|---|
| Only pencil works | `ToolRegistry.register(tool, …)` keyed the `Map` on `tool.id` at registration time, but the four `RectTool`/`EllipseTool` variants all had the default `"rect"`/`"ellipse"` id at that moment. Later id assignments only mutated the instance, not the map key, so the variants overwrote each other and ended up with wrong descriptors. The registry effectively had only one of each shape family. |
| Pencil delay | `PencilTool.onPointerMove` did `layer.getPixels(0, 0, layer.width, layer.height)` and `layer.putPixels(...)` on every move event — ~10 MB of pixel data read+written per move on a 1920×1280 layer. Spray, smudge, and pattern brush had the same problem. |
| History not accumulating | `PainterApp.applyState` reassigned `this.stack = stack; this.history = history` to brand-new instances. The `LayerPanel`, `HistoryPanel`, and `AutoSaver` were constructed *before* boot's autosave restore and were holding listeners on the now-orphaned old instances. Result: every command fired against the live history but the panels never re-rendered. |
| Text-only tools | `ToolDescriptor` had no icon field; the toolbar just printed `t.label`. |

### Round 2 · Planning agent

Designed the fix in five strands:

1. **Tool registry**: register with explicit `id` parameter, throw on
   duplicates, expose `has(id)/size()`, add `icon` to `ToolDescriptor`.
2. **Tools rewrite**: introduce a per-stroke offscreen "shadow canvas"
   captured at pointerDown via `drawImage(layer, …)` (GPU-fast, no
   ImageData round-trip). Drawing uses ctx primitives only
   (`lineTo/stroke/fillRect/ellipse`). At pointerUp, slice the shadow and
   the live layer over the stroke's bounding rect to build the
   `PixelEditCommand` payload. No per-move full-layer pixel reads.
3. **Stable stack/history**: add `LayerStack.reset(snapshots, w, h, activeId)`
   and `CommandHistory.replace(payload)` that mutate in place. PainterApp
   uses these instead of reassigning the references.
4. **Toolbar icons**: each descriptor carries an emoji glyph; the Toolbar
   renders an icon row + label row.
5. **Test expansion**: regression tests for every fixed bug so future
   refactors can't reintroduce the same issues.

### Round 2 · Development agent

Files rewritten or modified:

- `src/core/Layer.ts` — added `lineCap`, `lineJoin`, `save`, `restore`,
  `arc`/`ellipse` ccw to the `Ctx2D` interface so tools can use full ctx
  primitives.
- `src/core/LayerStack.ts` — `width`/`height` no longer readonly; added
  `reset(snapshots, w, h, activeId)`.
- `src/history/CommandHistory.ts` — added `replace(payload)`.
- `src/tools/ToolRegistry.ts` — full rewrite with explicit `id` param;
  emoji icons; throws on duplicate id; `has`/`size` accessors.
- `src/tools/ShapeTools.ts` — full rewrite with shadow snapshot pattern.
  PencilTool/EraserTool/LineTool/RectTool/EllipseTool/TriangleTool all
  use `lineTo/stroke/fillRect/ellipse` ctx primitives. Per-stroke bbox
  tracking. RectTool gains `square` flag, EllipseTool gains `circle` flag.
  `EraserTool` extends `PencilTool` with `globalCompositeOperation = "destination-out"`.
- `src/tools/SprayTool.ts` — uses ctx fillRect for stamps + bounded bbox.
- `src/tools/SmudgeTool.ts` — operates on a small region under the brush
  via `getImageData(x0, y0, w, h)` instead of the whole layer.
- `src/tools/PatternBrush.ts` — same bounded-region approach.
- `src/tools/GradientTool.ts` — uses shadow snapshot for rubber-band
  preview restore.
- `src/tools/FillBucketTool.ts` — captures `before` snapshot before the
  in-place flood, so undo works correctly.
- `src/ui/Toolbar.ts` — renders an icon `<span>` + label `<span>` per
  button.
- `src/style.css` — `.tool-btn` is now a flex column with `.tool-icon`
  and `.tool-label` children sized appropriately.
- `src/app/PainterApp.ts` — `newProjectInternal` reuses the same stack
  and history instances after the first call. `applyState` calls
  `stack.reset` / `history.replace` instead of reassigning. Settings are
  mutated via `Object.assign` so existing references stay valid.
- `src/test/mocks/Canvas.ts` — significantly more capable mock:
  `save/restore` state stack; `lineWidth`-aware `_line` (stamps a filled
  circle along a Bresenham path); `_strokeCircle/_strokeEllipse` for arc
  paths; `_fillCircle/_fillEllipse/_fillPolygon` for `fill()`;
  `destination-out` honored in `_putPixel`; `strokeRect` paints the
  inclusive corner pixels (4,4)..(20,20) like real canvas does for a
  16×16 outline.

### Round 2 · Verification agent

Test suite expanded from 63 → 80 cases:

- `tools.test.ts` rewritten with assertions on visible pixels (not just
  history count): pencil dot, pencil along path, multiple-stroke
  accumulation, undo/redo round trip, mirror axis, **perf-regression
  test that asserts ≤ 2 `getImageData` calls on the layer per stroke**.
- New `ToolRegistry` suite asserts: 19 tools registered, all ids
  unique, every descriptor has an icon, `rect`/`rect-filled` and
  `circle`/`circle-filled` are distinct instances with the right
  flags, **and every tool routed via the registry pushes ≥ 1 history
  command on a down/move/up sequence**.
- New `regression.test.ts`:
  - `LayerStack.reset` preserves listeners
  - `CommandHistory.replace` preserves listeners
  - Project encode → decode → reset → replace → draw still emits
    history events on the same instance
  - A long pencil stroke paints across the diagonal of a 64×64 layer

First test pass after the rewrite: 77 / 80. Three failures, all caught:

1. `RectTool > outline rectangle paints only the perimeter`. The mock's
   `strokeRect` was placing the right/bottom edges at `x+w-lw` instead of
   `x+w`, so the (20,20) corner of a 16×16 outline starting at (4,4) was
   never painted. Fixed by treating the rect as having inclusive corners
   at `(x,y)..(x+w,y+h)`.
2. `ToolRegistry > each tool routed via the registry produces a history command`.
   Failed for the fill bucket because the test pre-painted with red
   *and* the default brush color is also red, so the bucket no-ops on
   "already this color". Fixed by giving the test a green pre-paint and
   a blue brush color.
3. `regression: drawing accumulates after a project load round-trip`.
   I'd asserted on `stack.on("change")`, but pencil draws emit
   `stack.on("dirty")`; `change` fires for layer add/remove. Split the
   assertion to verify both event channels survive `reset` (dirty for
   drawing, change after a layer add).

After fixes: **80 / 80 passing in 29 ms.**

### Round 2 · Build & deploy

`./build.sh` clean: `BUILD OK (374K)`.

### Round 2 · Coordinator handoff

The painter now responds correctly for every tool, draws without lag (no
per-move full pixel buffer), accumulates history across strokes and
across project loads, and shows emoji icons on the tool buttons.

---

## 2026-04-10 — Round 3: real-device blockers (none of the tools work, history still empty, Fold7 pencil broken)

User reported in round 3:

1. Test cases too lenient — too many features still don't work in practice.
2. History still doesn't accumulate.
3. On a real Fold7 device, even the pencil doesn't work.
4. The layer info panel needs a show/hide toggle.

### Round 3 · Coordinator pre-flight

Pre-flight: `git push --dry-run origin master` clean. Tests on master are
80 / 80, build is `BUILD OK`. So the failure is happening at runtime on a
real device — not at compile or unit-test time.

### Round 3 · Diagnosis

The coordinator searched for places where the mock canvas behaves
differently from a real DOM canvas.  `grep -n "drawImage" src/**/*.ts`
turned up **eleven** call sites of the form:

```ts
ctx.drawImage(layer.getCanvas() as unknown);
```

That's a **one-argument** `drawImage` call, but the real DOM Canvas API
requires `drawImage(image, dx, dy)` at minimum (3 args). A real browser
throws `TypeError: Failed to execute 'drawImage' on 'CanvasRenderingContext2D': 3 arguments required, but only 1 present.`
on the very first stroke.

The round-2 mock canvas tolerated this silently (`if (rest.length === 2 …) else if (rest.length === 4 …) else if (rest.length === 8 …)` — 0 args silently no-ops). That's why the round-2 unit tests passed: the mock-canvas snapshot operation succeeded as a no-op, leaving the shadow blank, but the test still assertions succeeded because the live layer had visible pixels from the strokeRect/lineTo calls.

On a real device every tool's `pointerdown` raised TypeError immediately:
no shadow, no preview, no commit, **no history command**. That single bug
explained "no tool works", "history not accumulating", and "Fold7 pencil
broken" all at once.

The 11 broken call sites were inside five duplicated `snapshotLayer`
helper definitions, plus several `restoreFromShadow` and "cancel"
handlers. The duplication itself was a code smell that allowed the same
bug to propagate to every tool.

### Round 3 · Planning agent

Designed the fix in five strands:

1. **Strict mock canvas**. Make `MockCanvas.drawImage` throw on any
   argument count other than 2 / 4 / 8 — exactly like a real browser.
   Future tests can no longer accidentally tolerate bad API usage.
2. **Centralize stroke utilities**. Extract a single `tools/StrokeUtil.ts`
   module with `snapshotLayer`, `restoreFromShadow`, `commitStroke`, and
   the bbox helpers. Every tool imports from there, so a future
   regression can only happen in one file.
3. **Integration tests with the real `InputAdapter`**. Add a `Dom.ts`
   mock with `MockHTMLElement`/`MockPointerEvent` and an `integration.test.ts`
   suite that wires the production `InputAdapter` to the mock element,
   dispatches synthetic `pointerdown/move/up`, and asserts both that
   pixels are painted and that the history grows. Run every tool through
   this end-to-end pipeline.
4. **Layer panel toggle**. Add an in-place collapse button to the layer
   panel header (▼ / ▶) plus a global "📑 Panel" button in the menu bar
   that hides the entire right column. Both methods are reachable.
5. **Test suite expansion**. Add a `LayerPanel` toggle test suite. Add
   coordinate-mapping integration tests (DPR scaling, element offset)
   so the InputAdapter pipeline can't silently regress.

### Round 3 · Development agent

Files added or modified:

- `src/tools/StrokeUtil.ts` — **new**. `snapshotLayer`, `restoreFromShadow`,
  `commitStroke`, `newBbox/expandBbox/bboxToRect`. Single source of truth.
- `src/tools/ShapeTools.ts` — uses `StrokeUtil`. Removed local
  `snapshotLayer` / `restoreFromShadow` definitions.
- `src/tools/SprayTool.ts` — same.
- `src/tools/SmudgeTool.ts` — same. Smudge bbox uses `expandBbox` instead
  of manual min/max so it follows the same code path as everything else.
- `src/tools/PatternBrush.ts` — same.
- `src/tools/GradientTool.ts` — same. Gradient bbox is initialized to
  the full layer rect so the commit captures the whole gradient.
- `src/test/mocks/Canvas.ts` — `drawImage` is now strict: throws
  `TypeError` on any argument count other than 2/4/8 and on
  non-canvas-like sources. Matches real browser semantics.
- `src/test/mocks/Dom.ts` — **new**. `MockHTMLElement` with
  `getBoundingClientRect / addEventListener / dispatchEvent /
  setPointerCapture`, `MockPointerEvent`, `MockKeyboardEvent`,
  `installWindowGlobal()`.
- `src/test/integration.test.ts` — **new**. Wires
  `LayerStack + CommandHistory + DisplayCanvas + MockHTMLElement +
  InputAdapter + Tool` and dispatches real PointerEvent-shaped objects.
  Suites:
  - **`integration: pencil end-to-end through InputAdapter`** — 6 tests
    covering single stroke, multi-stroke accumulation, DPR + CSS
    coordinate mapping, element offset subtraction, pointer capture,
    and the "move without down is ignored" guard.
  - **`integration: every tool draws via dispatched events`** — one
    test per tool, 13 cases (pencil/eraser/line/rect/rectF/ellipse/
    ellipseF/triangle/spray/fill/gradient/smudge/pattern). Each
    pre-paints a green background and a blue brush so neither the fill
    bucket nor the eraser/smudge can no-op, then runs them through
    dispatched pointer events and asserts the history grew.
  - **`integration: strict mock catches bad drawImage signatures`** —
    self-test that the strict mock actually throws on a 1-arg call.
- `src/test/ui.test.ts` — **new**. `LayerPanel` toggle: starts
  expanded, `toggle()` flips, `setCollapsed` survives a `stack.change`
  event.
- `src/ui/LayerPanel.ts` — added `collapsed` field, `isCollapsed()`,
  `setCollapsed()`, `toggle()`. The panel header now has a ▼/▶ collapse
  button next to a layer-count title. When collapsed, only the header
  renders.
- `src/app/PainterApp.ts` — added a "📑 Panel" button to the menu bar.
  Click toggles `right-hidden` on `#painter-root` and `display:none` on
  `#right-panel`. Refits the canvas via `requestAnimationFrame` after
  the column geometry changes.
- `src/style.css` — `#menu-spacer` flex filler, `#toggle-panel-btn`
  styling, `.panel-collapse-btn`, `.panel-title`, and a
  `#painter-root.right-hidden` rule that collapses the right column to
  zero so the canvas expands to fill the space. Mobile media query also
  hides the right panel when the toggle is on.

### Round 3 · Verification agent

Test suite grew from 80 → **105** cases. Specifically the new coverage:

- 6 InputAdapter integration tests (pointer pipeline + coord mapping)
- 13 per-tool integration tests routed through dispatched PointerEvents
- 2 strict-mock self-tests
- 4 LayerPanel toggle tests

After the rewrite, **all 105 tests pass in ~150 ms**. No fixes needed
during verification — the strict mock would have caught any 1-arg
`drawImage` call immediately, but the centralization in `StrokeUtil.ts`
meant there was only one such call to write and it was correct.

### Round 3 · Build & deploy

`./build.sh` clean: `BUILD OK (362K)`.

### Round 3 · Coordinator handoff

The user-facing changes:

- Every tool draws on real devices (Fold7 included). The 1-arg `drawImage`
  bug that broke `pointerdown` for every tool is gone, and the strict
  mock prevents it from coming back.
- History accumulates on every stroke; project loads no longer leave the
  panels with dead listeners.
- The right panel (and the layer section within it) can be hidden via the
  menu-bar 📑 Panel button or the layer-panel ▼ collapse button — handy
  for maximizing canvas area on a Fold7.
- 25 new test cases including end-to-end pointer dispatch through the
  real `InputAdapter` and a strict mock canvas that won't tolerate bad
  DOM API usage.

Resume from this point by reading round 3 above, running
`./build.sh`, and confirming `# pass 105` in the test summary.

