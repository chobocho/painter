// Round 10: doc/code-review-2026-09-08.md 의 지적 사항에 대한 회귀 테스트.
//
//   * 리뷰 #1 — 채우기가 방문 마스크 없이 "시드 색과의 거리 ≤ 허용오차"만
//     검사하던 탓에, 칠할 색이 시드 색의 허용오차 안에 들어오면 이미 칠한
//     픽셀이 다시 매치되어 스택이 무한히 자랐다. 무한 루프는 테스트가
//     "실패"하는 대신 힙을 터뜨리므로, ImageData 읽기 횟수에 상한을 두는
//     프록시를 씌워 예산 초과를 예외로 바꿔서 검증한다.
//   * 리뷰 #6 — 채우기가 before/after 로 레이어 전체(1920×1280 기준 약
//     20MB)를 히스토리에 넣던 문제. 실제로 바뀐 픽셀의 bbox 만 저장해야 한다.

import { describe, it, assertEqual, assertTrue, assertFalse } from "./runner.js";
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
    appendChild(c: FakeEl) { this.children.push(c); (c as any).parentNode = this; return c; },
    removeChild(c: FakeEl) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); (c as any).parentNode = null; return c; },
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
  const restore = () => { g.document = saved; };
  try {
    const r = fn(makeEl());
    // async 콜백이면 끝날 때까지 셰임을 유지해야 한다.
    if (r && typeof (r as any).then === "function") {
      return (r as any).then(
        (v: unknown) => { restore(); return v; },
        (e: unknown) => { restore(); throw e; }
      ) as T;
    }
    restore();
    return r;
  } catch (e) {
    restore();
    throw e;
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

function fire(el: FakeEl, type: string, extra: Record<string, unknown> = {}): void {
  for (const f of el.listeners[type] ?? []) f({ stopPropagation() {}, preventDefault() {}, target: el, ...extra });
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

// ---------------------------------------------------------------------------
// 리뷰 #10/#19 — 레이어 개수 가드
//
// PNG 가져오기는 레이어 5개 제한을 검사하지 않아 제한을 우회했고, 레이어
// 삭제에는 마지막 한 장을 지키는 가드가 없어 캔버스가 비어버릴 수 있었다.
// ---------------------------------------------------------------------------

import { LAYER_LIMIT } from "../ui/LayerPanel.js";

describe("리뷰 #10/#19 — 레이어 개수 가드", () => {
  const canAdd = (AppModule as unknown as { canAddLayer?: (n: number) => boolean }).canAddLayer;
  const canRemove = (AppModule as unknown as { canRemoveLayer?: (n: number) => boolean }).canRemoveLayer;

  it("추가는 상한 미만에서만 허용된다", () => {
    assertTrue(typeof canAdd === "function", "canAddLayer 가 있어야 함");
    assertTrue(canAdd!(0), "0장에서는 추가 가능");
    assertTrue(canAdd!(LAYER_LIMIT - 1), "상한 직전에는 추가 가능");
    assertFalse(canAdd!(LAYER_LIMIT), "상한에서는 추가 불가");
    assertFalse(canAdd!(LAYER_LIMIT + 1), "상한을 넘겨도 추가 불가");
  });

  it("삭제는 마지막 한 장을 남긴다", () => {
    assertTrue(typeof canRemove === "function", "canRemoveLayer 가 있어야 함");
    assertFalse(canRemove!(0), "빈 스택에서는 삭제 불가");
    assertFalse(canRemove!(1), "마지막 한 장은 지운다");
    assertTrue(canRemove!(2), "2장부터 삭제 가능");
  });
});

// ---------------------------------------------------------------------------
// 리뷰 #11 — 글자 도구
//
//   * 오버레이 <input> 위치에 프로젝트 좌표를 화면 px 로 그대로 써서 엉뚱한
//     곳에 떴다.
//   * 폭 추정 0.6em 은 한글(약 1em)에 부족해 undo rect 가 글자 오른쪽을
//     덮지 못한다 → measureText 사용.
//   * Escape 로 취소해도 이어지는 blur 에서 commit 이 다시 불렸다.
// ---------------------------------------------------------------------------

import { TextTool } from "../tools/TextTool.js";

/** 한글처럼 1em 폭으로 그려지는 컨텍스트를 흉내낸다. */
function makeWideTextCtx(layer: Layer, emFactor: number): void {
  const lctx = layer.getCtx() as any;
  const fontPx = () => parseInt(String(lctx.font).replace(/[^0-9].*$/, ""), 10) || 12;
  lctx.measureText = (t: string) => ({ width: Math.round(t.length * fontPx() * emFactor) });
  lctx.fillText = (t: string, x: number, y: number) => {
    const w = Math.round(t.length * fontPx() * emFactor);
    lctx.fillRect(Math.round(x), Math.round(y), w, fontPx());
  };
}

describe("리뷰 #11 — 글자 도구 undo 범위", () => {
  it("한글 폭(1em)도 undo rect 가 모두 덮는다", () => {
    const { ctx, history, stack, layer } = bootstrap(256);
    ctx.settings.color = { r: 255, g: 0, b: 0, a: 255 };
    ctx.settings.brushSize = 4; // fontPx = 24
    makeWideTextCtx(layer, 1);

    const tool = new TextTool();
    tool.setNextText("한글테스트글자");
    tool.onPointerDown(pointer(10, 10), ctx);

    let drawn = 0;
    const d = layer.getPixels(0, 0, 256, 256).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) drawn++;
    assertTrue(drawn > 0, "글자가 그려져야 함");

    history.undo({ stack });
    const after = layer.getPixels(0, 0, 256, 256).data;
    let left = 0;
    for (let i = 3; i < after.length; i += 4) if (after[i]! > 0) left++;
    assertEqual(left, 0, `undo 후 잔존 픽셀 0 이어야 함 (그림 ${drawn}, 남음 ${left})`);
  });
});

describe("리뷰 #11 — 오버레이 입력", () => {
  function withOverlayDom<T>(fn: (body: FakeEl) => T): T {
    const g = globalThis as any;
    const savedDoc = g.document;
    const savedWin = g.window;
    const body = makeEl();
    g.document = { createElement: (tag: string) => { const e = makeEl(); e.tagName = tag.toUpperCase(); return e; }, body };
    g.window = { innerWidth: 1000, innerHeight: 800 };
    try { return fn(body); } finally { g.document = savedDoc; g.window = savedWin; }
  }

  it("Escape 로 취소하면 blur 가 와도 커밋하지 않는다", () => {
    withOverlayDom((body) => {
      const { ctx, history } = bootstrap(64);
      const tool = new TextTool();
      tool.onPointerDown(pointer(5, 5), ctx);

      const input = body.children[0];
      assertTrue(input !== undefined, "오버레이 input 이 만들어져야 함");
      input!.value = "취소할글";
      fire(input!, "keydown", { key: "Escape" });
      fire(input!, "blur"); // 브라우저는 제거 직후 blur 를 한 번 더 보낸다
      assertEqual(history.size().past, 0, "취소한 글자는 기록되면 안 됨");
    });
  });

  it("Enter 로 커밋한 뒤 blur 가 와도 두 번 찍히지 않는다", () => {
    withOverlayDom((body) => {
      const { ctx, history } = bootstrap(64);
      const tool = new TextTool();
      tool.onPointerDown(pointer(5, 5), ctx);

      const input = body.children[0]!;
      input.value = "가";
      fire(input, "keydown", { key: "Enter" });
      fire(input, "blur");
      assertEqual(history.size().past, 1, "커밋은 한 번만");
    });
  });

  it("오버레이는 프로젝트 좌표가 아니라 화면 좌표에 뜬다", () => {
    withOverlayDom((body) => {
      const { ctx } = bootstrap(64);
      const tool = new TextTool();
      // 프로젝트 좌표 (5,5) 인데 화면에서는 (500,400) 근처를 눌렀다.
      tool.onPointerDown({ ...pointer(5, 5), clientX: 500, clientY: 400 } as any, ctx);

      const css = String(body.children[0]!.style.cssText);
      assertTrue(css.includes("left:508px"), `화면 좌표 기준이어야 함 (실제 ${css})`);
      assertTrue(css.includes("top:404px"), `화면 좌표 기준이어야 함 (실제 ${css})`);
    });
  });
});

// ---------------------------------------------------------------------------
// 리뷰 #12 — 단축키
//
//   * 글자 도구 T 가 레지스트리/README 에는 있는데 SHORTCUTS 에는 없었다.
//   * e.key 로만 매칭해서 한글 IME 가 켜져 있으면(b 대신 ㅠ) 모든 단축키가
//     동작하지 않았다 → e.code 폴백.
// ---------------------------------------------------------------------------

import { matchShortcut } from "../input/Shortcuts.js";

const keyEvent = (over: Partial<{ key: string; code: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }>) =>
  ({ key: "", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...over }) as any;

describe("리뷰 #12 — 단축키", () => {
  it("T 로 글자 도구를 고른다", () => {
    assertEqual(matchShortcut(keyEvent({ key: "t" }))?.action, "tool:text");
    assertEqual(matchShortcut(keyEvent({ key: "T" }))?.action, "tool:text");
  });

  it("한글 IME 상태에서도 code 로 매칭한다", () => {
    assertEqual(matchShortcut(keyEvent({ key: "ㅠ", code: "KeyB" }))?.action, "tool:pencil");
    assertEqual(matchShortcut(keyEvent({ key: "ㅋ", code: "KeyZ", ctrlKey: true }))?.action, "history:undo");
    assertEqual(matchShortcut(keyEvent({ key: "ㅅ", code: "KeyT" }))?.action, "tool:text");
  });

  it("괄호 키도 code 로 폴백한다", () => {
    assertEqual(matchShortcut(keyEvent({ key: "Process", code: "BracketLeft" }))?.action, "brush:dec");
    assertEqual(matchShortcut(keyEvent({ key: "Process", code: "BracketRight" }))?.action, "brush:inc");
  });

  it("key 매칭이 먼저고, 모르는 조합은 null 이다", () => {
    // shift+R 은 key 로 이미 맞는다 (code 폴백이 가로채면 안 된다)
    assertEqual(matchShortcut(keyEvent({ key: "R", code: "KeyR", shiftKey: true }))?.action, "tool:rect-filled");
    assertEqual(matchShortcut(keyEvent({ key: "ㅂ", code: "KeyQ" })), null);
    assertEqual(matchShortcut(keyEvent({ key: "ㅂ" })), null);
  });
});

// ---------------------------------------------------------------------------
// 리뷰 #13 — 프로젝트 로드 후 UI 컨트롤 미동기화
//
// applyState 는 설정을 Object.assign 으로 덮어쓰지만 굵기/허용 슬라이더,
// 대칭 체크박스, 팔레트, 패턴 선택은 그대로 남아 실제 설정과 어긋났다.
// ---------------------------------------------------------------------------

describe("리뷰 #13 — 설정 → 컨트롤 값 변환", () => {
  const toControls = (AppModule as unknown as {
    controlValuesFromSettings?: (s: any) => any;
  }).controlValuesFromSettings;

  it("슬라이더와 패턴 값을 설정에서 가져온다", () => {
    assertTrue(typeof toControls === "function", "controlValuesFromSettings 가 있어야 함");
    const s = defaultSettings();
    s.brushSize = 17;
    s.tolerance = 42;
    s.patternId = "dots";
    const v = toControls!(s);
    assertEqual(v.brushSize, "17");
    assertEqual(v.tolerance, "42");
    assertEqual(v.patternId, "dots");
  });

  it("대칭 축을 체크박스 두 개로 푼다", () => {
    assertTrue(typeof toControls === "function", "controlValuesFromSettings 가 있어야 함");
    const s = defaultSettings();
    s.symmetry = { enabled: true, axes: ["x"], radial: 0 };
    assertTrue(toControls!(s).mirrorX);
    assertFalse(toControls!(s).mirrorY);

    s.symmetry = { enabled: true, axes: ["x", "y"], radial: 0 };
    assertTrue(toControls!(s).mirrorX);
    assertTrue(toControls!(s).mirrorY);
  });

  it("대칭이 꺼져 있으면 축이 남아 있어도 둘 다 해제한다", () => {
    assertTrue(typeof toControls === "function", "controlValuesFromSettings 가 있어야 함");
    const s = defaultSettings();
    s.symmetry = { enabled: false, axes: ["x", "y"], radial: 0 };
    assertFalse(toControls!(s).mirrorX);
    assertFalse(toControls!(s).mirrorY);
  });
});

// ---------------------------------------------------------------------------
// 리뷰 #14/#23/#24 — 허용오차 기준 불일치와 입력 검증 부재
//
//   * Fill 은 tol²×3, Gradient 는 tol²×4 로 같은 "허용" 값이 다르게 동작했다.
//   * Color.parse 는 잘못된 입력에 조용히 검정을 돌려줘서, 배경 제거 프롬프트에
//     오타를 내면 검정이 지워졌다.
//   * rleDecodeRGBA / ProjectCodec.decode 에 검증이 없어 손상된 데이터가
//     조용히 깨진 픽셀이 됐다.
// ---------------------------------------------------------------------------

import { Color } from "../util/Color.js";
import { rleEncodeRGBA, rleDecodeRGBA } from "../core/Layer.js";
import { ProjectCodec } from "../io/ProjectCodec.js";
import { assertThrows } from "./runner.js";

describe("리뷰 #14 — 허용오차 기준 통일", () => {
  it("Fill 과 Gradient 가 같은 임계값을 쓴다", () => {
    const sq = (Color as unknown as { toleranceSq?: (t: number) => number }).toleranceSq;
    assertTrue(typeof sq === "function", "Color.toleranceSq 가 있어야 함");
    assertEqual(sq!(0), 0);
    assertEqual(sq!(16), 16 * 16 * 4);
  });

  it("tol²×3 과 ×4 사이의 색도 같은 영역으로 채운다", () => {
    // 흰 배경에 (243,243,245) 한 점. 시드와의 제곱거리 388 → ×3(300)은 탈락,
    // ×4(400)는 포함. Gradient 기준(×4)에 맞춘다.
    const { ctx, layer } = bootstrap(16);
    const lctx = layer.getCtx();
    lctx.fillStyle = "rgba(255,255,255,1)";
    lctx.fillRect(0, 0, 16, 16);
    lctx.fillStyle = "rgba(243,243,245,1)";
    lctx.fillRect(8, 8, 1, 1);

    ctx.settings.color = { r: 0, g: 0, b: 255, a: 255 };
    ctx.settings.tolerance = 10;
    new FillBucketTool().onPointerDown(pointer(0, 0), ctx);

    const px = layer.getPixels(8, 8, 1, 1).data;
    assertEqual(px[2], 255, "허용오차 안의 점도 함께 칠해져야 함");
    assertEqual(px[0], 0);
  });
});

describe("리뷰 #23 — Color 파싱 검증", () => {
  it("정상 표기를 파싱한다", () => {
    const tp = (Color as unknown as { tryParse?: (s: string) => any }).tryParse;
    assertTrue(typeof tp === "function", "Color.tryParse 가 있어야 함");
    assertEqual(tp!("#ff0000")!.r, 255);
    assertEqual(tp!("#fff")!.g, 255, "3자리 hex 도 지원");
    assertEqual(tp!("rgba(1,2,3,1)")!.b, 3);
  });

  it("잘못된 입력은 null 이다 (검정이 아니라)", () => {
    const tp = (Color as unknown as { tryParse?: (s: string) => any }).tryParse;
    assertTrue(typeof tp === "function", "Color.tryParse 가 있어야 함");
    assertEqual(tp!("바탕색"), null);
    assertEqual(tp!("#gg0000"), null, "hex 가 아닌 문자");
    assertEqual(tp!("#ff00"), null, "길이가 틀림");
    assertEqual(tp!(""), null);
  });

  it("Color.parse 는 기존처럼 검정으로 폴백한다", () => {
    assertEqual(Color.parse("nonsense").r, 0);
    assertEqual(Color.parse("nonsense").a, 255);
  });
});

describe("리뷰 #24 — 손상된 데이터 검증", () => {
  it("정상 RLE 는 그대로 왕복한다", () => {
    const src = new Uint8ClampedArray(64);
    for (let i = 0; i < src.length; i += 4) { src[i] = 7; src[i + 3] = 255; }
    const round = rleDecodeRGBA(rleEncodeRGBA(src), src.length);
    assertEqual(round.length, src.length);
    assertEqual(round[0], 7);
    assertEqual(round[3], 255);
  });

  it("길이가 6의 배수가 아닌 RLE 는 거부한다", () => {
    assertThrows(() => rleDecodeRGBA(new Uint8ClampedArray(7), 16));
  });

  it("기대 크기를 넘는 RLE 는 거부한다", () => {
    // count=100 인 런 하나 = 400 바이트인데 16 바이트만 기대한다.
    const bad = new Uint8ClampedArray([0, 100, 1, 2, 3, 4]);
    assertThrows(() => rleDecodeRGBA(bad, 16));
  });

  it("형태가 깨진 프로젝트 JSON 을 거부한다", () => {
    assertThrows(() => ProjectCodec.decode('{"version":"1.0.0"}'));
    assertThrows(() => ProjectCodec.decode('{"version":"1.0.0","meta":{},"layers":[]}'));
    assertThrows(() => ProjectCodec.decode('{"version":"1.0.0","meta":{"width":10,"height":10},"layers":"nope"}'));
  });
});

// ---------------------------------------------------------------------------
// 리뷰 #15(저장소) — 목록 조회가 모든 프로젝트의 전체 JSON 을 읽고, autosave
// 항목을 지우는 API 가 없어 영구 누적된다.
// ---------------------------------------------------------------------------

const bigJson = (id: string) => JSON.stringify({ version: "1.0.0", id, blob: "x".repeat(20000) });

function storedProject(id: string, name: string, updatedAt: number) {
  return { id, name, createdAt: 1, updatedAt, width: 100, height: 100, projectJson: bigJson(id) };
}

describe("리뷰 #15 — 프로젝트 목록 경량화", () => {
  it("목록 조회가 프로젝트 JSON 을 읽지 않는다", async () => {
    const store = await freshStore();
    await store.putProject(storedProject("p1", "첫번째", 10));
    await store.putProject(storedProject("p2", "두번째", 20));

    // getAll 이 호출되면 전체 JSON 을 읽는다는 뜻이다.
    let getAllCalls = 0;
    const orig = (store as any).withStore.bind(store);
    (store as any).withStore = (name: string, mode: string, fn: any) => {
      const spy = (s: any) => {
        const wrapped = Object.create(s);
        wrapped.getAll = (...a: any[]) => { getAllCalls++; return s.getAll(...a); };
        return fn(wrapped);
      };
      return orig(name, mode, spy);
    };

    const list = await store.listProjects();
    assertEqual(list.length, 2);
    assertEqual(list[0]!.id, "p2", "최신순 정렬");
    assertEqual((list[0] as any).projectJson, undefined, "메타에 JSON 이 실리면 안 됨");
    assertEqual(getAllCalls, 0, `목록 조회에 getAll 을 쓰면 안 됨 (호출 ${getAllCalls}회)`);
  });

  it("인덱스가 없던 옛 저장본도 목록이 나온다", async () => {
    const store = await freshStore();
    await store.putProject(storedProject("p1", "옛것", 5));
    await store.putMeta("projectIndex", undefined); // 인덱스 유실 상황
    const list = await store.listProjects();
    assertEqual(list.length, 1, "getAll 폴백으로 복구");
    assertEqual(list[0]!.name, "옛것");
  });
});

describe("리뷰 #15 — autosave 정리", () => {
  it("autosave 를 지우는 API 가 있다", async () => {
    const store = await freshStore();
    await store.putAutoSave({ id: "p1", savedAt: 1, projectJson: "{}" });
    const del = (store as unknown as { deleteAutoSave?: (id: string) => Promise<void> }).deleteAutoSave;
    assertTrue(typeof del === "function", "deleteAutoSave 가 있어야 함");
    await del!.call(store, "p1");
    assertEqual(await store.getAutoSave("p1"), undefined);
  });

  it("프로젝트를 지우면 autosave 와 목록에서도 사라진다", async () => {
    const store = await freshStore();
    await store.putProject(storedProject("p1", "지울것", 1));
    await store.putAutoSave({ id: "p1", savedAt: 1, projectJson: "{}" });

    await store.deleteProject("p1");
    assertEqual(await store.getProject("p1"), undefined);
    assertEqual(await store.getAutoSave("p1"), undefined, "autosave 도 함께 정리");
    assertEqual((await store.listProjects()).length, 0, "목록에서도 사라짐");
  });
});

// ---------------------------------------------------------------------------
// 리뷰 #15(UI) — 프로젝트 삭제/이름 변경 UI 가 없고, render 가 async 라
// 동시 호출 시 목록이 중복된다.
// ---------------------------------------------------------------------------

import { ProjectPanel } from "../ui/ProjectPanel.js";

function projectPanelHandlers(sink: string[]): any {
  return {
    onNew() {}, onSave() {}, onLoad: (id: string) => sink.push(`load:${id}`),
    onExportPng() {}, onExportJson() {}, onImportJson() {}, onImportPng() {},
    onChromaKey() {},
    onDelete: (id: string) => sink.push(`delete:${id}`),
    onRename: (id: string, name: string) => sink.push(`rename:${id}:${name}`),
  };
}

describe("리뷰 #15 — 프로젝트 목록 UI", () => {
  it("행마다 이름 변경·삭제 버튼이 있다", async () => {
    const store = await freshStore();
    await store.putProject(storedProject("p1", "그림", 1));
    const sink: string[] = [];
    await withRichDom(async (root) => {
      const panel = new ProjectPanel(root as any, store, projectPanelHandlers(sink));
      await panel.render();
      const del = findByClass(root, "project-delete");
      const ren = findByClass(root, "project-rename");
      assertTrue(del !== null, "삭제 버튼이 있어야 함");
      assertTrue(ren !== null, "이름 변경 버튼이 있어야 함");
      fire(del!, "click");
      assertEqual(sink.join(","), "delete:p1", "행 클릭(불러오기)과 섞이면 안 됨");
    });
  });

  it("render 를 동시에 불러도 목록이 중복되지 않는다", async () => {
    const store = await freshStore();
    await store.putProject(storedProject("p1", "하나", 1));
    await store.putProject(storedProject("p2", "둘", 2));
    const sink: string[] = [];
    await withRichDom(async (root) => {
      const panel = new ProjectPanel(root as any, store, projectPanelHandlers(sink));
      await Promise.all([panel.render(), panel.render(), panel.render()]);
      const rows = root.children.filter((c) => c.className === "project-list");
      assertEqual(rows.length, 1, `project-list 는 하나여야 함 (실제 ${rows.length})`);
      const listEl = rows[0]!;
      assertEqual(listEl.children.length, 2, `프로젝트 행은 2개여야 함 (실제 ${listEl.children.length})`);
    });
  });
});

// ---------------------------------------------------------------------------
// 리뷰 #16 — RLE 최악 경우와 자동 저장 부하
//
// 노이즈가 많은 레이어(스프레이·사진)는 RLE 가 raw 의 1.5배가 되는데도 그대로
// 저장했고, 인코더가 JS number[] 를 써서 힙을 크게 먹었다. 또 바뀌지 않은
// 레이어도 자동 저장 때마다 다시 직렬화했다.
// ---------------------------------------------------------------------------

function noisyLayer(size: number): Layer {
  const layer = new Layer({ name: "N", width: size, height: size, factory });
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i * 7) & 0xff;
    data[i + 1] = (i * 13) & 0xff;
    data[i + 2] = (i * 29) & 0xff;
    data[i + 3] = 255;
  }
  layer.putPixels({ width: size, height: size, data }, 0, 0);
  return layer;
}

