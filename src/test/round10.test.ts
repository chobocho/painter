// Round 10: doc/code-review-2026-09-08.md 의 지적 사항에 대한 회귀 테스트.
//
//   * 리뷰 #1 — 채우기가 방문 마스크 없이 "시드 색과의 거리 ≤ 허용오차"만
//     검사하던 탓에, 칠할 색이 시드 색의 허용오차 안에 들어오면 이미 칠한
//     픽셀이 다시 매치되어 스택이 무한히 자랐다. 무한 루프는 테스트가
//     "실패"하는 대신 힙을 터뜨리므로, ImageData 읽기 횟수에 상한을 두는
//     프록시를 씌워 예산 초과를 예외로 바꿔서 검증한다.
//   * 리뷰 #6 — 채우기가 before/after 로 레이어 전체(1920×1280 기준 약
//     20MB)를 히스토리에 넣던 문제. 실제로 바뀐 픽셀의 bbox 만 저장해야 한다.

import { describe, it, assertEqual, assertTrue } from "./runner.js";
import { Layer } from "../core/Layer.js";
import { LayerStack } from "../core/LayerStack.js";
import { CommandHistory } from "../history/CommandHistory.js";
import { defaultSettings, ToolContext } from "../tools/Tool.js";
import { FillBucketTool } from "../tools/FillBucketTool.js";
import { MockHTMLCanvasElement } from "./mocks/Canvas.js";

const factory = (w: number, h: number) => new MockHTMLCanvasElement(w, h) as any;

function bootstrap(size: number): { stack: LayerStack; history: CommandHistory; ctx: ToolContext; layer: Layer } {
  const stack = new LayerStack(size, size, factory);
  const layer = new Layer({ name: "L", width: size, height: size, factory });
  stack.add(layer);
  const preview = new Layer({ name: "P", width: size, height: size, factory });
  const history = new CommandHistory();
  const ctx: ToolContext = { stack, history, settings: defaultSettings(), previewLayer: preview };
  return { stack, history, ctx, layer };
}

const pointer = (x: number, y: number) => ({ x, y, pressure: 1, buttons: 1, shift: false, ctrl: false, alt: false });

/**
 * 레이어 컨텍스트의 getImageData 가 돌려주는 픽셀 배열에 읽기 예산을 건다.
 * 정상적인 스캔라인 채우기는 픽셀당 상수 번만 읽으므로 16×16 에서 수천 번이면
 * 충분하다. 예산을 넘기면 곧 무한 루프라는 뜻이다.
 * O(1) 오버헤드 per read.
 */
