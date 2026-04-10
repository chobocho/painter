import { Tool } from "./Tool.js";
import { PencilTool, EraserTool, LineTool, RectTool, EllipseTool, TriangleTool } from "./ShapeTools.js";
import { SprayTool } from "./SprayTool.js";
import { FillBucketTool } from "./FillBucketTool.js";
import { GradientTool } from "./GradientTool.js";
import { EyedropperTool } from "./EyedropperTool.js";
import { SmudgeTool } from "./SmudgeTool.js";
import { PatternBrush } from "./PatternBrush.js";

export interface ToolDescriptor {
  id: string;
  label: string;
  shortcut: string;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private descriptors: ToolDescriptor[] = [];

  register(tool: Tool, label: string, shortcut: string): void {
    this.tools.set(tool.id, tool);
    this.descriptors.push({ id: tool.id, label, shortcut });
  }

  get(id: string): Tool | undefined { return this.tools.get(id); }
  list(): ToolDescriptor[] { return this.descriptors.slice(); }
}

export function buildDefaultRegistry(): ToolRegistry {
  const r = new ToolRegistry();
  r.register(new PencilTool(), "Pencil", "B");
  r.register(new EraserTool(), "Eraser", "E");
  r.register(new LineTool(), "Line", "L");
  const rectFilled = new RectTool();   rectFilled.filled = true;
  const rectOutline = new RectTool();  rectOutline.filled = false;
  const square = new RectTool();       square.square = true; (square as RectTool & { id: string }).id = "square";
  const squareF = new RectTool();      squareF.square = true; squareF.filled = true; (squareF as RectTool & { id: string }).id = "square-filled";
  r.register(rectOutline, "Rectangle", "R");
  r.register(rectFilled, "Filled Rectangle", "Shift+R");
  r.register(square, "Square", "");
  r.register(squareF, "Filled Square", "");
  // Force unique ids on the four rect variants.
  (rectFilled as RectTool & { id: string }).id = "rect-filled";
  (rectOutline as RectTool & { id: string }).id = "rect";
  const ellipse = new EllipseTool(); (ellipse as EllipseTool & { id: string }).id = "ellipse";
  const ellipseF = new EllipseTool(); ellipseF.filled = true; (ellipseF as EllipseTool & { id: string }).id = "ellipse-filled";
  const circle = new EllipseTool(); circle.circle = true; (circle as EllipseTool & { id: string }).id = "circle";
  const circleF = new EllipseTool(); circleF.circle = true; circleF.filled = true; (circleF as EllipseTool & { id: string }).id = "circle-filled";
  r.register(ellipse, "Ellipse", "");
  r.register(ellipseF, "Filled Ellipse", "");
  r.register(circle, "Circle", "C");
  r.register(circleF, "Filled Circle", "Shift+C");
  const tri = new TriangleTool(); (tri as TriangleTool & { id: string }).id = "triangle";
  const triF = new TriangleTool(); triF.filled = true; (triF as TriangleTool & { id: string }).id = "triangle-filled";
  r.register(tri, "Triangle", "");
  r.register(triF, "Filled Triangle", "");
  r.register(new SprayTool(), "Spray", "S");
  r.register(new FillBucketTool(), "Fill Bucket", "F");
  r.register(new GradientTool(), "Gradient", "G");
  r.register(new EyedropperTool(), "Eyedropper", "K");
  r.register(new SmudgeTool(), "Smudge", "U");
  r.register(new PatternBrush(), "Pattern Brush", "P");
  return r;
}