describe("리뷰 #16 — RLE 최악 경우", () => {
  it("RLE 가 raw 보다 크면 raw 로 저장한다", () => {
    const layer = noisyLayer(32);
    const snap = layer.serialize({ compact: true }) as any;
    assertEqual(snap.rleRGBA, undefined, "부풀어난 RLE 를 쓰면 안 됨");
    assertTrue(typeof snap.rawRGBA === "string" && snap.rawRGBA.length > 0, "raw 폴백이어야 함");
  });

  it("raw 폴백도 픽셀이 그대로 복원된다", () => {
    const layer = noisyLayer(16);
    const restored = Layer.deserialize(layer.serialize({ compact: true }), factory);
    const a = layer.getPixels(0, 0, 16, 16).data;
    const b = restored.getPixels(0, 0, 16, 16).data;
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    assertEqual(diff, 0);
  });

  it("잘 압축되는 레이어는 계속 RLE 를 쓴다", () => {
    const layer = new Layer({ name: "S", width: 32, height: 32, factory });
    const lctx = layer.getCtx();
    lctx.fillStyle = "rgba(10,20,30,1)";
    lctx.fillRect(0, 0, 32, 32);
    const snap = layer.serialize({ compact: true }) as any;
    assertTrue(typeof snap.rleRGBA === "string", "단색은 RLE 가 압도적으로 작다");
    assertEqual(snap.rawRGBA, undefined);
  });
});

