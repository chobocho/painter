import { Tool } from "./Tool.js";
import { PencilTool, EraserTool, LineTool, RectTool, EllipseTool, TriangleTool } from "./ShapeTools.js";
import { SprayTool } from "./SprayTool.js";
import { FillBucketTool } from "./FillBucketTool.js";
import { GradientTool } from "./GradientTool.js";
import { EyedropperTool } from "./EyedropperTool.js";
import { SmudgeTool } from "./SmudgeTool.js";
import { PatternBrush } from "./PatternBrush.js";
import { TextTool } from "./TextTool.js";

export interface ToolDescriptor {
  id: string;
  label: string;
  shortcut: string;
  icon: string;
  /**
   * One-line Korean description shown in the status bar and the button
   * tooltip. Forces every tool to ship a discoverable explanation of what
   * it does — round-6 found that "smudge 기능이 뭐야?" was a real failure
   * mode for any new user looking at an unfamiliar emoji.
   */
  description: string;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private descriptors: ToolDescriptor[] = [];

  register(id: string, tool: Tool, label: string, shortcut: string, icon: string, description: string): void {
    (tool as { id: string }).id = id;
    if (this.tools.has(id)) throw new Error(`ToolRegistry: duplicate id "${id}"`);
    this.tools.set(id, tool);
    this.descriptors.push({ id, label, shortcut, icon, description });
  }

  get(id: string): Tool | undefined { return this.tools.get(id); }
  list(): ToolDescriptor[] { return this.descriptors.slice(); }
  getDescriptor(id: string): ToolDescriptor | undefined {
    return this.descriptors.find((d) => d.id === id);
  }
  has(id: string): boolean { return this.tools.has(id); }
  size(): number { return this.tools.size; }
}

export function buildDefaultRegistry(): ToolRegistry {
  const r = new ToolRegistry();

  r.register("pencil", new PencilTool(), "펜슬", "B", "✏️", "자유롭게 선을 그립니다");
  r.register("eraser", new EraserTool(), "지우개", "E", "🩹", "픽셀을 지웁니다");
  r.register("line", new LineTool(), "직선", "L", "📏", "두 점 사이에 직선을 그립니다");

  const rect = new RectTool();
  r.register("rect", rect, "사각형", "R", "▭", "사각형 외곽선을 그립니다");
  const rectFilled = new RectTool();
  rectFilled.filled = true;
  r.register("rect-filled", rectFilled, "채운 사각형", "Shift+R", "▬", "내부가 채워진 사각형을 그립니다");

  const square = new RectTool();
  square.square = true;
  r.register("square", square, "정사각형", "", "□", "한 변이 같은 정사각형 외곽선을 그립니다");
  const squareFilled = new RectTool();
  squareFilled.square = true;
  squareFilled.filled = true;
  r.register("square-filled", squareFilled, "채운 정사각형", "", "■", "내부가 채워진 정사각형을 그립니다");

  const ellipse = new EllipseTool();
  r.register("ellipse", ellipse, "타원", "", "⬭", "타원 외곽선을 그립니다");
  const ellipseFilled = new EllipseTool();
  ellipseFilled.filled = true;
  r.register("ellipse-filled", ellipseFilled, "채운 타원", "", "⬬", "내부가 채워진 타원을 그립니다");

  const circle = new EllipseTool();
  circle.circle = true;
  r.register("circle", circle, "원", "C", "○", "정원의 외곽선을 그립니다");
  const circleFilled = new EllipseTool();
  circleFilled.circle = true;
  circleFilled.filled = true;
  r.register("circle-filled", circleFilled, "채운 원", "Shift+C", "●", "내부가 채워진 정원을 그립니다");

  const tri = new TriangleTool();
  r.register("triangle", tri, "삼각형", "", "△", "삼각형 외곽선을 그립니다");
  const triFilled = new TriangleTool();
  triFilled.filled = true;
  r.register("triangle-filled", triFilled, "채운 삼각형", "", "▲", "내부가 채워진 삼각형을 그립니다");

  r.register("spray", new SprayTool(), "스프레이", "S", "💨", "에어브러시처럼 점들을 흩뿌립니다");
  r.register("fill", new FillBucketTool(), "채우기", "F", "🪣", "클릭한 영역을 단색으로 채웁니다");
  r.register("gradient", new GradientTool(), "그라디언트", "G", "🌈", "클릭한 영역만 두 점 방향으로 그라디언트로 채웁니다");
  r.register("eyedropper", new EyedropperTool(), "스포이드", "K", "💧", "클릭한 위치의 색을 추출해 팔레트에 넣습니다");
  r.register("smudge", new SmudgeTool(), "문지르기", "U", "👆", "픽셀을 문질러 색을 섞습니다 (빈 곳에선 현재 색을 끌고 갑니다)");
  r.register("pattern", new PatternBrush(), "패턴", "P", "✦", "패턴 마스크로 칠합니다");
  r.register("text", new TextTool(), "글자", "T", "🅣", "클릭한 위치에 텍스트를 입력해 스탬프처럼 찍습니다");

  return r;
}
