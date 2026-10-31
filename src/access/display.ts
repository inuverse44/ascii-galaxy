// A01 DisplayAccess: draws cells onto a Canvas 2D context (R01).
// Background fill first, then faint grid lines, then glyphs grouped by ink colour.

import { type Cell, type Grid, GRID_LINE, INK } from "../engine/raster";

/** The part of CanvasRenderingContext2D that A01 uses (a test can pass a spy). */
export type DrawingContext = Pick<
  CanvasRenderingContext2D,
  "fillStyle" | "strokeStyle" | "lineWidth" | "font" | "textAlign" | "textBaseline" | "fillRect" | "fillText" | "beginPath" | "moveTo" | "lineTo" | "stroke" | "setTransform"
>;

export interface Surface {
  width: number;
  height: number;
  getContext(kind: "2d"): DrawingContext | null;
}

export class DisplayAccess {
  private readonly ctx: DrawingContext;

  constructor(private readonly surface: Surface) {
    const ctx = surface.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
  }

  /** Sizes the backing store for the device pixel ratio; drawing then uses CSS pixels. */
  resize(grid: Grid, pixelRatio: number): void {
    const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? Math.min(pixelRatio, 3) : 1;
    this.surface.width = Math.round(grid.width * ratio);
    this.surface.height = Math.round(grid.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  /** Cells in row-major order, as many as grid.cols × grid.rows. */
  draw(cells: readonly Cell[], grid: Grid): void {
    if (cells.length !== grid.cols * grid.rows) throw new RangeError(`expected ${grid.cols * grid.rows} cells, got ${cells.length}`);
    const { ctx } = this;
    const cw = grid.cellWidth;
    const ch = grid.cellHeight;

    const byBackground = new Map<string, number[]>();
    cells.forEach((cell, i) => {
      const list = byBackground.get(cell.background);
      if (list) list.push(i);
      else byBackground.set(cell.background, [i]);
    });
    for (const [background, indexes] of byBackground) {
      ctx.fillStyle = background;
      for (const i of indexes) ctx.fillRect((i % grid.cols) * cw, Math.floor(i / grid.cols) * ch, cw, ch);
    }

    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let col = 1; col < grid.cols; col++) {
      ctx.moveTo(col * cw + 0.5, 0);
      ctx.lineTo(col * cw + 0.5, grid.rows * ch);
    }
    for (let row = 1; row < grid.rows; row++) {
      ctx.moveTo(0, row * ch + 0.5);
      ctx.lineTo(grid.cols * cw, row * ch + 0.5);
    }
    ctx.stroke();

    ctx.font = `${Math.round(ch * 0.78)}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const byInk = new Map<string, number[]>([[INK, []]]);
    cells.forEach((cell, i) => {
      if (cell.glyph === " ") return;
      const list = byInk.get(cell.ink);
      if (list) list.push(i);
      else byInk.set(cell.ink, [i]);
    });
    for (const [ink, indexes] of byInk) {
      ctx.fillStyle = ink;
      for (const i of indexes) ctx.fillText(cells[i]!.glyph, (i % grid.cols) * cw + cw / 2, Math.floor(i / grid.cols) * ch + ch / 2);
    }
  }
}
