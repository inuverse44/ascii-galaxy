import { describe, expect, it } from "vitest";
import { glintRandom } from "../manager/ambience";
import { createRandom } from "../util/random";
import { flareEnvelope } from "./events";
import {
  GLINT_INK,
  INK,
  MAX_SCREEN,
  MIN_SCREEN,
  Region,
  cellBrightness,
  cellsFromSamples,
  createGlintClocks,
  createGrid,
  glintEpoch,
  glyphFor,
  isGalaxyCell,
  rasterize,
  samplePoints,
  type Grid,
} from "./raster";
import {
  ARM_FLOOR,
  FLARE_GAIN,
  FLARE_REACH,
  type Glow,
  PATTERN_PERIOD,
  type Sky,
  armPattern,
  cellRegions,
  createSky,
  discTerms,
  regionAt,
  screenToPlane,
  noiseLayer,
  patternAngle,
  planeToScreen,
  prepareSkyField,
  skyField,
  twinkle,
  twinkleTiming,
} from "./sky";

const SEEDS = [1, 2, 3, 4, 5];
const sky = (grid: Grid, seed: number) => createSky(grid, createRandom(seed));
const galaxyOnly = (s: Sky): Sky => ({ ...s, stars: [], smudges: [] });

/**
 * `count` times across one full turn of the arm pattern (SK-2), one in each equal step, each at a seeded random
 * offset within its step: a defect confined to fixed instants (multiples of the step) cannot hide between them.
 */
function turnTimes(count: number): number[] {
  const rng = createRandom(99);
  const step = PATTERN_PERIOD / count;
  return Array.from({ length: count }, (_, k) => (k + rng.next()) * step);
}

describe("SK-1 brightness field", () => {
  it("is highest at the center; along every ray, outside the arms, it falls with radius, at times through a turn", () => {
    for (const seed of SEEDS) {
      const s = galaxyOnly(sky(createGrid(1440, 900), seed));
      for (const t of [0, ...turnTimes(16)]) {
        const field = skyField(s, t);
        const at = (u: number, v: number) => field.brightness(...planeToScreen(s.galaxy, u, v));
        expect(at(0, 0)).toBe(1);
        for (let k = 0; k < 36; k++) {
          const a = (2 * Math.PI * k) / 36;
          // Points on this ray outside the arms (arm pattern below 0.001), in order of radius
          let previous = Number.POSITIVE_INFINITY;
          let outside = 0;
          for (let r = 0.05; r < 0.97; r += 0.01) {
            const [u, v] = [r * Math.cos(a), r * Math.sin(a)];
            if (armPattern(u, v, t) >= 1e-3) continue;
            const b = at(u, v);
            expect(b, `seed ${seed}, t ${t}, ray ${k}, r ${r}`).toBeLessThan(previous);
            previous = b;
            outside++;
          }
          expect(outside, `seed ${seed}, t ${t}, ray ${k}`).toBeGreaterThan(5); // the ray really leaves the arms
        }
        // Outside the disc the galaxy adds nothing
        expect(at(1.01, 0)).toBe(0);
        expect(at(0, -1.2)).toBe(0);
      }
    }
  });
});

describe("SK-1 the drawn field is core + disc × arm strength, from the tested arm pattern and noise layer", () => {
  it("at 2000 random points of the disc and times, the field equals the formula built from armPattern and noiseLayer", () => {
    const s = galaxyOnly(sky(createGrid(1440, 900), 3));
    const rng = createRandom(11);
    for (let i = 0; i < 2000; i++) {
      const r = 0.98 * Math.sqrt(rng.next());
      const a = 2 * Math.PI * rng.next();
      const t = 600 * rng.next();
      const [x, y] = planeToScreen(s.galaxy, r * Math.cos(a), r * Math.sin(a));
      const [u, v] = screenToPlane(s.galaxy, x, y); // the plane point the field itself sees
      const { core, disc } = discTerms(Math.hypot(u, v));
      const strength = ARM_FLOOR + (1 - ARM_FLOOR) * armPattern(u, v, t) * (0.45 + 1.1 * noiseLayer(s.galaxy, u, v, t));
      expect(skyField(s, t).brightness(x, y)).toBeCloseTo(Math.min(1, core + disc * strength), 12);
    }
  });
});