function capImageDataReads(layer: Layer, budget: number): void {
  const lctx = layer.getCtx() as any;
  const orig = lctx.getImageData.bind(lctx);
  let reads = 0;
  lctx.getImageData = (x: number, y: number, w: number, h: number) => {
    const img = orig(x, y, w, h);
    const data = new Proxy(img.data, {
      get(t: any, k: any) {
        if (typeof k === "string" && k.length > 0 && k.charCodeAt(0) <= 57) {
          if (++reads > budget) throw new Error(`ImageData read budget exceeded (${budget})`);
        }
        // 메서드는 원본에 바인딩해서 돌려준다. 그렇지 않으면 프록시가 receiver 가
        // 되어 new Uint8ClampedArray(data) 가 "this is not a typed array" 로 죽는다.
        const v = Reflect.get(t, k, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    return { width: img.width, height: img.height, data };
  };
}

describe("리뷰 #1 — 채우기 무한 루프", () => {
  it("칠할 색이 시드 색의 허용오차 안이어도 종료한다", () => {
    const { ctx, layer } = bootstrap(16);
    // 시드 색 (250,250,250) 위에 허용오차 16 으로 흰색을 붓는다.
    const lctx = layer.getCtx();
    lctx.fillStyle = "rgba(250,250,250,1)";
    lctx.fillRect(0, 0, 16, 16);
    ctx.settings.color = { r: 255, g: 255, b: 255, a: 255 };
    ctx.settings.tolerance = 16;

    capImageDataReads(layer, 100000);
    new FillBucketTool().onPointerDown(pointer(8, 8), ctx);

    const px = layer.getPixels(8, 8, 1, 1).data;
    assertEqual(px[0], 255, "채우기 후 흰색이어야 함");
    assertEqual(px[3], 255, "불투명해야 함");
  });

  it("채운 뒤 undo 하면 원래 색으로 돌아온다", () => {
    const { ctx, history, stack, layer } = bootstrap(16);
    const lctx = layer.getCtx();
    lctx.fillStyle = "rgba(250,250,250,1)";
    lctx.fillRect(0, 0, 16, 16);
    ctx.settings.color = { r: 255, g: 255, b: 255, a: 255 };
    ctx.settings.tolerance = 16;

    capImageDataReads(layer, 100000);
    new FillBucketTool().onPointerDown(pointer(8, 8), ctx);
    history.undo({ stack });
    assertEqual(layer.getPixels(8, 8, 1, 1).data[0], 250, "undo 후 250 이어야 함");
  });
});

describe("리뷰 #6 — 채우기 히스토리 크기", () => {
  it("바뀐 영역의 bbox 만 커맨드에 저장한다", () => {
    const { ctx, history, layer } = bootstrap(16);
    const lctx = layer.getCtx();
    lctx.fillStyle = "rgba(255,0,0,1)";
    lctx.fillRect(4, 4, 4, 4);
    ctx.settings.color = { r: 0, g: 0, b: 255, a: 255 };
    ctx.settings.tolerance = 0;

    new FillBucketTool().onPointerDown(pointer(5, 5), ctx);

    const rect = (history.serialize().past[0] as any).data.rect;
    assertTrue(rect.w <= 6 && rect.h <= 6, `rect 가 bbox 여야 함 (실제 ${rect.w}x${rect.h})`);
    assertTrue(rect.w >= 4 && rect.h >= 4, `칠한 영역을 모두 덮어야 함 (실제 ${rect.w}x${rect.h})`);
  });
});

// ---------------------------------------------------------------------------
// 리뷰 #3 — 자동 저장 프로젝트 ID 불일치
//
// autoSaver.start() 는 부팅 시 임시 ID 로 한 번만 불리고 applyState/newProject
// 에서 갱신되지 않았다. 그래서 자동 저장은 임시 ID 로 쌓이고, 복원은
// lastOpenProjectId 의 autosave 를 읽으므로 지난 세션의 옛 상태가 올라왔다.
// 게다가 lastOpenProjectId 는 명시적 저장(Ctrl+S)에서만 기록되어 자동 저장만
// 쓰는 사용자는 복원 자체가 되지 않았다.
// ---------------------------------------------------------------------------

import { IndexedDBStore } from "../storage/IndexedDBStore.js";
import { AutoSaver } from "../storage/AutoSaver.js";
import { MockIndexedDB } from "./mocks/IndexedDB.js";
import * as AppModule from "../app/PainterApp.js";

async function freshStore(): Promise<IndexedDBStore> {
  MockIndexedDB.reset();
  const store = new IndexedDBStore(MockIndexedDB as any);
  await store.open();
  return store;
}

function makeSaver(store: IndexedDBStore, serialize: () => string): AutoSaver {
  const stack = new LayerStack(8, 8, factory);
  stack.add(new Layer({ width: 8, height: 8, factory }));
  return new AutoSaver(store, stack, new CommandHistory(), { intervalMs: 999999, serialize });
}

describe("리뷰 #3 — 자동 저장 프로젝트 ID", () => {
  it("setProjectId 로 바꾼 ID 아래에 저장한다", async () => {
    const store = await freshStore();
    const saver = makeSaver(store, () => '{"version":"1","who":"new"}');
    saver.start("temp-boot-id");

    const setId = (saver as unknown as { setProjectId?: (id: string) => void }).setProjectId;
    assertTrue(typeof setId === "function", "AutoSaver.setProjectId 가 있어야 함");
    setId!.call(saver, "loaded-project");
    await saver.flushNow();
    saver.stop(); // 인터벌을 남기면 테스트 러너가 종료되지 않는다

    assertEqual((await store.getAutoSave("temp-boot-id"))?.projectJson, undefined, "임시 ID 로는 저장되면 안 됨");
    assertTrue((await store.getAutoSave("loaded-project")) !== undefined, "새 ID 로 저장되어야 함");
  });

  it("자동 저장이 lastOpenProjectId 를 갱신한다", async () => {
    const store = await freshStore();
    const saver = makeSaver(store, () => '{"version":"1"}');
    saver.start("p-auto");
    await saver.flushNow();
    saver.stop();
    assertEqual(await store.getMeta("lastOpenProjectId"), "p-auto", "Ctrl+S 없이도 복원 대상이 기록되어야 함");
  });
});

describe("리뷰 #3 — 복원 소스 선택", () => {
  const pick = (AppModule as unknown as {
    pickRestoreJson?: (a?: { savedAt: number; projectJson: string }, p?: { updatedAt: number; projectJson: string }) => string | undefined;
  }).pickRestoreJson;

  it("autosave 와 명시 저장 중 최신본을 고른다", () => {
    assertTrue(typeof pick === "function", "pickRestoreJson 이 있어야 함");
    assertEqual(pick!({ savedAt: 10, projectJson: "AUTO" }, { updatedAt: 5, projectJson: "PROJ" }), "AUTO");
    assertEqual(pick!({ savedAt: 5, projectJson: "AUTO" }, { updatedAt: 10, projectJson: "PROJ" }), "PROJ");
  });

  it("한쪽만 있거나 둘 다 없는 경우를 처리한다", () => {
    assertTrue(typeof pick === "function", "pickRestoreJson 이 있어야 함");
    assertEqual(pick!(undefined, { updatedAt: 1, projectJson: "PROJ" }), "PROJ");
    assertEqual(pick!({ savedAt: 1, projectJson: "AUTO" }, undefined), "AUTO");
    assertEqual(pick!(undefined, undefined), undefined);
  });
});

// ---------------------------------------------------------------------------
// 리뷰 #2 — 삼각형/정사각형/정원 undo 시 픽셀 잔존
//
// 커밋 rect 를 포인터가 지나간 bbox 로만 계산했는데, 삼각형은 제3 꼭짓점이
// x2 = 2*x0 - x1 이고 정사각형/정원은 max(|dx|,|dy|) 로 보정하므로 포인터
// 범위 바깥까지 그린다. 그 바깥 픽셀은 undo 로 지워지지 않고 남았다.
// ---------------------------------------------------------------------------

import { RectTool, EllipseTool, TriangleTool } from "../tools/ShapeTools.js";

/** 레이어에서 알파가 0 이 아닌 픽셀 수. */
function opaqueCount(layer: Layer): number {
  const d = layer.getPixels(0, 0, layer.width, layer.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
  return n;
}

function drawAndUndo(tool: any, size: number, from: [number, number], to: [number, number]): { drawn: number; left: number } {
  const { ctx, history, stack, layer } = bootstrap(size);
  ctx.settings.color = { r: 255, g: 0, b: 0, a: 255 };
  tool.onPointerDown(pointer(from[0], from[1]), ctx);
  tool.onPointerMove(pointer(to[0], to[1]), ctx);
  tool.onPointerUp(pointer(to[0], to[1]), ctx);
  const drawn = opaqueCount(layer);
  history.undo({ stack });
  return { drawn, left: opaqueCount(layer) };
}

describe("리뷰 #2 — 도형 undo 잔존 픽셀", () => {
  it("삼각형은 제3 꼭짓점까지 undo 된다", () => {
    // 오른쪽으로 끌면 제3 꼭짓점은 시작점 왼쪽(x2 = 2*x0 - x1)에 생긴다.
    const r = drawAndUndo(new TriangleTool(), 64, [40, 10], [55, 40]);
    assertTrue(r.drawn > 0, "삼각형이 그려져야 함");
    assertEqual(r.left, 0, `undo 후 잔존 픽셀 0 이어야 함 (그림 ${r.drawn}, 남음 ${r.left})`);
  });

  it("정사각형은 보정된 변까지 undo 된다", () => {
    const tool = new RectTool();
    tool.square = true;
    tool.filled = true;
    const r = drawAndUndo(tool, 64, [10, 10], [55, 25]); // |dx|=45 > |dy|=15 → 아래로 45 확장
    assertTrue(r.drawn > 0, "정사각형이 그려져야 함");
    assertEqual(r.left, 0, `undo 후 잔존 픽셀 0 이어야 함 (그림 ${r.drawn}, 남음 ${r.left})`);
  });

  it("정원은 보정된 반지름까지 undo 된다", () => {
    const tool = new EllipseTool();
    tool.circle = true;
    tool.filled = true;
    const r = drawAndUndo(tool, 64, [10, 25], [55, 35]); // rx=22.5 > ry=5 → 세로로 확장
    assertTrue(r.drawn > 0, "정원이 그려져야 함");
    assertEqual(r.left, 0, `undo 후 잔존 픽셀 0 이어야 함 (그림 ${r.drawn}, 남음 ${r.left})`);
  });
});

// ---------------------------------------------------------------------------
// 리뷰 #4 — 레이어 추가/삭제/PNG 가져오기가 비압축 base64 를 히스토리에 넣음
//
// layer.serialize() 를 옵션 없이 부르면 rawRGBA(비압축 base64)가 만들어진다.
// 1920×1280 레이어 한 장이 약 13MB 문자열이고, 브라우저 폴백 경로는 문자
// 단위 문자열 결합이라 한 장에 약 1.6초가 걸렸다(undo 시 디코드도 동일).
// ---------------------------------------------------------------------------

import { encodeBase64, decodeBase64 } from "../core/Layer.js";

describe("리뷰 #4 — 히스토리 스냅샷 압축", () => {
  it("히스토리용 스냅샷은 비압축 base64 를 담지 않는다", () => {
    const snap = (AppModule as unknown as { historySnapshot?: (l: Layer) => any }).historySnapshot;
    assertTrue(typeof snap === "function", "historySnapshot 헬퍼가 있어야 함");
    const layer = new Layer({ name: "L", width: 32, height: 32, factory });
    const lctx = layer.getCtx();
    lctx.fillStyle = "rgba(1,2,3,1)";
    lctx.fillRect(0, 0, 32, 32);

    const s = snap!(layer);
    assertEqual(s.rawRGBA, undefined, "rawRGBA(비압축)가 없어야 함");
    assertTrue(typeof s.rleRGBA === "string", "RLE 압축본이 있어야 함");
  });

  it("압축 스냅샷이 원래 픽셀로 복원된다", () => {
    const snap = (AppModule as unknown as { historySnapshot?: (l: Layer) => any }).historySnapshot;
    assertTrue(typeof snap === "function", "historySnapshot 헬퍼가 있어야 함");
    const layer = new Layer({ name: "L", width: 16, height: 16, factory });
    const lctx = layer.getCtx();
    lctx.fillStyle = "rgba(9,8,7,1)";
    lctx.fillRect(2, 2, 5, 5);

    const restored = Layer.deserialize(snap!(layer), factory);
    const a = layer.getPixels(0, 0, 16, 16).data;
    const b = restored.getPixels(0, 0, 16, 16).data;
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    assertEqual(diff, 0, "복원 픽셀이 원본과 같아야 함");
  });

  it("Buffer 없는(브라우저) 경로의 base64 가 Node 경로와 같다", () => {
    const data = new Uint8ClampedArray(70000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 0xff;
    const g = globalThis as any;
    const withBuffer = encodeBase64(data);
    const saved = g.Buffer;
    try {
      delete g.Buffer;
      const withoutBuffer = encodeBase64(data);
      assertEqual(withoutBuffer, withBuffer, "폴백 인코딩 결과가 같아야 함");
      const round = decodeBase64(withoutBuffer);
      assertEqual(round.length, data.length);
      let diff = 0;
      for (let i = 0; i < data.length; i++) if (round[i] !== data[i]) diff++;
      assertEqual(diff, 0, "폴백 라운드트립이 정확해야 함");
    } finally {
      g.Buffer = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// 리뷰 #7 — 드래그 중 도구 전환 / 멀티터치 미처리
//
// InputAdapter 는 이벤트마다 getActiveTool() 을 다시 조회하고 pointerId 를
// 추적하지 않았다. 스트로크 도중 단축키로 도구를 바꾸면 이전 도구의 drag 가
// 고아가 되어 ctx.save() 가 복구되지 않고 스트로크도 커밋되지 않으며(undo 불가)
// shadow 캔버스가 샌다. 두 번째 손가락이 닿으면 스트로크가 재시작됐다.
// ---------------------------------------------------------------------------

import { DisplayCanvas } from "../core/Canvas.js";
import { InputAdapter } from "../input/InputAdapter.js";
import { Tool } from "../tools/Tool.js";
import { MockHTMLElement, MockPointerEvent, installWindowGlobal } from "./mocks/Dom.js";

/** 호출 이력만 기록하는 도구. */
class SpyTool implements Tool {
  cursor = "crosshair";
  calls: string[] = [];
  constructor(public id: string) {}
  onPointerDown(): void { this.calls.push("down"); }
  onPointerMove(): void { this.calls.push("move"); }
  onPointerUp(): void { this.calls.push("up"); }
  onPointerCancel(): void { this.calls.push("cancel"); }
}

function wireInput(): { el: MockHTMLElement; setTool: (t: Tool) => void; destroy: () => void } {
  installWindowGlobal();
  const stack = new LayerStack(64, 64, factory);
  stack.add(new Layer({ name: "L", width: 64, height: 64, factory }));
  const toolCtx: ToolContext = {
    stack,
    history: new CommandHistory(),
    settings: defaultSettings(),
    previewLayer: new Layer({ width: 64, height: 64, factory }),
  };
  const display = new DisplayCanvas(new MockHTMLCanvasElement(64, 64) as any, 64, 64, 1);
  display.resizeDisplay(64, 64, 1);
  const el = new MockHTMLElement(64, 64, 0, 0);
  let active: Tool = new SpyTool("initial");
  const input = new InputAdapter(display, el as any, {
    getActiveTool: () => active,
    getToolContext: () => toolCtx,
  });
  input.bind();
  return { el, setTool: (t) => { active = t; }, destroy: () => input.unbind() };
}

function send(el: MockHTMLElement, type: string, x: number, y: number, pointerId = 1): void {
  el.dispatchEvent(new MockPointerEvent(type, { clientX: x, clientY: y, pointerId }));
}

describe("리뷰 #7 — 드래그 중 도구 전환", () => {
  it("pointerdown 시점의 도구가 up 까지 스트로크를 끝낸다", () => {
    const w = wireInput();
    const first = new SpyTool("first");
    const second = new SpyTool("second");
    w.setTool(first);
    send(w.el, "pointerdown", 5, 5);
    w.setTool(second); // 스트로크 도중 단축키로 도구 전환
    send(w.el, "pointermove", 20, 20);
    send(w.el, "pointerup", 20, 20);
    w.destroy();

    assertEqual(first.calls.join(","), "down,move,up", "최초 도구가 끝까지 처리해야 함");
    assertEqual(second.calls.length, 0, "전환된 도구는 이번 스트로크에 관여하면 안 됨");
  });

  it("전환된 도구는 다음 스트로크부터 쓰인다", () => {
    const w = wireInput();
    const first = new SpyTool("first");
    const second = new SpyTool("second");
    w.setTool(first);
    send(w.el, "pointerdown", 5, 5);
    send(w.el, "pointerup", 5, 5);
    w.setTool(second);
    send(w.el, "pointerdown", 9, 9);
    send(w.el, "pointerup", 9, 9);
    w.destroy();

    assertEqual(second.calls.join(","), "down,up", "다음 스트로크는 새 도구가 받아야 함");
  });
});

describe("리뷰 #7 — 멀티터치", () => {
  it("두 번째 포인터는 스트로크를 재시작하지 않는다", () => {
    const w = wireInput();
    const tool = new SpyTool("t");
    w.setTool(tool);
    send(w.el, "pointerdown", 5, 5, 1);
    send(w.el, "pointerdown", 40, 40, 2); // 두 번째 손가락
    send(w.el, "pointermove", 41, 41, 2);
    send(w.el, "pointerup", 41, 41, 2);
    send(w.el, "pointermove", 6, 6, 1);
    send(w.el, "pointerup", 6, 6, 1);
    w.destroy();

    assertEqual(tool.calls.join(","), "down,move,up", "첫 포인터만 처리해야 함");
  });

  it("취소도 스트로크를 시작한 포인터만 받는다", () => {
    const w = wireInput();
    const tool = new SpyTool("t");
    w.setTool(tool);
    send(w.el, "pointerdown", 5, 5, 1);
    send(w.el, "pointercancel", 5, 5, 2);
    send(w.el, "pointercancel", 5, 5, 1);
    w.destroy();

    assertEqual(tool.calls.join(","), "down,cancel", "다른 포인터의 취소는 무시해야 함");
  });
});

// ---------------------------------------------------------------------------
// 리뷰 #9 — 투명도 슬라이더가 input 마다 히스토리 커맨드를 만들고 패널을 통째로
// 다시 그린다. 드래그 한 번에 수십 개 항목이 쌓이고, 재렌더로 슬라이더 DOM 이
// 파괴되어 터치 조작이 도중에 끊긴다.
// ---------------------------------------------------------------------------

import { LayerPanel } from "../ui/LayerPanel.js";

interface FakeEl {
  tagName: string; className: string; type: string; value: string;
  min: string; max: string; step: string; title: string; textContent: string;
  children: FakeEl[]; listeners: Record<string, ((e: any) => void)[]>;
  [k: string]: any;
}

/** 리스너를 기억하는 DOM 셰임. ui.test.ts 의 셰임은 addEventListener 가 no-op 이라 이벤트를 못 쏜다. */
function makeEl(): FakeEl {
  const el: any = {
    tagName: "DIV", className: "", type: "", value: "", min: "", max: "", step: "",
    title: "", textContent: "", checked: false,
    children: [] as FakeEl[], listeners: {} as Record<string, ((e: any) => void)[]>,
    style: {}, dataset: {}, attributes: {} as Record<string, string>,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    _innerHTML: "",
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v: string) { this._innerHTML = v; this.children = []; },
    appendChild(c: FakeEl) { this.children.push(c); return c; },
    removeChild(c: FakeEl) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener(t: string, f: (e: any) => void) { (this.listeners[t] ||= []).push(f); },
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute(k: string, v: string) { this.attributes[k] = v; },
  };
  return el as FakeEl;
}

function withRichDom<T>(fn: (root: FakeEl) => T): T {
  const g = globalThis as any;
  const saved = g.document;
  g.document = { createElement: (tag: string) => { const e = makeEl(); e.tagName = tag.toUpperCase(); return e; } };
  try {
    return fn(makeEl());
  } finally {
    g.document = saved;
  }
}

function findByClass(root: FakeEl, cls: string): FakeEl | null {
  for (const c of root.children) {
    if (c.className === cls) return c;
    const hit = findByClass(c, cls);
    if (hit) return hit;
  }
  return null;
}

function fire(el: FakeEl, type: string): void {
  for (const f of el.listeners[type] ?? []) f({ stopPropagation() {}, preventDefault() {}, target: el });
}

describe("리뷰 #9 — 투명도 슬라이더 이벤트 분리", () => {
  it("input 은 미리보기만, change 에서만 커밋한다", () => {
    withRichDom((root) => {
      const stack = new LayerStack(8, 8, factory);
      stack.add(new Layer({ name: "L", width: 8, height: 8, factory }));
      const previews: number[] = [];
      const commits: number[] = [];
      const handlers: any = {
        onAdd() {}, onRemove() {}, onSelect() {}, onToggleVisible() {},
        onOpacity: (_id: string, o: number) => commits.push(o),
        onOpacityPreview: (_id: string, o: number) => previews.push(o),
        onMoveUp() {}, onMoveDown() {}, onRename() {},
      };
      const panel = new LayerPanel(root as any, stack, handlers);
      panel.render();

      const slider = findByClass(root, "layer-opacity");
      assertTrue(slider !== null, "투명도 슬라이더가 있어야 함");
      for (const v of ["0.9", "0.7", "0.4"]) { slider!.value = v; fire(slider!, "input"); }
      assertEqual(commits.length, 0, `드래그 중에는 커밋이 없어야 함 (실제 ${commits.length})`);
      assertEqual(previews.length, 3, "미리보기는 input 마다 와야 함");

      fire(slider!, "change");
      assertEqual(commits.length, 1, "손을 뗄 때 한 번만 커밋해야 함");
      assertEqual(commits[0], 0.4);
    });
  });

  it("드래그 중에는 패널을 다시 그리지 않는다", () => {
    withRichDom((root) => {
      const stack = new LayerStack(8, 8, factory);
      const layer = new Layer({ name: "L", width: 8, height: 8, factory });
      stack.add(layer);
      const handlers: any = {
        onAdd() {}, onRemove() {}, onSelect() {}, onToggleVisible() {},
        onOpacity() {},
        onOpacityPreview: (id: string, o: number) => stack.setOpacity(id, o),
        onMoveUp() {}, onMoveDown() {}, onRename() {},
      };
      const panel = new LayerPanel(root as any, stack, handlers);
      panel.render();

      const slider = findByClass(root, "layer-opacity");
      assertTrue(slider !== null, "투명도 슬라이더가 있어야 함");
      slider!.value = "0.5";
      fire(slider!, "input"); // stack "change" 발생 → 예전에는 여기서 재렌더
      assertTrue(findByClass(root, "layer-opacity") === slider, "슬라이더 DOM 이 살아 있어야 함");

      fire(slider!, "change");
      stack.setOpacity(layer.id, 0.2); // 드래그가 끝났으니 다시 그려도 된다
      assertTrue(findByClass(root, "layer-opacity") !== slider, "드래그 후에는 정상 재렌더");
    });
  });
});

describe("리뷰 #9 — 투명도 드래그 커밋", () => {
  const OpacityDrag = (AppModule as unknown as { OpacityDrag?: any }).OpacityDrag;

  it("드래그 전체가 히스토리 항목 하나가 된다", () => {
    assertTrue(typeof OpacityDrag === "function", "OpacityDrag 가 있어야 함");
    const stack = new LayerStack(8, 8, factory);
    const layer = new Layer({ name: "L", width: 8, height: 8, factory });
    stack.add(layer);
    const history = new CommandHistory();
    const drag = new OpacityDrag();

    for (const v of [0.9, 0.7, 0.4]) drag.preview(stack, layer.id, v);
    assertEqual(history.size().past, 0, "미리보기는 히스토리를 만들지 않는다");
    assertEqual(layer.opacity, 0.4, "미리보기는 즉시 반영된다");

    drag.commit(stack, history, layer.id, 0.4);
    assertEqual(history.size().past, 1, "커밋은 한 개만 만든다");
    history.undo({ stack });
    assertEqual(layer.opacity, 1, "undo 는 드래그 이전 값으로 되돌린다");
  });

  it("값이 그대로면 커맨드를 만들지 않는다", () => {
    assertTrue(typeof OpacityDrag === "function", "OpacityDrag 가 있어야 함");
    const stack = new LayerStack(8, 8, factory);
    const layer = new Layer({ name: "L", width: 8, height: 8, factory });
    stack.add(layer);
    const history = new CommandHistory();
    const drag = new OpacityDrag();

    drag.preview(stack, layer.id, 1);
    drag.commit(stack, history, layer.id, 1);
    assertEqual(history.size().past, 0, "변화 없는 드래그는 기록하지 않는다");
  });

  it("commit 만 불러도(클릭) 이전 값을 before 로 쓴다", () => {
    assertTrue(typeof OpacityDrag === "function", "OpacityDrag 가 있어야 함");
    const stack = new LayerStack(8, 8, factory);
    const layer = new Layer({ name: "L", width: 8, height: 8, factory });
    stack.add(layer);
    const history = new CommandHistory();
    const drag = new OpacityDrag();

    drag.commit(stack, history, layer.id, 0.3);
    assertEqual(layer.opacity, 0.3);
    history.undo({ stack });
    assertEqual(layer.opacity, 1);
  });
});

// ---------------------------------------------------------------------------
// 리뷰 #5 — 그라디언트 미리보기가 매 pointermove 마다 전체 레이어를 순회
//
// 마스크 bbox 는 pointerDown 에서 이미 계산해 두는데도 preview 는 레이어 전체를
// getImageData/putImageData 하고 W×H 를 두 번 돌았다. 1920×1280 이면 이동
// 이벤트마다 240만 픽셀이다.
// ---------------------------------------------------------------------------

import { GradientTool } from "../tools/GradientTool.js";

interface ImageDataCall { op: string; w: number; h: number; }

/** 레이어 컨텍스트의 get/putImageData 호출 크기를 기록한다. */
function recordImageDataCalls(layer: Layer): ImageDataCall[] {
  const lctx = layer.getCtx() as any;
  const calls: ImageDataCall[] = [];
  const origGet = lctx.getImageData.bind(lctx);
  const origPut = lctx.putImageData.bind(lctx);
  lctx.getImageData = (x: number, y: number, w: number, h: number) => {
    calls.push({ op: "get", w, h });
    return origGet(x, y, w, h);
  };
  lctx.putImageData = (img: any, x: number, y: number) => {
    calls.push({ op: "put", w: img.width, h: img.height });
    return origPut(img, x, y);
  };
  return calls;
}

describe("리뷰 #5 — 그라디언트 미리보기 범위", () => {
  it("미리보기는 마스크 bbox 만 읽고 쓴다", () => {
    const { ctx, layer } = bootstrap(64);
    const lctx = layer.getCtx();
    lctx.fillStyle = "rgba(0,255,0,1)";
    lctx.fillRect(10, 10, 4, 4); // 마스크가 될 작은 영역
    ctx.settings.tolerance = 0;

    const tool = new GradientTool();
    tool.onPointerDown(pointer(11, 11), ctx); // 여기서는 전체 읽기가 정상(플러드 마스크)
    const calls = recordImageDataCalls(layer);
    tool.onPointerMove(pointer(13, 13), ctx);
    tool.onPointerMove(pointer(20, 20), ctx);
    tool.onPointerMove(pointer(30, 30), ctx);

    assertTrue(calls.length > 0, "미리보기가 픽셀을 만져야 함");
    const biggest = Math.max(...calls.map((c) => c.w * c.h));
    assertTrue(biggest <= 100, `bbox(16px) 규모여야 함, 실제 최대 ${biggest}px`);
  });

  it("bbox 만 순회해도 그라디언트 결과는 같다", () => {
    const { ctx, history, stack, layer } = bootstrap(64);
    const lctx = layer.getCtx();
    lctx.fillStyle = "rgba(0,255,0,1)";
    lctx.fillRect(10, 10, 4, 4);
    ctx.settings.tolerance = 0;

    const tool = new GradientTool();
    tool.onPointerDown(pointer(10, 10), ctx);
    tool.onPointerMove(pointer(13, 13), ctx);
    tool.onPointerUp(pointer(13, 13), ctx);

    // 마스크 안은 그라디언트로 바뀌고, 마스크 밖은 그대로다.
    const inside = layer.getPixels(10, 10, 1, 1).data;
    // 기본 그라디언트는 빨강(t=0) → 파랑(t=1). 시작점이라 빨강이어야 한다.
    assertEqual(inside[0], 255, "마스크 안이 그라디언트 시작색이어야 함");
    assertEqual(inside[1], 0);
    assertEqual(layer.getPixels(30, 30, 1, 1).data[3], 0, "마스크 밖은 건드리지 않아야 함");

    history.undo({ stack });
    const restored = layer.getPixels(10, 10, 1, 1).data;
    assertEqual(restored[0], 0, "undo 로 원래 초록 복원");
    assertEqual(restored[1], 255);
  });
});

// ---------------------------------------------------------------------------
// 리뷰 #8 — 새 프로젝트 생성 후 좌표 매핑 오류 / 입력 검증 부재
//
// newProject 는 prompt 입력을 그대로 parseInt 해서 NaN·0·거대 값이 그대로
// 캔버스 크기가 됐고, 취소를 눌러도 프로젝트가 새로 만들어졌다. 게다가
// setProjectSize/refit 을 부르지 않아 크기가 다른 새 프로젝트에서는 포인터
// 좌표가 어긋났다.
// ---------------------------------------------------------------------------

describe("리뷰 #8 — 프로젝트 크기 입력 검증", () => {
  const parse = (AppModule as unknown as {
    parseProjectSize?: (input: string | null, fallback: number) => number | null;
  }).parseProjectSize;

  it("정상 입력과 빈 입력을 처리한다", () => {
    assertTrue(typeof parse === "function", "parseProjectSize 가 있어야 함");
    assertEqual(parse!("800", 100), 800);
    assertEqual(parse!("  640  ", 100), 640);
    assertEqual(parse!("", 100), 100, "빈 입력은 기존 크기 유지");
    assertEqual(parse!("640.7", 100), 640, "소수는 내림");
  });

  it("취소와 잘못된 값은 null 이다", () => {
    assertTrue(typeof parse === "function", "parseProjectSize 가 있어야 함");
    assertEqual(parse!(null, 100), null, "취소");
    assertEqual(parse!("abc", 100), null, "숫자 아님");
    assertEqual(parse!("0", 100), null, "0 불가");
    assertEqual(parse!("-5", 100), null, "음수 불가");
    assertEqual(parse!("NaN", 100), null);
  });

  it("지나치게 큰 값은 상한으로 자른다", () => {
    assertTrue(typeof parse === "function", "parseProjectSize 가 있어야 함");
    const max = (AppModule as unknown as { MAX_PROJECT_SIZE?: number }).MAX_PROJECT_SIZE;
    assertTrue(typeof max === "number", "MAX_PROJECT_SIZE 가 있어야 함");
    assertEqual(parse!("1000000000", 100), max);
    assertEqual(parse!("1e9", 100), max);
  });
});
