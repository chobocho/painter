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