describe("SK-2 arms turn rigidly", () => {
  it("the pattern turns 360° in 600 s, and the arm pattern at t + Δ is the pattern at t rotated by the angle for Δ", () => {
    expect(patternAngle(PATTERN_PERIOD)).toBeCloseTo(2 * Math.PI, 12);
    expect(PATTERN_PERIOD).toBeGreaterThanOrEqual(570);
    expect(PATTERN_PERIOD).toBeLessThanOrEqual(630);
    const rng = createRandom(5);
    for (let i = 0; i < 2000; i++) {
      const r = 0.05 + 0.9 * rng.next();
      const a = 2 * Math.PI * rng.next();
      const t = 600 * rng.next();
      const dt = 60 * rng.next();
      const turned = a + patternAngle(dt);
      expect(armPattern(r * Math.cos(turned), r * Math.sin(turned), t + dt)).toBeCloseTo(armPattern(r * Math.cos(a), r * Math.sin(a), t), 9);
    }
  });
});

describe("SK-3 the noise flows slower farther out", () => {
  /** The angle the noise at radius r has moved through from t to t + dt, found by matching a ring of samples. */
  function measuredShift(s: Sky, r: number, t: number, dt: number): number {
    const ring = (time: number, offset: number) =>
      Array.from({ length: 720 }, (_, k) => {
        const a = (2 * Math.PI * k) / 720 + offset;
        return noiseLayer(s.galaxy, r * Math.cos(a), r * Math.sin(a), time);
      });
    const base = ring(t, 0);
    let best = 0;
    let bestError = Number.POSITIVE_INFINITY;
    // Shifts from 0 to 0.2 rad in steps of 0.0005 rad
    for (let k = 0; k <= 400; k++) {
      const shift = k * 0.0005;
      const later = ring(t + dt, shift);
      const error = later.reduce((sum, v, i) => sum + (v - base[i]!) ** 2, 0);
      if (error < bestError) [best, bestError] = [shift, error];
    }
    return best;
  }

  it("measured angular speed strictly decreases from the inner third to the outer third", () => {
    for (const seed of [1, 2, 3]) {
      const s = sky(createGrid(1440, 900), seed);
      for (const t of [0, 250]) {
        const speeds = [0.2, 0.4, 0.6, 0.8].map((r) => measuredShift(s, r, t, 10) / 10);
        for (let k = 1; k < speeds.length; k++) expect(speeds[k], `seed ${seed}, t ${t}`).toBeLessThan(speeds[k - 1]!);
        expect(speeds.every((w) => w > 0)).toBe(true);
      }
    }
  });
});

