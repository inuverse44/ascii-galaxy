// E02 RasterEngine: turns a brightness field into cells (docs/02-detailed-design.md RS-1–RS-4).
// Pure: no browser API. A01 draws the cells.

/** A brightness field over screen pixels. Values are expected in [0, 1]; anything else is clamped (C-2). */
export interface Field {
  brightness(x: number, y: number): number;
}

export interface Grid {
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
}

/** One cell (C-1): at most one glyph (a space means none) in an ink colour, on a filled background. */
export interface Cell {
  glyph: string;
  background: string;
  ink: string;
}

/** SK-8, RS-4: the region of the galaxy a cell is in, which decides its glint colour. */
export const Region = { none: 0, arm: 1, core: 2 } as const;
export type Region = (typeof Region)[keyof typeof Region];

/**
 * Screens outside this range are rejected; C01 clamps the window size into it. Sizes are CSS pixels, so 4096
 * covers a 4K screen at 1× and an 8K screen at 2×; beyond it a frame's cost grows past what a calm page should use.
 */
export const MIN_SCREEN = 200;
export const MAX_SCREEN = 4096;

export const RAMP = " .:;t%SX8#@";
export const INK = "rgb(40, 40, 40)";
export const GRID_LINE = "rgba(0, 0, 0, 0.035)";

/** RS-1 */
export function createGrid(width: number, height: number): Grid {
  for (const [name, v] of [["width", width], ["height", height]] as const) {
    if (!(Number.isFinite(v) && v >= MIN_SCREEN && v <= MAX_SCREEN)) {
      throw new RangeError(`screen ${name} must be in [${MIN_SCREEN}, ${MAX_SCREEN}]: ${v}`);
    }
  }
  const cellWidth = Math.min(13, Math.max(8, Math.round(width / 124)));
  const cellHeight = Math.round(cellWidth * 1.45);
  return { width, height, cellWidth, cellHeight, cols: Math.ceil(width / cellWidth), rows: Math.ceil(height / cellHeight) };
}

/** RS-2: 8 fixed sample points inside a cell, as fractions of its width and height. */
export const SAMPLE_OFFSETS: readonly (readonly [number, number])[] = [
  [0.25, 0.0625],
  [0.75, 0.1875],
  [0.25, 0.3125],
  [0.75, 0.4375],
  [0.25, 0.5625],
  [0.75, 0.6875],
  [0.25, 0.8125],
  [0.75, 0.9375],
];

/** C-2: values outside [0, 1] behave as the nearest end; NaN behaves as 0. */
export const clamp01 = (b: number): number => (b > 0 ? (b < 1 ? b : 1) : 0);

/** RS-3 */
export function glyphFor(b: number): string {
  return RAMP[Math.min(10, Math.floor(11 * clamp01(b)))]!;
}

/** RS-3: a grey with lightness 1 − 0.25 × b. */
export function backgroundFor(b: number): string {
  const v = Math.round(255 * (1 - 0.25 * clamp01(b)));
  return `rgb(${v}, ${v}, ${v})`;
}

/** RS-2: the mean of the field at the 8 sample points of the cell. */
export function cellBrightness(field: Field, grid: Grid, col: number, row: number): number {
  const x0 = col * grid.cellWidth;
  const y0 = row * grid.cellHeight;
  let sum = 0;
  for (const [ox, oy] of SAMPLE_OFFSETS) sum += clamp01(field.brightness(x0 + ox * grid.cellWidth, y0 + oy * grid.cellHeight));
  return sum / SAMPLE_OFFSETS.length;
}

/** Cells in row-major order. */
export function rasterize(field: Field, grid: Grid): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const b = cellBrightness(field, grid, col, row);
      cells.push({ glyph: glyphFor(b), background: backgroundFor(b), ink: INK });
    }
  }
  return cells;
}

/** RS-2: every cell's 8 sample points as x, y pairs, cell by cell in row-major order, for a field prepared once. */
export function samplePoints(grid: Grid): Float64Array {
  const points = new Float64Array(grid.cols * grid.rows * SAMPLE_OFFSETS.length * 2);
  let k = 0;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      for (const [ox, oy] of SAMPLE_OFFSETS) {
        points[k++] = (col + ox) * grid.cellWidth;
        points[k++] = (row + oy) * grid.cellHeight;
      }
    }
  }
  return points;
}

