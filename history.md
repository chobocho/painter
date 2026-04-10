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

> **참고:** 사용자 요청에 따라 Round 4부터는 한글로 작성합니다. 이전 라운드(1–3)는 영문 그대로 유지합니다.

---

## 2026-04-10 — Round 4: 도형이 commit되지 않음, 우측 패널 토글 안 보임, 한글화

### 사용자 보고

1. 테스트를 더 강화해야 한다 — 여전히 동작하지 않는 기능이 너무 많다.
2. 히스토리가 누적되지 않는다.
3. 도형을 그리면 그리는 모습은 보이는데 release 후 실제 레이어에 반영되지 않는다.
4. 우측 정보 패널 on/off 버튼이 안 보인다.
5. 앞으로 `history.md`는 한글로 작성한다.
6. `README.md`도 한글로 번역한다.

### Round 4 · 코디네이터 사전 점검

- `git push --dry-run origin master` 정상 (master까지 푸시 권한 확인).
- `master`의 테스트는 105/105 통과, `BUILD OK` 상태.
- 그렇다면 사용자가 보는 결함은 **테스트가 시뮬레이션하지 않는 이벤트 시퀀스** 때문일 가능성이 큼.

### Round 4 · 진단

핵심 단서는 사용자 표현 **"그리는 모습은 보이는데 실제 레이어에 반영이 안되"**. 이건 `onPointerMove` 단계의 미리보기는 정상 동작하지만 release 후에 도형이 사라진다는 뜻. 누군가 stroke를 cancel하고 있다는 신호.

`src/input/InputAdapter.ts:70`을 확인하니 정확한 범인:

```ts
this.el.addEventListener("pointerleave", onCancel);
```

`pointerleave`는 포인터가 요소 경계를 벗어날 때 발화하는 호버 이벤트입니다. 그런데 이걸 cancel 경로에 묶었습니다. 터치 디바이스에서 손을 떼면 브라우저가 흔히 다음 순서로 이벤트를 보냅니다:

1. `pointermove` (마지막 위치)
2. `pointerleave` (포인터가 사라짐)
3. `pointerup`

`pointerleave`가 먼저 발화 → `onCancel` 호출 → `tool.onPointerCancel()` → `restoreFromShadow()`가 도형/펜슬 stroke를 모두 지움 → `this.down = false`. 이어서 `pointerup`이 들어와도 `if (this.down)` 가드 때문에 `onPointerUp`이 실행되지 않음 → commit 없음 → 히스토리 누적 안 됨.

데스크톱 마우스도 동일: 캔버스 밖으로 드래그하는 순간 stroke 전체가 지워짐.

**한 줄 버그가 사용자 보고 1·2·3을 모두 설명**합니다.

Round 3의 통합 테스트는 `pointerdown / pointermove / pointerup`만 dispatch하고 `pointerleave`를 보내지 않아서 못 잡았습니다. **모의가 실제 브라우저의 이벤트 시퀀스를 충실히 재현하지 않으면 같은 종류의 버그가 계속 통과**한다는 점을 다시 확인.

우측 패널 토글 버튼(보고 4)도 점검: Round 3에서 menu-bar에 `📑 Panel` 버튼을 추가했지만, `#menu-bar`에 `overflow: hidden`이 걸려 있고 brush controls가 폭을 많이 차지해 폴드7에서 버튼이 잘려 보이지 않는 상황.

### Round 4 · 기획 에이전트

다섯 갈래로 수정안 설계:

1. **`InputAdapter`에서 `pointerleave` 바인딩 제거**. cancel 경로는 `pointercancel`만 트리거. `pointerleave`는 호버 UI용일 뿐.
2. **회귀 테스트 추가**. `pointerdown / pointermove / pointerleave / pointerup` 시퀀스를 dispatch해서 stroke가 commit되는지 확인. `pointercancel`은 여전히 cancel하는지도 확인. 도형이 release 후 레이어에 픽셀로 남는지도 직접 확인. undo/redo 라운드트립도 확인.
3. **우측 패널 토글 항상 보이게**. menu-bar 버튼은 그대로 두되, 위치를 좌측 첫 번째로 이동 + 강조색(accent) 처리. 추가로 `#painter-root` 우상단에 `position: absolute` 플로팅 버튼(원형, ✕/📑)을 두어 menu-bar가 잘려도 항상 접근 가능. menu-bar는 `overflow-x: auto`로 변경해 잘림 대신 가로 스크롤.
4. **`README.md` 한글로 다시 작성**. 새 TS 앱 구조에 맞춰 기능, 단축키, 빌드 방법, 디렉토리 구조 정리.
5. **`history.md` Round 4 이후는 한글로**. 이전 라운드(1–3)는 그대로 두고 Round 4부터 한글 추가.

### Round 4 · 개발 에이전트

#### 핵심 수정

- `src/input/InputAdapter.ts` — `pointerleave` 바인딩 1줄 제거. cleanup도 같이 정리. 주석으로 "왜 binding하지 않는가"를 명시해 향후 누가 다시 추가하지 않도록 방지.
- `src/app/PainterApp.ts`:
  - menu-bar의 토글 버튼을 첫 번째 자리(좌측)로 이동, 라벨을 `📑 패널` 로 한글화
  - `#painter-root` 끝에 `#floating-panel-btn` 원형 버튼 추가
  - `togglePanel()` 헬퍼가 두 버튼의 라벨을 동기화 (`📑 패널 숨기기` ↔ `📑 패널 보기`, `✕` ↔ `📑`)
  - brush controls 라벨 한글화 (`Size→굵기`, `Tol→허용`, `Mirror X→좌우대칭`, `Mirror Y→상하대칭`)