describe("리뷰 #16 — 변경 없는 레이어 재직렬화", () => {
  it("바뀌지 않았으면 픽셀을 다시 읽지 않는다", () => {
    const layer = new Layer({ name: "C", width: 16, height: 16, factory });
    const calls = recordImageDataCalls(layer);
    layer.serialize({ compact: true });
    const afterFirst = calls.length;
    assertTrue(afterFirst > 0, "첫 직렬화는 픽셀을 읽는다");

    layer.serialize({ compact: true });
    assertEqual(calls.length, afterFirst, "두 번째는 캐시를 써야 함");
  });

  it("그린 뒤에는 다시 직렬화한다", () => {
    const layer = new Layer({ name: "C", width: 16, height: 16, factory });
    const calls = recordImageDataCalls(layer);
    layer.serialize({ compact: true });
    const afterFirst = calls.length;

    const lctx = layer.getCtx(); // 그리기 위해 컨텍스트를 받아갔다 = 변경 가능성
    lctx.fillStyle = "rgba(1,2,3,1)";
    lctx.fillRect(0, 0, 4, 4);
    layer.serialize({ compact: true });
    assertTrue(calls.length > afterFirst, "변경 후에는 다시 읽어야 함");

    const restored = Layer.deserialize(layer.serialize({ compact: true }), factory);
    assertEqual(restored.getPixels(0, 0, 1, 1).data[0], 1, "캐시가 낡은 픽셀을 주면 안 됨");
  });

  it("메타만 바뀌어도 최신 값이 나온다", () => {
    const layer = new Layer({ name: "C", width: 16, height: 16, factory });
    layer.serialize({ compact: true });
    layer.name = "새이름";
    layer.opacity = 0.25;
    const snap = layer.serialize({ compact: true });
    assertEqual(snap.name, "새이름");
    assertEqual(snap.opacity, 0.25);
  });
});
