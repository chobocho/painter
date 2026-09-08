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