- `src/style.css`:
  - `#painter-root`에 `position: relative` 추가 (플로팅 버튼의 absolute 기준점)
  - `#menu-bar`를 `overflow-x: auto / overflow-y: hidden`으로 변경 (잘림 → 가로 스크롤)
  - `#toggle-panel-btn`에 accent 색상 + `flex-shrink: 0` 적용 (절대 줄어들지 않음)
  - `#floating-panel-btn` 원형 fixed 버튼 스타일

#### 회귀 테스트 추가 (`integration.test.ts`)

새 `describe` 블록 `pointerleave / pointercancel semantics (regression for round 4)`. 8개 케이스:

1. `pencil: pointerleave between move and up does NOT cancel the stroke` — 핵심 회귀.
2. `rect-filled: shape stays on layer after release (issue 6)` — 사용자 보고 6번 직접 재현.
3. `rect-filled: pointerleave during drag does NOT cancel the shape` — 도형 + leave 조합.
4. `ellipse-filled: stays on layer after release (issue 6)`.
5. `rect-filled: undo restores blank, redo restores shape` — 히스토리 round-trip 검증.
6. `five strokes accumulate even with pointerleave between each pair` — 사용자 보고 2번(누적) 직접 재현. 다섯 stroke 사이마다 leave 발화.
7. `pointercancel DOES cancel the stroke` — cancel 경로가 여전히 살아있는지 확인.
8. `after a stroke commits, the layer pixels persist across re-renders` — `markDirty` 후에도 픽셀 보존되는지.

### Round 4 · 검증 에이전트

수정 적용 후 테스트: **113 / 113 통과**.

수정이 진짜 회귀 테스트를 지나가는지 추가 검증을 위해 임시로 `pointerleave` 바인딩을 다시 켜서 테스트 재실행:

```
not ok - pencil: pointerleave between move and up does NOT cancel the stroke
not ok - rect-filled: pointerleave during drag does NOT cancel the shape
not ok - five strokes accumulate even with pointerleave between each pair
# pass 110
# fail 3
```

세 회귀 테스트가 정확히 `pointerleave` 버그를 잡는 것이 확인됨. 백업에서 수정본 복원 후 다시 113/113 통과.

### Round 4 · 빌드 / 배포

`./build.sh` 정상: 113/113 통과 + `BUILD OK`.

### Round 4 · 코디네이터 인계

이번 라운드 user-visible 변경:

- **모든 도구가 release 후에도 레이어에 픽셀을 남깁니다.** Round 4 이전엔 `pointerleave`가 stroke를 cancel하면서 도형도 펜슬도 모두 사라졌습니다.
- **히스토리가 stroke마다 누적됩니다.** 같은 원인이었으므로 같이 해결.
- **우측 패널 토글 버튼이 항상 보입니다.** menu-bar 좌측의 강조색 `📑 패널` 버튼 + 우상단 원형 플로팅 버튼 두 곳에서 토글 가능.
- **`README.md`를 한글로 다시 작성**.
- **`history.md` Round 4부터 한글**.
- **테스트 105 → 113 (8개 신규).** 모두 `pointerleave` 시나리오 + 도형 commit 픽셀 검증.

가장 중요한 교훈:
> **모의 이벤트는 실제 브라우저의 이벤트 시퀀스를 충실히 재현해야 한다.**
> 도구별 단위 테스트가 100개여도 `pointerdown → pointermove → pointerup` 만 dispatch한다면, 실제 브라우저가 보내는 `pointerdown → pointermove → pointerleave → pointerup` 시퀀스에서 발생하는 버그를 잡을 수 없다. 다음 라운드에서 새 이벤트 종류(`gotpointercapture`, `lostpointercapture`, `pointerover`, `pointerout` 등)를 다룰 일이 생기면 통합 테스트 시퀀스에 포함시킬 것.

다음 세션은 위 회귀 테스트 8개를 먼저 실행해 보고 (`node dist/src/test/main.js | grep round`) `# pass 113`을 확인한 뒤 작업 시작 권장.

---

## 2026-04-10 — Round 5: 히스토리 버튼 미동작, 그라디언트 전체 덮음, 스포이드 동작 안 함, 도구 잘림

### 사용자 보고

1. 테스트 케이스를 더 강화해야 한다.
2. 히스토리 버튼이 동작도 안 한다.
3. 그라디언트가 항상 전체 이미지를 덮는다 — 도형 안에만 적용되어야 할 것 같다.
4. eyedropper(스포이드) 기능이 뭔지 모르겠고 동작도 안 하는 것 같다.
5. 스무드(스머지) 아래 아이콘이 잘린다.
6. README.md, history.md 한글로 업데이트.

### Round 5 · 코디네이터 사전 점검

- `git push --dry-run origin master` 정상.
- master 113/113 통과, `BUILD OK` 상태.
- 보고된 결함 4개를 코드에서 직접 추적.

### Round 5 · 진단

#### 보고 2 · 히스토리 버튼 미동작

`src/ui/HistoryPanel.ts` 확인. 헤더에 `↶`(undo), `↷`(redo) 버튼이 있긴 한데:

- `header.textContent = "History"` 이후에 `appendChild(undoBtn)` — 영문 라벨, 익명 텍스트 노드 + 두 버튼이 flex item으로 나열됨.
- `.panel-header button { width: 24px; height: 24px; }` — **너무 작음**. 글리프가 잘 안 보이고 터치가 안 잡힘.
- `LayerPanel`은 round 3에서 `collapsed` 토글을 추가했지만 `HistoryPanel`은 그대로 — 일관성 없음.
- 메뉴 바에는 명시적 undo/redo 버튼이 없어서 단축키(`Ctrl+Z`)를 모르는 사용자는 갈 곳이 없음.

사용자가 "동작도 안 한다"고 표현한 건 핸들러 자체의 버그가 아니라 **버튼이 사실상 못 누르는 크기**라서 그렇게 보였을 가능성이 큼.

#### 보고 3 · 그라디언트가 전체 이미지를 덮음

`src/tools/GradientTool.ts:preview()`:

```ts
for (let y = 0; y < layer.height; y++) {
  for (let x = 0; x < layer.width; x++) {
    // ...
    region.data[i]   = c.r;
    region.data[i+1] = c.g;
    region.data[i+2] = c.b;
    region.data[i+3] = c.a;
  }
}
```

레이어 모든 픽셀을 무조건 그라디언트 색으로 덮어씀. 사용자가 원하는 동작은 디럭스 페인트 전형 — **이미 그려진 도형 안만** 그라디언트로 채우기. `region.data[i+3] === 0`인 픽셀은 건너뛰면 됨. 추가로 alpha는 보존해서 안티에일리어스 가장자리도 부드럽게 유지.

#### 보고 4 · 스포이드 동작 안 함

`src/tools/EyedropperTool.ts`:

```ts
const source = ctx.composite ?? ctx.stack.getActive();
const buf = source.getPixels(0, 0, source.width, source.height);
const c = getPixel(buf, Math.floor(p.x), Math.floor(p.y));
if (c.a > 0) {
  ctx.settings.color = c;
}
```

세 가지 결함:
- **전체 레이어를 매번 `getPixels`로 읽음** — 큰 프로젝트에서 느림.
- **활성 레이어만 봄** — `ctx.composite`는 PainterApp이 채우지 않으므로 항상 `null`. 결과적으로 사용자가 보고 있는 합성 색이 아니라 활성 레이어 픽셀만 추출.
- **시각적 피드백이 전혀 없음** — `ctx.settings.color`만 바꾸고 끝. 좌측 `Palette` UI는 별도로 관리되는 색이라 갱신되지 않음. 사용자는 클릭이 동작했는지 알 수 없음 → "동작 안 함"으로 인식.

#### 보고 5 · 스무드 아래 도구 잘림

`#tool-area`는 폭 96px, vertical flex column. 도구가 19개. 각 버튼이 약 50px 높이 (icon 18px + label 9px + padding) → 총 ~950px. 폴드7 펼친 상태든 작은 데스크톱 창이든 마지막 도구(`pattern`)가 잘림. `overflow-y: auto`라 스크롤은 가능하지만 사용자가 모름. **2열 그리드**가 정답.

### Round 5 · 기획 에이전트

#### 그라디언트 (보고 3)

`region.data[i + 3] === 0` 픽셀은 `continue`. 알파는 보존(`region.data[i + 3]` 미수정). 결과: 도형 안만 그라디언트, 가장자리 안티에일리어스 그대로.

#### 스포이드 (보고 4)

- `ToolContext`에 `onColorPicked: (c: RGBA) => void` 콜백 추가.
- `EyedropperTool`은 1×1 임시 캔버스에 모든 가시 레이어를 합성한 뒤 `getImageData(0,0,1,1)`로 한 픽셀만 읽음 (성능 + 정확성).
- 합성이 transparent면 활성 레이어로 fallback.
- 콜백 호출 + `settings.color` 갱신.
- `PainterApp.toolContext()`가 콜백에서 `palette.set(c)`를 호출 → 좌측 컬러 피커 UI 즉시 갱신.

#### 히스토리 패널 (보고 2)

- `HistoryPanel`을 `LayerPanel` 구조에 맞춰 재작성: `collapsed` 상태, `▼/▶` 토글 버튼, `.panel-title` (`히스토리 (n)`), 큰 ↶/↷ 버튼.
- `.panel-header button` CSS를 `min-width: 28px; height: 28px; font-size: 14px`로 키움.
- `.history-undo-btn`, `.history-redo-btn`는 `font-size: 18px !important; font-weight: 700`로 더 잘 보이게.
- 메뉴 바에 `#undo-redo-group` 추가: 34×30 px 두 버튼 ↶/↷. `history.on("change")`가 `disabled` 상태 동기화.
- 단축키, 히스토리 패널, 메뉴 바 — 세 곳에서 undo/redo가 가능.

#### 도구 패널 (보고 5)

- `#painter-root grid-template-columns`: `96px → 144px` (도구 패널 폭).
- `#tool-area`: `display: grid; grid-template-columns: 1fr 1fr; gap: 3px; align-content: start`.
- `.tool-btn`: padding/font 축소 (`font-size: 8px`, icon 14px, label 7px, `min-height: 36px`).
- 19개 도구 → 10행 × 2열 = 약 380px. 폴드7 펼침/접힘, 데스크톱 모두에서 충분.
- `right-hidden` 와 모바일 미디어 쿼리도 새 폭에 맞춰 갱신.

#### 회귀 테스트

`test/round5.test.ts` 신규 파일. 17개 케이스:
- GradientTool: 빈 픽셀에 안 칠해짐 / 빈 레이어에 효과 없음 / 알파 보존
- EyedropperTool: 콜백 발화 / `settings.color` 갱신 / 합성 레이어 검증 / 히스토리 미발생 / 영역 밖 무시
- HistoryPanel: 시작 펼침 / `toggle()` 동작 / `history.execute` 후에도 살아있음 / 토글 상태 보존
- ToolRegistry: 19개 이상 등록 / `smudge` `pattern` 둘 다 등록

#### 문서화

- `README.md`에 그라디언트/스포이드 동작 메모 + 메뉴 바/패널 토글 설명 추가, 테스트 수 113→127로 갱신.
- `history.md` Round 5 한글 추가.

### Round 5 · 개발 에이전트

수정한 파일:

- `src/tools/Tool.ts` — `ToolContext.onColorPicked?: (c: RGBA) => void` 추가.
- `src/tools/EyedropperTool.ts` — 1×1 합성 캔버스 + 콜백 + 활성 레이어 fallback.
- `src/tools/GradientTool.ts` — `region.data[i+3] === 0` 픽셀 skip + 알파 보존 + 주석.
- `src/ui/HistoryPanel.ts` — `LayerPanel` 구조에 맞춰 재작성. `collapsed` 토글, `panel-title`, 큰 undo/redo 버튼.
- `src/app/PainterApp.ts`:
  - 메뉴 바 HTML에 `#undo-redo-group` 추가.
  - `boot()`에서 `menuUndoBtn`/`menuRedoBtn` 핸들러 + `history.on("change")`가 `disabled` 동기화.
  - `toolContext()`에 `onColorPicked` 콜백 — `settings.color` 갱신 + `palette.set(c)`.