/** RS-4: a galaxy cell shows a colour while its roll is below this, so about this share of the galaxy is coloured. */
export const GLINT_SHARE = 0.035;
/** RS-4: only cells brighter than this are galaxy cells that may glint. */
export const GLINT_MIN_BRIGHTNESS = 0.1;
/** RS-4: faint inks, blue and pink in the arms, amber in the core. */
export const GLINT_INK = { blue: "rgb(84, 124, 204)", pink: "rgb(214, 112, 160)", amber: "rgb(212, 146, 48)" } as const;

/** RS-4: a cell's re-roll interval (2 + u s) and the offset of its clock (u′ × interval), from uniform u, u′ in [0, 1). */
export const glintTiming = (u: number, u2: number): { interval: number; offset: number } => {
  const interval = 2 + u;
  return { interval, offset: u2 * interval };
};

/** RS-4: each cell's clock, in row-major order, and the seed of its rolls. */
export interface GlintClocks {
  interval: Float64Array;
  offset: Float64Array;
  seed: number;
}

/** RS-4: one clock per cell, from two draws each, then the seed of the rolls. */
export function createGlintClocks(count: number, rng: { next(): number }): GlintClocks {
  const interval = new Float64Array(count);
  const offset = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const timing = glintTiming(rng.next(), rng.next());
    interval[i] = timing.interval;
    offset[i] = timing.offset;
  }
  return { interval, offset, seed: Math.floor(rng.next() * 2 ** 32) | 0 };
}

/** Integer hash → [0, 1) */
function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** RS-4: the epoch of cell i's clock at time t; the cell re-rolls when it changes. */
export const glintEpoch = (clocks: GlintClocks, i: number, t: number): number => Math.floor((t + clocks.offset[i]!) / clocks.interval[i]!);

/** RS-4: cell i's roll in [0, 1) at time t, drawn afresh in each epoch. */
export const glintRoll = (clocks: GlintClocks, i: number, t: number): number => hash3(i, glintEpoch(clocks, i, t), clocks.seed);

/** RS-4: a galaxy cell is in the core or the arms and brighter than GLINT_MIN_BRIGHTNESS. */
export const isGalaxyCell = (region: number, b: number): boolean => region !== Region.none && b > GLINT_MIN_BRIGHTNESS;

/** RS-4: the colour cell i shows when it is selected: amber in the core, blue or pink in the arms. */
function glintColour(clocks: GlintClocks, i: number, region: number, t: number): string {
  if (region === Region.core) return GLINT_INK.amber;
  return hash3(i, glintEpoch(clocks, i, t), clocks.seed ^ 0x5bd1e995) < 0.5 ? GLINT_INK.blue : GLINT_INK.pink;
}

/**
 * RS-4: each cell's ink at time t, from its brightness and region: a galaxy cell whose roll is below GLINT_SHARE
 * shows a colour, each cell on its own, so a cell's ink changes only at its own clock's boundaries or when it starts
 * or stops being a galaxy cell. All other cells keep INK.
 */
export function glintInks(brightness: ArrayLike<number>, regions: ArrayLike<number>, clocks: GlintClocks, t: number): string[] {
  const count = brightness.length;
  if (regions.length !== count || clocks.interval.length !== count) throw new RangeError(`expected glints for ${count} cells`);
  return Array.from({ length: count }, (_, i) =>
    isGalaxyCell(regions[i]!, brightness[i]!) && glintRoll(clocks, i, t) < GLINT_SHARE ? glintColour(clocks, i, regions[i]!, t) : INK,
  );
}

/** RS-4: what M01 prepares once per screen size for the glints, and the time of the draw. */
export interface Glints {
  regions: Uint8Array;
  clocks: GlintClocks;
  t: number;
}

/** The same cells as rasterize, from the field's values at samplePoints(grid); with glints, some inks are coloured (RS-4). */
export function cellsFromSamples(values: ArrayLike<number>, grid: Grid, glints?: Glints): Cell[] {
  const per = SAMPLE_OFFSETS.length;
  const count = grid.cols * grid.rows;
  if (values.length !== count * per) throw new RangeError(`expected ${count * per} samples, got ${values.length}`);
  const brightness = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let k = 0; k < per; k++) sum += clamp01(values[i * per + k]!);
    brightness[i] = sum / per;
  }
  const inks = glints ? glintInks(brightness, glints.regions, glints.clocks, glints.t) : null;
  return Array.from(brightness, (b, i) => ({ glyph: glyphFor(b), background: backgroundFor(b), ink: inks ? inks[i]! : INK }));
}
