import { describe, expect, it } from "vitest";
import { type Cell, GLINT_INK, INK, createGrid } from "../engine/raster";
import { DisplayAccess, type DrawingContext, type Surface } from "./display";

/** A Canvas 2D spy that records fillText calls with the fill style in force. */
function spySurface() {
  const texts: { glyph: string; x: number; y: number; style: string }[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    fillRect() {},
    fillText(glyph: string, x: number, y: number) {
      texts.push({ glyph, x, y, style: String(ctx.fillStyle) });
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    setTransform() {},
  } as unknown as DrawingContext;
  const surface: Surface = { width: 0, height: 0, getContext: () => ctx };
  return { surface, texts };
}

describe("C-1 A01 draws at most one glyph per cell", () => {
  it("one fillText per non-space cell, inside that cell, and none for spaces", () => {
    const grid = createGrid(400, 300);
    const glyphs = " .:;t%SX8#@";
    // Inks vary between cells, so drawing grouped by ink must still give each glyph its own cell's ink (RS-4)
    const inks = [INK, GLINT_INK.blue, GLINT_INK.pink, GLINT_INK.amber, INK];
    const cells: Cell[] = Array.from({ length: grid.cols * grid.rows }, (_, i) => ({
      glyph: glyphs[i % glyphs.length]!,
      background: "rgb(255, 255, 255)",
      ink: inks[i % inks.length]!,
    }));
    const { surface, texts } = spySurface();
    new DisplayAccess(surface).draw(cells, grid);

    const perCell = new Map<number, number>();
    for (const { glyph, x, y, style } of texts) {
      const col = Math.floor(x / grid.cellWidth);
      const row = Math.floor(y / grid.cellHeight);
      const i = row * grid.cols + col;
      expect(glyph).toBe(cells[i]!.glyph);
      expect(style).toBe(cells[i]!.ink);
      perCell.set(i, (perCell.get(i) ?? 0) + 1);
    }
    cells.forEach((cell, i) => expect(perCell.get(i) ?? 0).toBe(cell.glyph === " " ? 0 : 1));
    expect(new Set(texts.map((t) => t.style)).size).toBe(4); // every ink was really drawn
  });

  it("rejects a cell array that does not match the grid", () => {
    const grid = createGrid(400, 300);
    const { surface } = spySurface();
    expect(() => new DisplayAccess(surface).draw([], grid)).toThrow(RangeError);
  });

  it("sizes the backing store for the pixel ratio, falling back to 1 for invalid ratios", () => {
    const grid = createGrid(400, 300);
    for (const [ratio, expected] of [
      [2, 2],
      [Number.NaN, 1],
      [0, 1],
      [10, 3],
    ] as const) {
      const { surface } = spySurface();
      new DisplayAccess(surface).resize(grid, ratio);
      expect(surface.width).toBe(400 * expected);
      expect(surface.height).toBe(300 * expected);
    }
  });
});