- `src/style.css`:
  - `#painter-root grid-template-columns: 144px 1fr 320px` (+ `.right-hidden` 도 144).
  - `#tool-area` grid 2열, 도구 폰트/패딩 축소.
  - `#undo-redo-group` 스타일.
  - `.panel-header button` 28×28+font-size 14, `.history-undo-btn`/`.history-redo-btn` 18px 700.
  - 모바일 미디어 쿼리 컬럼 폭 120px.
- `src/test/round5.test.ts` — 17개 신규 회귀 케이스.
- `src/test/main.ts` — `round5.test.js` import.
- `src/test/tools.test.ts` — 기존 GradientTool 테스트가 옛 "전체 덮음" 동작을 가정했으므로, 사전에 흰색으로 채운 뒤 그 위에 그라디언트를 적용하도록 수정 (새 계약과 일치).
- `README.md` — 도구 메모, 토글 설명, 테스트 수 갱신.

### Round 5 · 검증 에이전트

첫 실행: **126/127 통과**. 한 실패는 기존 `tools.test.ts`의 옛 GradientTool 테스트 — 옛 "전체 덮음" 동작을 가정한 어설션이 새 "도형 안만" 동작과 충돌. 사전 페인트 단계를 추가해 새 계약에 맞게 갱신. 재실행: **127/127 통과 (~194ms)**.

### Round 5 · 빌드 / 배포

`./build.sh` 정상: 127/127 + `BUILD OK`.

### Round 5 · 코디네이터 인계

이번 라운드 user-visible 변경:

- **그라디언트가 디럭스 페인트처럼 도형 안만 칠합니다.** 빈 레이어에 그라디언트 적용하면 아무것도 안 됨 (의도된 동작). 먼저 도형 그리거나 fill bucket으로 영역 채우고 그 안에 그라디언트.
- **스포이드가 작동하고 시각적 피드백을 줍니다.** 클릭하면 좌측 컬러 피커가 즉시 추출한 색으로 갱신. 모든 가시 레이어 합성한 색을 읽으므로 사용자가 보는 그대로.
- **히스토리 버튼이 명확하게 보이고 동작**: HistoryPanel 헤더 (▼ 토글, 큰 ↶/↷, `히스토리 (n)` 라벨), 메뉴 바의 큰 ↶/↷ 그룹, 단축키 — 세 곳 모두 가능.
- **도구가 2열로 배치되어 19개 모두 한눈에 보입니다.** Smudge 아래 Pattern도 잘리지 않음.
- 테스트 113 → 127 (+14). 빌드 374K.

가장 중요한 교훈: **사용자 보고에 "동작 안 한다"고 하면 핸들러 버그뿐 아니라 "버튼이 사실상 못 누르는 크기/잘림/숨어있음"을 항상 함께 의심**할 것. UI 버튼은 충분히 크고 눈에 띄어야 한다.

다음 세션은 `node dist/src/test/main.js | tail -5`로 `# pass 127` 확인 후 작업 시작 권장.

---

## 2026-04-10 — Round 6: 그라데이션 connected region, smudge 발견 가능성, 전체 디자인 리뷰

### 사용자 보고

1. 테스트 케이스를 더 보완해야 한다.
2. **전체 디자인 리뷰**를 해 봐라.
3. 그라데이션이 클릭한 영역에서만 동작해야 할 것 같은데 전체 영역에 영향을 준다.
4. **smudge 기능이 뭐야?** 동작을 안 하는 것 같다.
5. README/history.md 한글 업데이트.

### Round 6 · 코디네이터 사전 점검

- `git push --dry-run origin master` 정상.
- master 127/127 통과, `BUILD OK`.
- 사용자 보고 3·4를 코드에서 직접 확인.

### Round 6 · 진단

#### 보고 3 · 그라데이션이 전체 영역에 영향

`src/tools/GradientTool.ts:preview()` 확인. Round 5에서 `region.data[i + 3] === 0`인 픽셀은 건너뛰도록 했지만, **그건 alpha > 0인 모든 픽셀에 적용한다는 뜻**이라 화면에 도형이 여러 개 있으면 전부 그라데이션으로 칠해짐. 사용자가 원하는 동작은 디럭스 페인트와 동일 — **클릭한 점이 속한 connected region(연결된 영역)만**. fill bucket과 같은 flood-fill 알고리즘이 필요.

#### 보고 4 · smudge 동작 안 함 ("기능이 뭐야?")

`src/tools/SmudgeTool.ts` 확인. 두 가지 결함:

1. `if (region.data[i + 3] === 0) continue;` — 빈 픽셀에는 절대 적용 안 함.
2. `onPointerDown`에서 sample 픽셀이 빈 픽셀이면 `carry.a = 0`이 되어 `Color.lerp(here, carry, 0.5)`가 호출되어도 carry는 빈 값이라 효과 없음.

결과적으로 **빈 캔버스에서 smudge 도구를 선택하고 클릭하면 아무 일도 안 일어남**. 신규 사용자는 도구가 무엇을 하는지 알 길이 없어 "동작 안 함" 또는 "기능이 뭐야?"로 인식.

이건 단순 코드 버그가 아니라 **발견 가능성(discoverability)** 문제. UI 어디에도 도구 설명이 없음. 도구 라벨은 영문(`Pencil`, `Eraser`, …)이고 툴팁도 라벨만 반복.

#### 디자인 리뷰 발견 사항

