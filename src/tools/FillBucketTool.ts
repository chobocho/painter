import { Tool, ToolContext, ToolPointer } from "./Tool.js";
import { Rect } from "../util/Rect.js";
import { PixelEditCommand } from "../history/Commands.js";
import { Color } from "../util/Color.js";

/** RGBA 버퍼에서 rect 영역만 잘라낸다. 행 단위 memcpy 라 O(rect 면적). */
function cropRGBA(data: Uint8ClampedArray, srcW: number, r: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  const rowBytes = r.w * 4;
  for (let y = 0; y < r.h; y++) {
    const s = ((r.y + y) * srcW + r.x) * 4;
    out.set(data.subarray(s, s + rowBytes), y * rowBytes);
  }
  return out;
}

export class FillBucketTool implements Tool {
  id = "fill";
  cursor = "crosshair";

  onPointerDown(p: ToolPointer, ctx: ToolContext): void {
    const layer = ctx.stack.getActive();
    if (!layer || layer.locked) return;

    const sx = Math.floor(p.x);
    const sy = Math.floor(p.y);
    if (sx < 0 || sy < 0 || sx >= layer.width || sy >= layer.height) return;

    const lctx = layer.getCtx();
    // 레이어를 한 번만 읽는다. region 은 쓰기 대상, src 는 매치 판정과
    // 히스토리 before 픽셀로 함께 쓰는 "칠하기 전" 스냅샷이다.
    const region = lctx.getImageData(0, 0, layer.width, layer.height);
    const w = region.width;
    const h = region.height;
    const src = new Uint8ClampedArray(region.data);

    const startIdx = (sy * w + sx) * 4;
    const target = [src[startIdx]!, src[startIdx + 1]!, src[startIdx + 2]!, src[startIdx + 3]!];
    const replacement = ctx.settings.color;
    if (
      target[0] === replacement.r &&
      target[1] === replacement.g &&
      target[2] === replacement.b &&
      target[3] === replacement.a
    ) return;
    const tol2 = Color.toleranceSq(ctx.settings.tolerance);

    // 방문 마스크. 매치 판정을 src(원본) 기준으로 하고 채운 픽셀을 여기 표시해야
    // 종료가 보장된다. 예전처럼 갱신 중인 region 을 기준으로 보면, 칠할 색이
    // 시드 색의 허용오차 안에 들어올 때(예: (250,250,250) → 흰색, 허용 16)
    // 방금 칠한 픽셀이 계속 다시 매치되어 스택이 무한히 자랐다.
    // O(W×H) 시간, O(W×H) 추가 메모리(마스크 + 원본 스냅샷).
    const visited = new Uint8Array(w * h);

    // 실제로 바뀐 픽셀의 bbox. 히스토리에 레이어 전체가 아니라 이 영역만 담는다.
    let minX = w, minY = h, maxX = -1, maxY = -1;

    const matches = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      if (visited[y * w + x]) return false;
      const i = (y * w + x) * 4;
      const dr = src[i]! - target[0]!;
      const dg = src[i + 1]! - target[1]!;
      const db = src[i + 2]! - target[2]!;
      const da = src[i + 3]! - target[3]!;
      return dr * dr + dg * dg + db * db + da * da <= tol2;
    };
    const set = (x: number, y: number): void => {
      const i = (y * w + x) * 4;
      region.data[i] = replacement.r;
      region.data[i + 1] = replacement.g;
      region.data[i + 2] = replacement.b;
      region.data[i + 3] = replacement.a;
      visited[y * w + x] = 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };

    // Iterative scanline flood fill.
    const stack: number[] = [sx, sy];
    while (stack.length > 0) {
      const y = stack.pop()!;
      const x = stack.pop()!;
      if (!matches(x, y)) continue;
      let xl = x;
      while (matches(xl, y)) xl--;
      xl++;
      let xr = x;
      while (matches(xr, y)) xr++;
      xr--;
      for (let xx = xl; xx <= xr; xx++) {
        set(xx, y);
        if (matches(xx, y - 1)) stack.push(xx, y - 1);
        if (matches(xx, y + 1)) stack.push(xx, y + 1);
      }
    }

    if (maxX < minX) return; // 바뀐 픽셀 없음

    lctx.putImageData(region, 0, 0);
    const r = Rect.create(minX, minY, maxX - minX + 1, maxY - minY + 1);
    ctx.history.execute(
      new PixelEditCommand({
        layerId: layer.id,
        rect: r,
        before: { width: r.w, height: r.h, data: cropRGBA(src, w, r) },
        after: { width: r.w, height: r.h, data: cropRGBA(region.data, w, r) },
        label: "Fill",
      }),
      { stack: ctx.stack }
    );
    ctx.stack.markDirty(r);
  }

  onPointerMove(_p: ToolPointer, _ctx: ToolContext): void {}
  onPointerUp(_p: ToolPointer, _ctx: ToolContext): void {}
  onPointerCancel(_ctx: ToolContext): void {}
}
