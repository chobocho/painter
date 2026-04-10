// Display canvas wrapper. Owns DPR + CSS sizing only; pixel data lives on layers.

import { CanvasLike, Ctx2D } from "./Layer.js";

export class DisplayCanvas {
  readonly el: CanvasLike;
  private ctx: Ctx2D;
  private dpr: number;
  cssWidth: number = 0;
  cssHeight: number = 0;
  projectWidth: number;
  projectHeight: number;

  constructor(el: CanvasLike, projectWidth: number, projectHeight: number, dpr: number = 1) {
    this.el = el;
    this.projectWidth = projectWidth;
    this.projectHeight = projectHeight;
    this.dpr = dpr;
    const c = el.getContext("2d");
    if (!c) throw new Error("Failed to acquire 2d context");
    this.ctx = c;
  }

  getCtx(): Ctx2D { return this.ctx; }

  /**
   * Resize the on-screen pixel buffer to fit cssW x cssH at the current DPR.
   * Project coordinates remain stable; the context applies a transform so a
   * project pixel maps to the right number of device pixels.
   */
  resizeDisplay(cssW: number, cssH: number, dpr?: number): void {
    if (dpr !== undefined) this.dpr = dpr;
    this.cssWidth = cssW;
    this.cssHeight = cssH;
    const w = Math.max(1, Math.round(cssW * this.dpr));
    const h = Math.max(1, Math.round(cssH * this.dpr));
    if (this.el.width !== w) this.el.width = w;
    if (this.el.height !== h) this.el.height = h;
    // Note: in real DOM, reassigning canvas.width resets the context state, so we
    // re-acquire the context to be safe.
    const c = this.el.getContext("2d");
    if (c) this.ctx = c;
    // Style is the caller's job (CSS).
  }

  /**
   * Map a client (mouse/touch) coordinate (already relative to canvas top-left
   * in CSS pixels) to a project coordinate.
   */
  cssToProject(x: number, y: number): { x: number; y: number } {
    return {
      x: (x / Math.max(1, this.cssWidth)) * this.projectWidth,
      y: (y / Math.max(1, this.cssHeight)) * this.projectHeight,
    };
  }

  setProjectSize(w: number, h: number): void {
    this.projectWidth = w;
    this.projectHeight = h;
  }

  getDpr(): number { return this.dpr; }
}