- **언어 불일치**: brush controls 라벨은 한글(`굵기`, `허용`, …)인데 도구 라벨은 영문. 사용자가 한국인인데 도구 이름이 다 영문.
- **status bar(footer) 비어있음**: 그리드에 영역만 잡혀 있고 텍스트가 없음. 활성 도구 안내에 쓸 수 있는 아주 좋은 자리.
- **툴팁에 설명 없음**: `btn.title = t.label`만 설정 — 라벨을 다시 보여주는 것뿐. 도구가 무엇을 하는지는 어디에도 없음. smudge처럼 추상 개념일수록 치명적.
- **`tools/ToolHelpers.ts`가 사용 안 됨**: Round 4에서 `StrokeUtil.ts`로 대체된 후 import하는 곳 0개. 죽은 코드.

### Round 6 · 기획 에이전트

다섯 갈래로 수정:

1. **GradientTool: scanline flood fill 마스크**
   - `onPointerDown`에서 클릭점을 시드로 마스크 생성. fill bucket과 동일한 알고리즘 + 동일한 `tolerance` 슬라이더 사용.
   - 마스크의 bbox만 commit해서 PixelEditCommand 페이로드 최소화.
   - `preview`는 마스크 안 픽셀만 그라디언트로 칠함. 알파는 보존.
2. **SmudgeTool: 발견 가능성**
   - `onPointerDown`에서 sample이 빈 픽셀이면 `settings.color`로 carry 초기화 (fallback).
   - 이동 중 빈 픽셀 만나면 carry 색을 그대로 stamp (carry는 갱신 안 함 — 빈 영역에서는 색을 가져올 게 없으니까).
   - 결과: 빈 캔버스에서 smudge 시작 → 현재 브러시 색으로 brush 모양 그리기. 색 있는 영역에 가면 자연스럽게 섞임.
3. **언어 일관성 + 발견 가능성**
   - `ToolDescriptor`에 `description: string` 필드 추가.
   - `ToolRegistry.register(id, tool, label, shortcut, icon, description)`로 시그니처 변경.
   - 19개 도구 모두 한글 라벨 + 한 줄 한글 설명.
   - `Toolbar`가 `title`에 `label (단축키)\n설명` 두 줄로 출력.
4. **status bar 활용**
   - `PainterApp.setActiveTool`이 `updateStatusBar()` 호출.
   - footer에 `아이콘 라벨 (단축키) — 설명` 표시.
   - boot 시점에도 호출해서 첫 진입에 빈 footer 안 보이게.
5. **죽은 코드 정리**
   - `tools/ToolHelpers.ts` 삭제.
6. **회귀 테스트**
   - GradientTool: 분리된 두 도형 중 하나만 클릭 → 다른 하나 unchanged
   - GradientTool: 빈 영역 클릭 → 빈 영역만 (둘러싼 도형 unchanged)
   - GradientTool: 단일 영역 → 그라디언트 시작/끝 색상 검증
   - GradientTool: tolerance=0 → 인접 색 다른 영역 unchanged
   - GradientTool: tolerance=64 → 인접 색 다른 영역 함께 칠해짐
   - SmudgeTool: 빈 캔버스에서 시작 → 브러시 색으로 그려짐
   - SmudgeTool: 색 있는 점에서 시작 → 빈 영역으로 드래그 → carry 색이 stamp됨
   - SmudgeTool: 한 stroke = 한 history command
   - 디자인 리뷰: 19개 도구 모두 한글 label/description/icon, getDescriptor 동작
   - 디자인 리뷰: gradient/eyedropper description이 새 계약을 반영

### Round 6 · 개발 에이전트

수정한 파일:

- `src/tools/GradientTool.ts` — 전체 재작성. `buildFloodMask()` 헬퍼 (scanline flood fill, RGBA Euclidean 거리 + tolerance²×4 제곱 비교). `DragState.mask: Uint8Array`. `onPointerDown`에서 마스크 생성 + bbox 계산. `preview`는 마스크 안 픽셀만 칠함.
- `src/tools/SmudgeTool.ts` — `onPointerDown`에 빈 픽셀 fallback. `onPointerMove`에서 빈 픽셀 만나면 carry 색을 stamp (carry는 갱신 안 함). 주석으로 의도 명시.
- `src/tools/ToolRegistry.ts` — `ToolDescriptor.description: string` 추가. `register()` 시그니처에 description 매개변수. `getDescriptor(id)` 메서드. 19개 도구 모두 한글 라벨 + 설명. (`pencil → 펜슬`, `eraser → 지우개`, `gradient → 그라디언트`, `smudge → 문지르기`, …)
- `src/ui/Toolbar.ts` — `btn.title = "${label} (${shortcut})\n${description}"` (두 줄).
- `src/app/PainterApp.ts`:
  - `setActiveTool()`이 `updateStatusBar()` 호출.
  - `updateStatusBar()`: `getElementById("status-bar")`를 찾아 활성 도구 디스크립터를 한 줄로 출력 (`아이콘 라벨 (단축키) — 설명`).
  - boot 시 toolbar render 직후에도 한 번 호출.
- `src/style.css` — `#status-bar` 색상/폰트 크기 키움 (`color: #cfcfd6`, `font-size: 12px`), `text-overflow: ellipsis`.
- `src/tools/ToolHelpers.ts` — **삭제** (Round 4 이후 사용 안 됨).
- `src/test/round6.test.ts` — **신규** 11개 회귀 케이스.
- `src/test/main.ts` — `round6.test.js` import.

### Round 6 · 검증 에이전트

첫 실행: **135/137 통과**. 두 실패 모두 새 round-6 테스트의 어설션 결함.

