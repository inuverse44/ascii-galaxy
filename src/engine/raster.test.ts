import { describe, expect, it } from "vitest";
import { createRandom } from "../util/random";
import {
  GLINT_INK,
  GLINT_MIN_BRIGHTNESS,
  GLINT_SHARE,
  INK,
  MAX_SCREEN,
  MIN_SCREEN,
  RAMP,
  Region,
  SAMPLE_OFFSETS,
  backgroundFor,
  cellBrightness,
  cellsFromSamples,
  createGlintClocks,
  createGrid,
  glintEpoch,
  glintInks,
  glintRoll,
  glintTiming,
  glyphFor,
  rasterize,
  type Field,
} from "./raster";

const rgb = (css: string): [number, number, number] => {
  const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(css);
  if (!m) throw new Error(`not an rgb() colour: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

describe("RS-1 grid", () => {
  it("has the stated cell sizes at the stated widths", () => {
    const sizes = [390, 1024, 1440, 2560].map((w) => createGrid(w, 800)).map((g) => [g.cellWidth, g.cellHeight]);
    expect(sizes).toEqual([
      [8, 12],
      [8, 12],
      [12, 17],
      [13, 19],
    ]);
  });

  it("covers the whole screen with cells", () => {
    for (const [w, h] of [
      [MIN_SCREEN, MIN_SCREEN],
      [390, 844],
      [1440, 900],
      [MAX_SCREEN, MIN_SCREEN],
      [MAX_SCREEN, MAX_SCREEN],
    ] as const) {
      const g = createGrid(w, h);
      expect(g.cols * g.cellWidth).toBeGreaterThanOrEqual(w);
      expect((g.cols - 1) * g.cellWidth).toBeLessThan(w);
      expect(g.rows * g.cellHeight).toBeGreaterThanOrEqual(h);
      expect((g.rows - 1) * g.cellHeight).toBeLessThan(h);
    }
  });

  it("rejects screens outside the range", () => {
    for (const [w, h] of [
      [MIN_SCREEN - 1, 800],
      [800, MIN_SCREEN - 1],
      [MAX_SCREEN + 1, 800],
      [Number.NaN, 800],
      [800, Number.POSITIVE_INFINITY],
    ]) {
      expect(() => createGrid(w!, h!)).toThrow(RangeError);
    }
  });
});

describe("RS-2 sampling", () => {
  it("has exactly 8 offsets, all inside the cell", () => {
    expect(SAMPLE_OFFSETS).toHaveLength(8);
    for (const [x, y] of SAMPLE_OFFSETS) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1);
    }
  });

  it("a cell's value is the mean of the field at its 8 points", () => {
    const grid = createGrid(1440, 900);
    // A field that differs at every point, so a wrong point or a wrong weight changes the mean
    const field: Field = { brightness: (x, y) => ((x * 0.37 + y * 0.11) % 1 + 1) % 1 };
    for (const [col, row] of [
      [0, 0],
      [5, 3],
      [grid.cols - 1, grid.rows - 1],
    ] as const) {
      const expected =
        SAMPLE_OFFSETS.map(([ox, oy]) => field.brightness((col + ox) * grid.cellWidth, (row + oy) * grid.cellHeight)).reduce((a, b) => a + b) / 8;
      expect(cellBrightness(field, grid, col, row)).toBeCloseTo(expected, 12);
    }
  });
});

describe("RS-3 glyph and background", () => {
  it("the glyph is ramp[min(10, floor(11 × b))], checked on both sides of every threshold", () => {
    expect(RAMP).toBe(" .:;t%SX8#@");
    for (let k = 1; k <= 10; k++) {
      expect(glyphFor(k / 11 - 1e-9)).toBe(RAMP[k - 1]);
      expect(glyphFor(k / 11 + 1e-9)).toBe(RAMP[k]);
    }
    expect(glyphFor(0)).toBe(" ");
    expect(glyphFor(0.25)).toBe(":");
    expect(glyphFor(1)).toBe("@");
  });

  it("the background is a grey (equal channels) with lightness 1 − 0.25 × b", () => {
    for (const b of [0, 0.05, 0.25, 0.5, 0.95, 1, ...Array.from({ length: 11 }, (_, k) => k / 11)]) {
      const [r, g, bl] = rgb(backgroundFor(b));
      expect(g).toBe(r);
      expect(bl).toBe(r);
      expect(Math.abs(r / 255 - (1 - 0.25 * b))).toBeLessThanOrEqual(0.5 / 255);
    }
  });
});

describe("RS-4 glint clocks", () => {
  it("interval 2 + u and offset u′ × interval, at fixed u and u′", () => {
    for (const [u, interval] of [[0, 2], [0.5, 2.5], [0.999, 2.999]] as const) expect(glintTiming(u, 0)).toEqual({ interval: expect.closeTo(interval, 12), offset: 0 });
    expect(glintTiming(0, 0.5).offset).toBeCloseTo(1, 12);
    expect(glintTiming(0.5, 0.5).offset).toBeCloseTo(1.25, 12);
  });

  it("each cell's clock comes from two consecutive draws, in cell order", () => {
    const real = createRandom(3);
    const drawn: number[] = [];
    const clocks = createGlintClocks(50, { next: () => drawn[drawn.push(real.next()) - 1]! });
    for (let i = 0; i < 50; i++) {
      const { interval, offset } = glintTiming(drawn[2 * i]!, drawn[2 * i + 1]!);
      expect(clocks.interval[i]).toBe(interval);
      expect(clocks.offset[i]).toBe(offset);
    }
  });

  it("with real seeds: intervals cover both halves of [2, 3], and offsets are not shared", () => {
    for (const seed of [1, 2, 3]) {
      const clocks = createGlintClocks(10_000, createRandom(seed));
      const intervals = [...clocks.interval];
      expect(intervals.every((d) => d >= 2 && d < 3)).toBe(true);
      expect(intervals.some((d) => d < 2.5) && intervals.some((d) => d >= 2.5)).toBe(true);
      expect(new Set(clocks.offset).size).toBeGreaterThanOrEqual(9_900);
    }
  });

  it("each cell's roll changes only at its own boundaries, and at each of them", () => {
    const clocks = createGlintClocks(200, createRandom(4));
    let boundaries = 0;
    for (let i = 0; i < 200; i++) {
      for (let k = 1; k <= 600; k++) {
        const [t0, t1] = [(k - 1) * 0.05, k * 0.05];
        // The boundaries of cell i are the times t where (t + offset) / interval is a whole number
        const crossed = Math.floor((t1 + clocks.offset[i]!) / clocks.interval[i]!) !== Math.floor((t0 + clocks.offset[i]!) / clocks.interval[i]!);
        if (crossed) boundaries++;
        expect(glintRoll(clocks, i, t1) !== glintRoll(clocks, i, t0), `cell ${i} at ${t1}`).toBe(crossed);
      }
    }
    expect(boundaries).toBeGreaterThan(200 * 9); // 30 s at most 3 s apart: at least 10 boundaries per cell
  });

  it("across a re-roll, a selected cell stays selected only about as often as chance", () => {
    const clocks = createGlintClocks(20_000, createRandom(5));
    let selected = 0;
    let kept = 0;
    for (let i = 0; i < 20_000; i++) {
      for (let k = 0; k < 10; k++) {
        // The middle of epoch k and of epoch k + 1 of cell i
        const t = (k + 0.5) * clocks.interval[i]! - clocks.offset[i]!;
        if (glintRoll(clocks, i, t) >= GLINT_SHARE) continue;
        selected++;
        if (glintRoll(clocks, i, t + clocks.interval[i]!) < GLINT_SHARE) kept++;
      }
    }
    expect(selected).toBeGreaterThan(1000);
    expect(kept / selected).toBeLessThanOrEqual(0.1);
  });
});

describe("RS-4 glint inks", () => {
  it("only galaxy cells brighter than 0.1 glint, each when its roll is low: amber in the core, blue or pink in the arms", () => {
    const n = 6000;
    const clocks = createGlintClocks(n, createRandom(6));
    // Cells cycle through the three regions and four brightnesses; only 0.5 and 1 make galaxy cells
    const regions = Uint8Array.from({ length: n }, (_, i) => i % 3);
    const brightness = Float64Array.from({ length: n }, (_, i) => [0.5, GLINT_MIN_BRIGHTNESS, Number.NaN, 1][Math.floor(i / 3) % 4]!);
    const seen = new Map<number, Set<string>>([[Region.none, new Set()], [Region.arm, new Set()], [Region.core, new Set()]]);
    for (const t of [0, 1.7, 4.2, 50.3]) {
      const inks = glintInks(brightness, regions, clocks, t);
      inks.forEach((ink, i) => {
        seen.get(regions[i]!)!.add(ink);
        const galaxy = regions[i] !== Region.none && brightness[i]! > GLINT_MIN_BRIGHTNESS;
        if (!galaxy) expect(ink).toBe(INK);
        else expect(ink !== INK, `cell ${i} at ${t}`).toBe(glintRoll(clocks, i, t) < GLINT_SHARE);
      });
    }
    expect([...seen.get(Region.none)!]).toEqual([INK]);
    expect(new Set(seen.get(Region.arm))).toEqual(new Set([INK, GLINT_INK.blue, GLINT_INK.pink]));
    expect(new Set(seen.get(Region.core))).toEqual(new Set([INK, GLINT_INK.amber]));
  });

  it("with constant brightness, a cell's shown ink changes only at its own clock's boundaries", () => {
    // 60 galaxy cells drawn 12 times a second for 60 s: every change of a cell's ink falls on a boundary of its clock
    const n = 60;
    const regions = Uint8Array.from({ length: n }, (_, i) => (i % 4 === 0 ? Region.core : Region.arm));
    const brightness = new Float64Array(n).fill(0.5);
    let changes = 0;
    for (const seed of [1, 2, 3]) {
      const clocks = createGlintClocks(n, createRandom(seed));
      let previous = glintInks(brightness, regions, clocks, 0);
      for (let k = 1; k <= 720; k++) {
        const [t0, t1] = [(k - 1) / 12, k / 12];
        const inks = glintInks(brightness, regions, clocks, t1);
        inks.forEach((ink, i) => {
          if (ink === previous[i]) return;
          changes++;
          expect(glintEpoch(clocks, i, t1), `seed ${seed} cell ${i} at ${t1}`).not.toBe(glintEpoch(clocks, i, t0));
        });
        previous = inks;
      }
    }
    expect(changes).toBeGreaterThan(50); // inks really change
  });

  it("cellsFromSamples colours the inks by glintInks, and keeps glyph and background", () => {
    const grid = createGrid(MIN_SCREEN, MIN_SCREEN);
    const count = grid.cols * grid.rows;
    const values = Float64Array.from({ length: count * 8 }, (_, k) => (Math.floor(k / 8) % 7) / 6);
    const regions = Uint8Array.from({ length: count }, (_, i) => i % 3);
    const clocks = createGlintClocks(count, createRandom(7));
    const plain = cellsFromSamples(values, grid);
    const brightness = Array.from({ length: count }, (_, i) => {
      let sum = 0;
      for (let k = 0; k < 8; k++) sum += values[i * 8 + k]!;
      return sum / 8;
    });
    let coloured = 0;
    for (const t of [0, 2.2, 9.9, 31.4]) {
      const cells = cellsFromSamples(values, grid, { regions, clocks, t });
      const inks = glintInks(brightness, regions, clocks, t);
      cells.forEach((cell, i) => {
        expect(cell.glyph).toBe(plain[i]!.glyph);
        expect(cell.background).toBe(plain[i]!.background);
        expect(cell.ink).toBe(inks[i]);
        if (cell.ink !== INK) coloured++;
      });
    }
    expect(coloured).toBeGreaterThan(0);
    expect(plain.every((c) => c.ink === INK)).toBe(true);
    expect(() => cellsFromSamples(values, grid, { regions: regions.subarray(1), clocks, t: 0 })).toThrow(RangeError);
  });
});

describe("C-1, C-2 cells", () => {
  it("values outside [0, 1] behave as the nearest end; NaN as 0", () => {
    expect(glyphFor(-0.5)).toBe(glyphFor(0));
    expect(backgroundFor(-0.5)).toBe(backgroundFor(0));
    expect(glyphFor(1.5)).toBe(glyphFor(1));
    expect(backgroundFor(1.5)).toBe(backgroundFor(1));
    expect(glyphFor(Number.NaN)).toBe(glyphFor(0));
  });

  it("every cell holds exactly one glyph character", () => {
    const grid = createGrid(MIN_SCREEN, MIN_SCREEN);
    const field: Field = { brightness: (x, y) => (x + y) / 200 - 0.5 }; // runs from −0.5 to 1.5
    const cells = rasterize(field, grid);
    expect(cells).toHaveLength(grid.cols * grid.rows);
    for (const cell of cells) {
      expect(cell.glyph).toHaveLength(1);
      expect(RAMP).toContain(cell.glyph);
    }
  });
});