describe("SK-6 twinkle", () => {
  it("period 5 + 3u and phase 2πu′, checked at fixed u and u′", () => {
    for (const [u, period] of [[0, 5], [0.5, 6.5], [0.999, 7.997]] as const) expect(twinkleTiming(u, 0).period).toBeCloseTo(period, 12);
    for (const [u2, phase] of [[0, 0], [0.25, Math.PI / 2], [0.5, Math.PI], [0.999, 2 * Math.PI * 0.999]] as const) {
      expect(twinkleTiming(0, u2).phase).toBeCloseTo(phase, 12);
    }
  });

  it("createSky takes each star's period and phase from two of its own consecutive random draws, through the formula", () => {
    for (const seed of SEEDS) {
      const real = createRandom(seed);
      const drawn: number[] = [];
      const spy = { next: () => drawn[drawn.push(real.next()) - 1]! };
      const s = createSky(createGrid(1440, 900), spy);
      let from = 0;
      for (const star of s.stars) {
        let k = from;
        while (k + 1 < drawn.length && !(star.period === twinkleTiming(drawn[k]!, 0).period && star.phase === twinkleTiming(0, drawn[k + 1]!).phase)) k++;
        expect(k + 1 < drawn.length, `seed ${seed}: star (${star.x}, ${star.y}) has no matching pair of draws`).toBe(true);
        from = k + 2; // each star's pair comes after the previous star's
      }
    }
  });

  it("each star's measured period over 60 s matches its own; periods cover both halves of [5, 8]; phases cover all four quarters", () => {
    const periods: number[] = [];
    const phases: number[] = [];
    for (const seed of SEEDS) {
      const s = sky(createGrid(1440, 900), seed);
      for (const star of s.stars) {
        periods.push(star.period);
        phases.push(star.phase);
        // Times of upward crossings of the mean (0.8) over 60 s, at 0.01 s
        const crossings: number[] = [];
        let previous = twinkle(star, 0) - 0.8;
        for (let k = 1; k <= 6000; k++) {
          const t = k / 100;
          const value = skyField({ ...s, galaxy: { ...s.galaxy, cx: -1e7 }, smudges: [], stars: [star] }, t).brightness(star.x, star.y) / star.amplitude - 0.8;
          if (previous < 0 && value >= 0) crossings.push(t);
          previous = value;
        }
        const measured = (crossings.at(-1)! - crossings[0]!) / (crossings.length - 1);
        expect(Math.abs(measured - star.period)).toBeLessThan(0.02);
      }
    }
    expect(periods.some((p) => p < 6.5) && periods.some((p) => p >= 6.5)).toBe(true);
    for (let q = 0; q < 4; q++) expect(phases.some((ph) => ph >= (q * Math.PI) / 2 && ph < ((q + 1) * Math.PI) / 2)).toBe(true);
    // No two stars of a sky twinkle in step
    for (const seed of SEEDS) {
      const s = sky(createGrid(1440, 900), seed);
      const keys = s.stars.map((st) => `${st.period.toFixed(6)}:${st.phase.toFixed(6)}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("stars sharing a cell", () => {
  it("both add their brightness, in skyField and in the prepared field", () => {
    const grid = createGrid(1440, 900);
    const s = sky(grid, 1);
    const star = { ...s.stars[0]!, amplitude: 0.2 };
    const one: Sky = { ...galaxyOnly(s), galaxy: { ...s.galaxy, cx: -1e7 }, stars: [star] };
    const two: Sky = { ...one, stars: [star, { ...star, amplitude: 0.3 }] };
    const single = skyField(one, 0).brightness(star.x, star.y);
    const double = skyField(two, 0).brightness(star.x, star.y);
    expect(single).toBeGreaterThan(0);
    expect(double).toBeCloseTo(single * 2.5, 12);
    const points = Float64Array.of(star.x, star.y);
    expect(prepareSkyField(two, points)(0)[0]).toBe(double);
  });
});

describe("prepared field", () => {
  it("prepareSkyField and cellsFromSamples give the same values and cells as skyField and rasterize, with and without flares", () => {
    for (const [w, h] of [[1440, 900], [390, 844], [MIN_SCREEN, MIN_SCREEN]] as const) {
      const grid = createGrid(w, h);
      for (const seed of [1, 2]) {
        const s = sky(grid, seed);
        const points = samplePoints(grid);
        const prepared = prepareSkyField(s, points);
        // Flares on the first, a middle, and the last star, at several levels; the same star twice keeps the higher
        const n = s.stars.length;
        const glowSets: Glow[][] = [[], [{ star: 0, level: 1 }, { star: n >> 1, level: 0.37 }, { star: n - 1, level: 0.8 }, { star: n - 1, level: 0.2 }]];
        for (const glows of glowSets) {
          for (const t of [0, 3.7, 123.4, 599.9]) {
            const values = prepared(t, glows);
            const field = skyField(s, t, glows);
            for (let i = 0; i < values.length; i++) expect(values[i]).toBe(field.brightness(points[2 * i]!, points[2 * i + 1]!));
            expect(cellsFromSamples(values, grid)).toEqual(rasterize(field, grid));
          }
        }
        // The flares really changed some values
        expect(prepared(0, glowSets[1]!)).not.toEqual(prepared(0));
      }
    }
  });
});

describe("SK-7 a flare brightens its star", () => {
  /** Points around (x, y) at `cells` cell units in 8 directions. */
  const around = (grid: Grid, x: number, y: number, cells: number): [number, number][] =>
    Array.from({ length: 8 }, (_, k) => {
      const a = (Math.PI * k) / 4;
      return [x + cells * Math.cos(a) * grid.cellWidth, y + cells * Math.sin(a) * grid.cellHeight];
    });

  it("adds level × 1.2 × exp(−d / 0.6), clamped to 1, out to two cells, following the envelope", () => {
    const grid = createGrid(1440, 900);
    const levels = [0, 0.25, 1, ...Array.from({ length: 41 }, (_, k) => flareEnvelope(k * 0.5))];
    expect(FLARE_GAIN).toBe(1.2);
    for (const seed of SEEDS) {
      const s = sky(grid, seed);
      s.stars.forEach((star, index) => {
        const alone: Sky = { ...galaxyOnly(s), galaxy: { ...s.galaxy, cx: -1e7 }, stars: [star] };
        const t = 1.3;
        const without = skyField(alone, t);
        for (const level of levels) {
          const withFlare = skyField(alone, t, [{ star: 0, level }]);
          for (const cells of [0, 0.5, 1, 1.9]) {
            for (const [x, y] of cells === 0 ? [[star.x, star.y] as [number, number]] : around(grid, star.x, star.y, cells)) {
              const d = ((x - star.x) / grid.cellWidth) ** 2 + ((y - star.y) / grid.cellHeight) ** 2;
              const expected = Math.min(1, without.brightness(x, y) + level * 1.2 * Math.exp(-d / 0.6));
              expect(withFlare.brightness(x, y), `seed ${seed} star ${index} level ${level} at ${cells} cells`).toBeCloseTo(expected, 12);
            }
          }
          for (const cells of [2.1, 3]) {
            for (const [x, y] of around(grid, star.x, star.y, cells)) expect(withFlare.brightness(x, y)).toBe(without.brightness(x, y));
          }
        }
      });
    }
  });

  it("at the peak, in the real sky, the star's cell draws @ and a cell beside it draws a glyph; stars 2 cells away are unchanged", () => {
    const grid = createGrid(1440, 900);
    for (const seed of SEEDS) {
      const s = sky(grid, seed);
      s.stars.forEach((star, index) => {
        const t = 2.4;
        const peak = skyField(s, t, [{ star: index, level: flareEnvelope(8) }]);
        const plain = skyField(s, t);
        const col = Math.floor(star.x / grid.cellWidth);
        const row = Math.floor(star.y / grid.cellHeight);
        expect(glyphFor(cellBrightness(peak, grid, col, row)), `seed ${seed} star ${index}`).toBe("@");
        const beside = [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]].filter(([c, r]) => c! >= 0 && r! >= 0 && c! < grid.cols && r! < grid.rows);
        expect(beside.some(([c, r]) => glyphFor(cellBrightness(peak, grid, c!, r!)) !== " "), `seed ${seed} star ${index}`).toBe(true);
        for (const other of s.stars) {
          const d = ((other.x - star.x) / grid.cellWidth) ** 2 + ((other.y - star.y) / grid.cellHeight) ** 2;
          if (d >= FLARE_REACH) expect(peak.brightness(other.x, other.y)).toBe(plain.brightness(other.x, other.y));
        }
      });
    }
  });

  it("ignores flares on stars that do not exist", () => {
    const grid = createGrid(1440, 900);
    const s = sky(grid, 1);
    const values = prepareSkyField(s, samplePoints(grid));
    expect(values(5, [{ star: -1, level: 1 }, { star: s.stars.length, level: 1 }])).toEqual(values(5));
  });
});

describe("SK-8 regions", () => {
  it("core below plane radius 0.2, arm below 1, none beyond; a cell's region is its center's", () => {
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      const grid = createGrid(w, h);
      for (const seed of SEEDS) {
        const s = sky(grid, seed);
        const counts = { core: 0, arm: 0 };
        for (let y = 0; y < h; y += 4) {
          for (let x = 0; x < w; x += 4) {
            const r = Math.hypot(...screenToPlane(s.galaxy, x, y));
            const expected = r < 0.2 ? Region.core : r < 1 ? Region.arm : Region.none;
            expect(regionAt(s, x, y)).toBe(expected);
            if (expected === Region.core) counts.core++;
            if (expected === Region.arm) counts.arm++;
          }
        }
        expect(counts.core).toBeGreaterThan(0);
        expect(counts.arm).toBeGreaterThan(0);
        const regions = cellRegions(s, grid);
        expect(regions).toHaveLength(grid.cols * grid.rows);
        regions.forEach((region, i) => {
          expect(region).toBe(regionAt(s, ((i % grid.cols) + 0.5) * grid.cellWidth, (Math.floor(i / grid.cols) + 0.5) * grid.cellHeight));
        });
      }
    }
  }); // about 3.4 s alone (half a million lattice points)
});

describe("RS-4 glints on the galaxy", () => {
  it("on average 2–5% of the galaxy's cells are coloured, only galaxy cells, blue and pink in the arms, amber in the core", () => {
    const rng = createRandom(77);
    const times = Array.from({ length: 100 }, () => 600 * rng.next());
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      const grid = createGrid(w, h);
      for (const seed of SEEDS) {
        const s = sky(grid, seed);
        const prepared = prepareSkyField(s, samplePoints(grid));
        const regions = cellRegions(s, grid);
        const clocks = createGlintClocks(grid.cols * grid.rows, glintRandom(seed));
        const shares: number[] = [];
        const inks = new Set<string>();
        for (const t of times) {
          const values = prepared(t);
          const cells = cellsFromSamples(values, grid, { regions, clocks, t });
          let galaxy = 0;
          let coloured = 0;
          cells.forEach((cell, i) => {
            let sum = 0;
            for (let k = 0; k < 8; k++) sum += values[i * 8 + k]!;
            const isGalaxy = regions[i] !== Region.none && sum / 8 > 0.1;
            if (isGalaxy) galaxy++;
            if (cell.ink === INK) return;
            inks.add(cell.ink);
            expect(isGalaxy, `seed ${seed} t ${t} cell ${i}`).toBe(true);
            coloured++;
            if (cell.ink === GLINT_INK.amber) expect(regions[i]).toBe(Region.core);
            else expect(regions[i]).toBe(Region.arm);
          });
          expect(galaxy).toBeGreaterThan(0);
          shares.push(coloured / galaxy);
        }
        const mean = shares.reduce((a, b) => a + b) / shares.length;
        expect(mean, `${w}×${h} seed ${seed}`).toBeGreaterThanOrEqual(0.02);
        expect(mean, `${w}×${h} seed ${seed}`).toBeLessThanOrEqual(0.05);
        expect(inks, `${w}×${h} seed ${seed}`).toEqual(new Set([GLINT_INK.blue, GLINT_INK.pink, GLINT_INK.amber]));
      }
    }
  });

  it("a cell's shown ink changes only at its own clock's boundaries or when it starts or stops being a galaxy cell", () => {
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      const grid = createGrid(w, h);
      for (const seed of [1, 2]) {
        const s = sky(grid, seed);
        const prepared = prepareSkyField(s, samplePoints(grid));
        const regions = cellRegions(s, grid);
        const clocks = createGlintClocks(grid.cols * grid.rows, glintRandom(seed));
        // Draws 12 times a second for 30 s, from a seeded start, as M01 makes them
        const t0 = 600 * createRandom(seed + 9).next();
        const frame = (t: number) => {
          const values = prepared(t);
          const cells = cellsFromSamples(values, grid, { regions, clocks, t });
          const galaxy = cells.map((_, i) => {
            let sum = 0;
            for (let k = 0; k < 8; k++) sum += values[i * 8 + k]!;
            return isGalaxyCell(regions[i]!, sum / 8);
          });
          return { inks: cells.map((c) => c.ink), galaxy };
        };
        let previous = frame(t0);
        const counts = { own: 0, membership: 0 };
        for (let k = 1; k <= 360; k++) {
          const [ta, tb] = [t0 + (k - 1) / 12, t0 + k / 12];
          const now = frame(tb);
          now.inks.forEach((ink, i) => {
            if (ink === previous.inks[i]) return;
            const own = glintEpoch(clocks, i, tb) !== glintEpoch(clocks, i, ta);
            const membership = now.galaxy[i] !== previous.galaxy[i];
            expect(own || membership, `${w}×${h} seed ${seed} cell ${i} at ${tb}`).toBe(true);
            if (own) counts.own++;
            else counts.membership++;
          });
          previous = now;
        }
        expect(counts.own, `${w}×${h} seed ${seed}`).toBeGreaterThan(0);
      }
    }
  });
});

/** The largest and smallest widths of a point set over 360 directions. */
function widths(points: readonly (readonly [number, number])[]): { major: number; minor: number } {
  let major = 0;
  let minor = Number.POSITIVE_INFINITY;
  for (let k = 0; k < 360; k++) {
    const a = (Math.PI * k) / 360;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const [x, y] of points) {
      const p = x * c + y * sn;
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
    major = Math.max(major, hi - lo);
    minor = Math.min(minor, hi - lo);
  }
  return { major, minor };
}

/** SK-4: the drawn galaxy's widest extent, at any time, is at least this fraction of the disc's diameter. */
const DRAWN_MIN = 0.65;

/** 120 times across one full turn: one in each 5 s step, at a seeded offset (#10). */
const TURN_TIMES = turnTimes(120);

/**
 * Measures the galaxy alone. The disc (points brighter than 0, sampled every 2 px) gives the diameter, the center,
 * and the axis ratio; it does not change as the pattern turns. The drawn galaxy (the corners of the cells that draw
 * a glyph) is measured at each of TURN_TIMES: the arms turn, so its outline changes, and the faint disc between the
 * arms draws nothing, so it is smaller than the disc and lopsided.
 */
function measureGalaxy(grid: Grid, seed: number) {
  const s = galaxyOnly(sky(grid, seed));
  // The prepared field gives the same cells as rasterize(skyField(...)) ("prepared field" test), much faster
  const prepared = prepareSkyField(s, samplePoints(grid));
  const drawnCells: Set<number>[] = [];
  const diameters = TURN_TIMES.map((t) => {
    const corners: [number, number][] = [];
    const drawn = new Set<number>();
    cellsFromSamples(prepared(t), grid).forEach((cell, i) => {
      if (cell.glyph === " ") return;
      drawn.add(i);
      const x = (i % grid.cols) * grid.cellWidth;
      const y = Math.floor(i / grid.cols) * grid.cellHeight;
      corners.push([x, y], [x + grid.cellWidth, y], [x, y + grid.cellHeight], [x + grid.cellWidth, y + grid.cellHeight]);
    });
    drawnCells.push(drawn);
    return widths(corners).major;
  });
  const field = skyField(s, 0);
  const disc: [number, number][] = [];
  for (let y = 0; y < grid.height; y += 2) {
    for (let x = 0; x < grid.width; x += 2) {
      if (field.brightness(x, y) > 0) disc.push([x, y]);
    }
  }
  const whole = widths(disc);
  // The disc is a centrally symmetric ellipse, so the middle of its extent is its center
  let [x0, x1, y0, y1] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const [x, y] of disc) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const center = [(x0 + x1) / 2, (y0 + y1) / 2] as const;
  return { center, diameters, drawnCells, discDiameter: whole.major, ratio: whole.minor / whole.major };
}

describe("SK-4 tilt and placement", () => {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    it(`at ${w} × ${h}: center on a third line, disc 50–60% of the width, drawn galaxy at least ${DRAWN_MIN} of the disc all through a turn, axis ratio in [0.6, 0.85]`, () => {
      const grid = createGrid(w, h);
      for (const seed of [...SEEDS, 6, 7, 8, 9, 10]) {
        const { center, diameters, drawnCells, discDiameter, ratio } = measureGalaxy(grid, seed);
        // The drawn outline changes as the arms turn: a quarter turn apart (index 0 and 30, about 150 s), at least
        // 10% of the drawn cells differ
        const [a, b] = [drawnCells[0]!, drawnCells[30]!];
        const changed = [...a].filter((i) => !b.has(i)).length + [...b].filter((i) => !a.has(i)).length;
        expect(changed / Math.max(a.size, b.size), `seed ${seed}`).toBeGreaterThanOrEqual(0.1);
        const [cx, cy] = center;
        const onThird =
          Math.min(Math.abs(cx - w / 3), Math.abs(cx - (2 * w) / 3)) <= grid.cellWidth ||
          Math.min(Math.abs(cy - h / 3), Math.abs(cy - (2 * h) / 3)) <= grid.cellHeight;
        expect(onThird, `seed ${seed}: center ${cx}, ${cy}`).toBe(true);
        expect(discDiameter / w, `seed ${seed}`).toBeGreaterThanOrEqual(0.5);
        expect(discDiameter / w, `seed ${seed}`).toBeLessThanOrEqual(0.6);
        // The arms turn, so the drawn outline changes; it never shrinks below DRAWN_MIN of the disc
        diameters.forEach((d, k) => {
          expect(d / discDiameter, `seed ${seed} at t = ${TURN_TIMES[k]}`).toBeGreaterThanOrEqual(DRAWN_MIN);
          expect(d / discDiameter, `seed ${seed} at t = ${TURN_TIMES[k]}`).toBeLessThanOrEqual(1);
        });
        expect(ratio, `seed ${seed}`).toBeGreaterThanOrEqual(0.6);
        expect(ratio, `seed ${seed}`).toBeLessThanOrEqual(0.85);
      }
    }); // per seed: about 100,000 disc points and 8 rasterized frames, each × 360 directions
  }
});

describe("SK-5 distant galaxies and stars", () => {
  const sizes = [
    [1440, 900],
    [390, 844],
  ] as const;
  it("3–5 distant galaxies of 3–8 visible cells each, and 30–60 stars that each show", () => {
    for (const [w, h] of sizes) {
      const grid = createGrid(w, h);
      for (const seed of SEEDS) {
        const s = sky(grid, seed);
        expect(s.smudges.length).toBeGreaterThanOrEqual(3);
        expect(s.smudges.length).toBeLessThanOrEqual(5);
        expect(s.stars.length).toBeGreaterThanOrEqual(30);
        expect(s.stars.length).toBeLessThanOrEqual(60);
        for (const m of s.smudges) {
          const only: Sky = { ...s, galaxy: { ...s.galaxy, cx: -1e7 }, stars: [], smudges: [m] };
          const cells = rasterize(skyField(only, 0), grid).filter((c) => c.glyph !== " ").length;
          expect(cells, `${w}×${h} seed ${seed}`).toBeGreaterThanOrEqual(3);
          expect(cells, `${w}×${h} seed ${seed}`).toBeLessThanOrEqual(8);
        }
        // Each star's own cell, through the 8-point averaging of RS-2, draws a glyph at t = 0 and at the dimmest
        // point of its twinkle
        for (const star of s.stars) {
          const trough = ((((1.5 * Math.PI - star.phase) / (2 * Math.PI)) % 1) + 1) % 1 * star.period;
          expect(twinkle(star, trough)).toBeCloseTo(0.6, 9);
          for (const t of [0, trough]) {
            const b = cellBrightness(skyField(s, t), grid, Math.floor(star.x / grid.cellWidth), Math.floor(star.y / grid.cellHeight));
            expect(glyphFor(b), `${w}×${h} seed ${seed} star (${star.x}, ${star.y}) at t = ${t}`).not.toBe(" ");
          }
        }
      }
    }
  });
});

describe("SK-5 at the corners of the screen range", () => {
  it("3–5 distant galaxies and 30–60 stars", () => {
    for (const [w, h] of [
      [MIN_SCREEN, MIN_SCREEN],
      [MIN_SCREEN, MAX_SCREEN],
      [MAX_SCREEN, MIN_SCREEN],
      [MAX_SCREEN, MAX_SCREEN],
    ] as const) {
      for (const seed of SEEDS) {
        const s = sky(createGrid(w, h), seed);
        expect(s.smudges.length, `${w}×${h} seed ${seed}`).toBeGreaterThanOrEqual(3);
        expect(s.smudges.length, `${w}×${h} seed ${seed}`).toBeLessThanOrEqual(5);
        expect(s.stars.length, `${w}×${h} seed ${seed}`).toBeGreaterThanOrEqual(30);
        expect(s.stars.length, `${w}×${h} seed ${seed}`).toBeLessThanOrEqual(60);
      }
    }
  });

  it("a star alone draws nothing in the eight cells around its own, even at its brightest", () => {
    const grid = createGrid(1440, 900);
    const s = sky(grid, 1);
    for (const star of s.stars) {
      const brightest: Sky = { ...galaxyOnly(s), galaxy: { ...s.galaxy, cx: -1e7 }, stars: [{ ...star, amplitude: 0.8 }] };
      const peak = ((((0.5 * Math.PI - star.phase) / (2 * Math.PI)) % 1) + 1) % 1 * star.period;
      const field = skyField(brightest, peak);
      const col = Math.floor(star.x / grid.cellWidth);
      const row = Math.floor(star.y / grid.cellHeight);
      for (const [dc, dr] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
        if (col + dc < 0 || row + dr < 0 || col + dc >= grid.cols || row + dr >= grid.rows) continue;
        expect(glyphFor(cellBrightness(field, grid, col + dc, row + dr))).toBe(" ");
      }
    }
  });
});

describe("C-2 field range, at the edges of the screen range", () => {
  const screens = [
    [MIN_SCREEN, MIN_SCREEN],
    [MIN_SCREEN, MAX_SCREEN],
    [MAX_SCREEN, MIN_SCREEN],
    [MAX_SCREEN, MAX_SCREEN],
    [390, 844],
    [1440, 900],
  ] as const;
  it("every value is finite and in [0, 1], at the center, at random points, and at random times, flare peaks included", () => {
    for (const [w, h] of screens) {
      const grid = createGrid(w, h);
      for (const seed of SEEDS) {
        const s = sky(grid, seed);
        const rng = createRandom(seed + 100);
        // Each star and the points beside it (where its flare glows), the center, and random points
        const points: [number, number][] = [[s.galaxy.cx, s.galaxy.cy]];
        for (const st of s.stars) {
          const [cw, ch] = [grid.cellWidth, grid.cellHeight];
          points.push([st.x, st.y], [st.x - cw, st.y], [st.x + cw, st.y], [st.x, st.y - ch], [st.x, st.y + ch]);
        }
        for (let i = 0; i < 100; i++) points.push([rng.next() * w, rng.next() * h]);
        // Every other time, every star is at the peak of a flare
        const peaks: Glow[] = s.stars.map((_, star) => ({ star, level: flareEnvelope(8) }));
        for (let i = 0; i < 100; i++) {
          const field = skyField(s, rng.next() * 3600, i % 2 === 0 ? peaks : []);
          for (const [x, y] of i % 2 === 0 ? points : points.slice(i % 3, i % 3 + 40)) {
            const b = field.brightness(x, y);
            expect(Number.isFinite(b)).toBe(true);
            expect(b).toBeGreaterThanOrEqual(0);
            expect(b).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  }); // at the peaks every point is checked

  it("the galaxy fits vertically on very wide screens and stays on screen", () => {
    for (const [w, h] of screens) {
      const grid = createGrid(w, h);
      for (const seed of SEEDS) {
        const { galaxy: g } = sky(grid, seed);
        expect(g.cx).toBeGreaterThan(0);
        expect(g.cx).toBeLessThan(w);
        expect(g.cy).toBeGreaterThan(0);
        expect(g.cy).toBeLessThan(h);
        const halfHeight = g.radius * Math.hypot(Math.sin(g.positionAngle), g.axisRatio * Math.cos(g.positionAngle));
        expect(halfHeight).toBeLessThanOrEqual(0.46 * h + 1e-9);
      }
    }
  });
});