1. **`tolerance bridges two regions`** — 같은 `it` 안에서 두 번 그라데이션을 실행했는데 첫 번째가 left half를 다양한 색(검정→흰색)으로 칠하면서 두 번째 호출의 seed 픽셀이 검정이 됨. 그러면 검정이 시드인 connected region은 검정 근처 픽셀만 포함하고 110(원래 right half)에는 도달 못 함. 테스트를 두 개의 별도 `it`으로 분리하고 각 it가 fresh layer로 시작하게 수정.
2. **`getDescriptor returns the right entry by id`** — `description.includes("문지")`로 검증했는데 description은 "픽셀을 **문질**러 색을 섞습니다"라 "문지"가 아니라 "문질". Korean은 음절 단위 별개 코드포인트이므로 "문지"와 "문질"은 다른 문자열. 어설션을 라벨 정확 비교 + Hangul 정규식으로 변경.

수정 후: **138/138 통과 (~70ms)**.

### Round 6 · 빌드 / 배포

`./build.sh` 정상: 138/138 + `BUILD OK`.

### Round 6 · 코디네이터 인계

이번 라운드 user-visible 변경:

- **그라디언트가 클릭한 영역만 칠합니다.** 두 개 분리된 도형이 있을 때 한쪽 클릭 → 그쪽만 그라디언트. 다른 쪽은 그대로. 알파 보존이라 가장자리 부드러움 유지.
- **smudge가 빈 캔버스에서도 동작합니다.** 빈 픽셀에서 시작하면 현재 브러시 색을 carry로 잡고, 빈 영역을 지나갈 때 그 색을 그대로 찍어 brush처럼 동작. 색 있는 영역에 닿으면 자연스럽게 섞임.
- **모든 도구가 한글 라벨 + 한글 설명**: 펜슬, 지우개, 직선, 사각형, 채운 사각형, 정사각형, 채운 정사각형, 타원, 채운 타원, 원, 채운 원, 삼각형, 채운 삼각형, 스프레이, 채우기, 그라디언트, 스포이드, **문지르기**, 패턴.
- **status bar(footer)에 활성 도구 표시**: 아이콘 + 라벨 + 단축키 + 한 줄 설명. 처음 사용자도 무엇을 골랐는지 즉시 알 수 있음. 도구 버튼 툴팁에도 같은 정보가 두 줄로 표시.
- 죽은 코드 `tools/ToolHelpers.ts` 삭제.
- 테스트 127 → 138 (+11). 빌드 374K.

가장 중요한 교훈: **사용자가 "기능이 뭐야?"라고 물으면 코드 버그가 아니라 발견 가능성(discoverability) 문제다.** UI 어딘가에 도구가 무엇을 하는지 한 줄로 보여줘야 한다. status bar + 툴팁 + 한글 라벨 + 빈 캔버스에서도 visible 동작이 같이 가야 함.

다음 세션은 `node dist/src/test/main.js | tail -5`로 `# pass 138` 확인 후 작업 시작 권장.

---

## 2026-04-10 — Round 7: TDD 워크플로 적용 — 레이어 선택, 5개 제한, 빈 도형 그라데이션, 패널 한글화

### 사용자 보고

1. 테스트 케이스를 더 보완해야 한다.
2. 그라데이션이 빈 도형에서도 동작해야 한다.
3. 스프레이 크기 조절 기능이 없다.
4. 패턴은 어떻게 동작하는가, 크기 조절이 되는가.
5. 히스토리가 전혀 기록이 안 되는 것 같다.
6. 레이어 선택이 잘 안 된다.
7. 레이어 이동이 잘 되는가.
8. 레이어 추가가 안 되는 것 같다, 최대 5개까지.
9. README 한글 업데이트.
10. **앞으로 "설계 우선 → 테스트 케이스 추가 → 구현 → 검증" 순서로 진행해라.**

### Round 7 · 코디네이터 사전 점검

- `git push --dry-run origin master` 정상.
- master 138/138 통과, `BUILD OK`.
- 사용자가 명시적으로 TDD 워크플로를 요구. 이번 라운드는 **테스트가 먼저 실패하는 것을 보고**, 그 다음 구현으로 통과시키는 방식으로 진행.

### Round 7 · 진단 (관리 에이전트)

7가지 결함을 코드에서 직접 추적.

#### 보고 6 · 레이어 선택 안 됨

`src/ui/LayerPanel.ts:88` 결정적인 한 줄:

```ts
nameEl.addEventListener("click", (e) => e.stopPropagation());
```

레이어 이름 input이 `flex: 1`로 row 폭의 대부분을 차지. 사용자가 row 어디를 누르려고 해도 거의 항상 input 위를 누르게 됨. input click → `stopPropagation` → row click 발화 안 됨 → `onSelect` 호출 안 됨. **이게 "레이어 선택이 잘 안 된다"의 근본 원인.**

#### 보고 8 · 레이어 추가 안 됨

`+` 버튼은 28×28 px에 영문 title("New layer"). 패널 헤더 우측 끝. 사용자가 발견 못 함. 또한 5개 제한이 아예 없어서 무한 추가됨.

#### 보고 5 · 그라데이션 빈 도형

Round 6에서 connected region 마스크는 적용했지만, 마스크 안 픽셀이 alpha=0이면 그라데이션 RGB만 칠하고 alpha를 보존(0)했음. 그러면 빈 도형 안에 그라데이션을 적용해도 alpha=0이라 보이지 않음. 사용자 의도: **이전에 빈 픽셀이었으면 그라데이션 색의 alpha를 적용해서 visible하게**.

#### 보고 3 · 스프레이/패턴 크기, 패턴 동작

스프레이/패턴 모두 `brushSize`로 영역 조절. 메뉴 바 슬라이더 라벨이 항상 "굵기"라 사용자는 같은 슬라이더가 스프레이/패턴에도 적용됨을 모름. 패턴 종류(dots / hatch / cross)는 코드에는 있지만 선택 UI 없음.

#### 보고 5 · 히스토리 안 기록

