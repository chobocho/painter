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
  icon: string;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private descriptors: ToolDescriptor[] = [];

  /**
   * Register a tool with an explicit id. The tool's own `id` field is
   * overwritten so the registry key always matches what the tool reports.
   */
  register(id: string, tool: Tool, label: string, shortcut: string, icon: string): void {
    (tool as { id: string }).id = id;
    if (this.tools.has(id)) throw new Error(`ToolRegistry: duplicate id "${id}"`);
    this.tools.set(id, tool);
    this.descriptors.push({ id, label, shortcut, icon });
  }

  get(id: string): Tool | undefined { return this.tools.get(id); }
  list(): ToolDescriptor[] { return this.descriptors.slice(); }
  has(id: string): boolean { return this.tools.has(id); }
  size(): number { return this.tools.size; }
}

export function buildDefaultRegistry(): ToolRegistry {
  const r = new ToolRegistry();

  r.register("pencil", new PencilTool(), "Pencil", "B", "✏️");
  r.register("eraser", new EraserTool(), "Eraser", "E", "🩹");
  r.register("line", new LineTool(), "Line", "L", "📏");

  const rect = new RectTool();
  r.register("rect", rect, "Rectangle", "R", "▭");
  const rectFilled = new RectTool();
  rectFilled.filled = true;
  r.register("rect-filled", rectFilled, "Filled Rectangle", "Shift+R", "▬");

  const square = new RectTool();
  square.square = true;
  r.register("square", square, "Square", "", "□");
  const squareFilled = new RectTool();
  squareFilled.square = true;
  squareFilled.filled = true;
  r.register("square-filled", squareFilled, "Filled Square", "", "■");

  const ellipse = new EllipseTool();
  r.register("ellipse", ellipse, "Ellipse", "", "⬭");
  const ellipseFilled = new EllipseTool();
  ellipseFilled.filled = true;
  r.register("ellipse-filled", ellipseFilled, "Filled Ellipse", "", "⬬");

  const circle = new EllipseTool();
  circle.circle = true;
  r.register("circle", circle, "Circle", "C", "○");
  const circleFilled = new EllipseTool();
  circleFilled.circle = true;
  circleFilled.filled = true;
  r.register("circle-filled", circleFilled, "Filled Circle", "Shift+C", "●");

  const tri = new TriangleTool();
  r.register("triangle", tri, "Triangle", "", "△");
  const triFilled = new TriangleTool();
  triFilled.filled = true;
  r.register("triangle-filled", triFilled, "Filled Triangle", "", "▲");

  r.register("spray", new SprayTool(), "Spray", "S", "💨");
  r.register("fill", new FillBucketTool(), "Fill Bucket", "F", "🪣");
  r.register("gradient", new GradientTool(), "Gradient", "G", "🌈");
  r.register("eyedropper", new EyedropperTool(), "Eyedropper", "K", "💧");
  r.register("smudge", new SmudgeTool(), "Smudge", "U", "👆");
  r.register("pattern", new PatternBrush(), "Pattern", "P", "✦");

  return r;
}