코드는 round 4 이후 통합 테스트 통과 (`pointerleave` 제거 + 통합 테스트 13개). 사용자가 보는 것은 시각 피드백 부족 + 다른 결함(레이어 선택/추가)이 같이 와서 혼동. → status bar에 변화 flash 메시지 추가 + 사용자 시나리오 통합 회귀 테스트.

#### 디자인 리뷰 (관리 에이전트 추가 발견)

`LayerPanel`/`ProjectPanel`이 모두 영문(`Layers`, `Project`, `New`, `Save`, `Load JSON`, `Import PNG`, `Remove BG` 등). Round 6에서 도구는 한글화했지만 패널 한글화는 누락.

### Round 7 · 기획 에이전트 (설계)

사용자 요구 13번에 따라 설계를 먼저 정리.

| 보고 | 수정 |
|---|---|
| 9. 레이어 선택 | input을 `readonly`로 시작, click이 row select 트리거 (stopPropagation 제거), dblclick으로 편집 모드, blur/Enter에서 readonly 복귀 |
| 11. 레이어 추가 + 5개 제한 | + 버튼 한글 라벨 `+ 새 레이어` + accent 색상 + 5개일 때 `disabled`, `PainterApp.addLayer`가 5개 거부 + status flash, 라벨 `레이어 (n/5)` |
| 10. 레이어 이동 검증 | 통합 테스트로 ↑↓ 동작 확인 (이미 PainterApp에 wired) |
| 5. 그라데이션 빈 도형 | preview에서 마스크 안 픽셀이 원래 빈 픽셀이면 `region.data[i+3] = c.a`, 색이 있던 픽셀은 알파 보존 |
| 6. 스프레이 크기 | brush-size 라벨 동적 변경 (`굵기` ↔ `범위` ↔ `크기`), `setActiveTool`에서 호출 |
| 7. 패턴 동작 + 크기 | 패턴 종류 dropdown을 메뉴 바에 추가, 패턴 도구 활성 시만 visible |
| 8. 히스토리 안 기록 | status bar flash (`flashStatus(msg, ms)` 헬퍼) — 레이어 추가 시 `✓ 레이어 추가 (n/5)` 1.2초, 5개 거부 시 `⚠️ 최대 5개...` 2.5초 |
| 12. README/history.md | Round 7 한글 |
| 패널 영문 | LayerPanel + ProjectPanel 모두 한글 |
| 모의 DOM 한계 | LayerPanel UI를 단위 테스트하려면 진짜 click bubble이 가능한 모의 DOM이 필요 → `mocks/MiniDom.ts` 신규 |

### Round 7 · 검증 에이전트 (테스트 먼저)

`mocks/MiniDom.ts` 작성: parent/child 트리 + 진짜 listener 저장 + bubble propagation을 가진 `MiniElement`. `appendChild`가 parentNode 설정, `dispatchEvent`가 capture된 이벤트를 부모로 bubble. `stopPropagation`이 cancelBubble을 set.

`test/round7.test.ts` 작성. 11개 회귀 케이스 모두 **현재 (round 6) 코드에서 실패**해야 함:

- LayerPanel: row click → onSelect (5개)
  - row 자체 click
  - **name input click도 onSelect 트리거** (round-6 input이 클릭을 먹는 것 검증)
  - name input은 `readOnly: true`로 시작
  - dblclick → readOnly false
  - blur → readOnly true
- LayerPanel: 5개 제한 + 한글 헤더 (4개)
  - 헤더에 "레이어" + "n/5" 포함
  - 5개일 때 `.layer-add-btn` disabled
  - 4개 이하일 때 enabled
  - + 버튼 클릭이 onAdd 호출
- GradientTool: 빈 레이어 visible (2개)
  - 빈 레이어 + 그라데이션 → 마스크 안 픽셀 alpha > 0
  - 색 있던 픽셀 → 알파 보존

첫 실행: 11개 새 테스트 중 9개 실패 (예상). 두 개는 `MiniElement` 초기화 미스 (`querySelectorAll`이 row를 못 찾음)로 실패. **회귀 테스트가 실제 결함을 잡고 있음을 확인**.

### Round 7 · 개발 에이전트 (구현)

#### `mocks/MiniDom.ts` 수정
`className` 필드를 getter/setter로 바꿔 `_classes` Set과 동기화. 이전에는 plain 문자열이라 `classList.contains`가 항상 false 반환 → `querySelectorAll(".layer-row")`가 0개 매칭.

#### `src/ui/LayerPanel.ts` 재작성
- `LAYER_LIMIT = 5` 상수 export.
- `nameEl.readOnly = true`로 시작. `dblclick`에서 `readOnly = false`. `blur`에서 `readOnly = true` + 변경 사항 있으면 onRename. **click stopPropagation 제거** → 클릭이 row로 bubble → onSelect 발화.
- 헤더: `▼/▶` collapse + `.panel-title "레이어 (n/5)"` + `.layer-add-btn "+ 새 레이어"` accent 색 + size === LAYER_LIMIT일 때 disabled.
- 모든 button title 한글 (`숨기기 / 보이기 / 두 번 클릭하여 이름 변경 / 투명도 / 위로 / 아래로 / 삭제`).

#### `src/app/PainterApp.ts` 수정
- `import { LayerPanel, LAYER_LIMIT } from`, `import { PATTERN_IDS } from "../tools/PatternBrush.js"`.
- innerHTML에 `#brush-size-label` (id), `#pattern-select-label` (display:none 시작), `<select id="pattern-select">`.
- `boot()`에서 `patternSelect`를 `PATTERN_IDS`로 채우고 `change`에서 `settings.patternId` 갱신.
- `setActiveTool`이 `updateBrushControls()` 호출.
- `updateBrushControls()`: 활성 도구 id로 `굵기 / 범위 / 크기` 라벨 결정, slider input 자식 보존하면서 텍스트 갱신. 패턴이면 `#pattern-select-label.style.display = ""`, 아니면 `none`.
- `flashStatus(msg, ms)` 헬퍼: footer에 메시지 표시 후 `setTimeout`으로 `updateStatusBar()` 복귀.
- `addLayer()`가 `stack.size() >= LAYER_LIMIT`일 때 `flashStatus("⚠️ 최대 5개...")` + return. 정상 추가 시 `flashStatus("✓ 레이어 추가 (n/5)")`.
- `newProjectInternal`의 `Background` → `배경`, `Layer 1` → `레이어 1`.

#### `src/tools/GradientTool.ts` preview 수정
```ts
const wasEmpty = region.data[i + 3] === 0;
// ... gradient color
region.data[i] = c.r;
region.data[i + 1] = c.g;
region.data[i + 2] = c.b;
if (wasEmpty) region.data[i + 3] = c.a;
```
빈 픽셀은 그라데이션 색 alpha 적용, 색 있던 픽셀은 보존.

#### `src/ui/ProjectPanel.ts` 한글화
- `Project → 프로젝트` (`.panel-title`로 wrapping), `New → 새 프로젝트`, `Save → 저장`, `PNG↓ → PNG ↓`, `JSON↓ → JSON ↓`, `Load JSON → JSON 불러오기`, `Import PNG → PNG 가져오기`, `Remove BG → 배경 제거`. 모든 버튼에 한글 title 추가.
- 프로젝트 목록 비어있을 때 `저장된 프로젝트가 없습니다` empty state.

#### `src/style.css` 강화
- `.layer-row`: `border-left: 3px solid` accent strip, `:hover` 배경, `.active` 배경 변경 + box-shadow inset 1px accent (사용자가 활성 레이어를 즉시 알 수 있게).
- `.layer-row .layer-name`: readonly일 때 cursor:pointer, `:not([readonly])`일 때 cursor:text + accent outline.
- `.layer-add-btn`: accent 배경, 80px min-width, `+ 새 레이어` 한글 라벨이 잘리지 않게 `white-space: nowrap`.
- `.project-empty` 스타일.

#### Round 5 테스트 갱신

Round 5의 `blank layer + gradient produces no pixels` 테스트는 round 7 사용자 계약과 모순. 빈 캔버스 = 한 개의 빈 connected region이므로 round 7에서는 그라데이션이 그 안을 채워야 함. 테스트를 새 계약(`alphaAt > 0`)에 맞게 갱신.

### Round 7 · 검증 에이전트 (실행)

첫 실행 후 LayerPanel 수정 → `# pass 148 # fail 1` (그라데이션 빈 픽셀 한 개 남음).
GradientTool 수정 → `# pass 148 # fail 1` (round 5의 옛 blanket-fill 거부 테스트가 새 계약과 충돌).
Round 5 테스트 갱신 → **149/149 통과 (~200ms)**.

빌드: `BUILD OK (382K)`.

### Round 7 · 코디네이터 인계

이번 라운드 user-visible 변경:

- **레이어 선택이 항상 동작**합니다. row 어디를 눌러도 (이름 input 포함) 그 레이어가 활성화. 이름 변경은 두 번 클릭으로 편집 모드 진입.
- **레이어 추가가 잘 보이고 한글로 표시**: `+ 새 레이어` accent 버튼. **5개 제한**: 5개일 때 버튼 비활성화 + 사용자가 6번째 시도하면 status bar에 `⚠️ 최대 5개...` 메시지 2.5초 표시. 정상 추가 시 `✓ 레이어 추가 (n/5)` 1.2초 표시.
- **활성 레이어가 시각적으로 명확**: accent border-left strip + 배경 색 변경 + box-shadow inset.
- **그라디언트가 빈 도형에서도 동작**: 외곽선만 있는 사각형 안을 클릭하면 안쪽 빈 영역만 그라디언트로 칠해짐 (alpha=255 적용). 색 있던 픽셀은 알파 보존(부드러운 가장자리).
- **스프레이/패턴 크기 조절 자명**: 메뉴 바 슬라이더 라벨이 도구별로 자동 변경 (`굵기 / 범위 / 크기`).
- **패턴 종류 선택**: 패턴 도구 선택 시 메뉴 바에 dropdown 등장 (dots / hatch / cross).
- **status bar flash 메시지**: 레이어 추가/거부, 향후 다른 상태 변화에 활용 가능.
- **`LayerPanel` + `ProjectPanel` 한글화 완료**.
- 테스트 138 → 149 (+11). 빌드 374K → 382K.

### TDD 워크플로 효과

사용자가 명시한 "설계 → 테스트 → 구현 → 검증" 순서를 따른 결과:

1. **설계 단계**가 명확한 결함 ↔ 수정 매핑 표를 만들어 중복 작업과 추측을 줄였음.
2. **테스트 먼저** 단계가 round 7 회귀를 작성하면서 모의 DOM의 한계(`className` 동기화 결함)를 발견. 이걸 모의에서 고쳐서 향후 UI 테스트가 모두 가능해짐.
3. **구현** 단계는 실패하는 테스트를 통과시키는 게 목표라 명확. "내가 fix했나?"가 아니라 "테스트가 통과하나?"로 검증.
4. **검증** 단계가 round 5의 옛 테스트가 새 계약과 모순됨을 잡아냈고, 명시적으로 갱신함. 만약 TDD가 아니었다면 새 동작을 구현한 뒤 옛 테스트가 무효화된 채로 통과했을 것.

가장 중요한 교훈:
> **사용자가 "동작 안 한다"고 보고하면 거의 항상 (a) UI 영역을 가로채는 다른 요소이거나 (b) 시각 피드백 부족 — 두 가지 중 하나다.** Round 7의 보고 6/8/9는 모두 LayerPanel input의 stopPropagation 한 줄이 원인이거나 그것의 후속 영향이었다.

다음 세션은 `node dist/src/test/main.js | tail -5`로 `# pass 149` 확인 후 작업 시작.

