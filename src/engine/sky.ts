// E01 SkyEngine: what is in the sky, as a brightness field over screen pixels (docs/02-detailed-design.md SK-1–SK-8).
// Pure: the sky is plain data made from a screen size and a random source; the field is a function of it, time, and
// the flares in progress.

import { type Random, between, integer } from "../util/random";
import { type Field, type Grid, Region } from "./raster";

/** SK-2: one full turn of the arm pattern, in seconds. */
export const PATTERN_PERIOD = 600;
const ARMS = 2;
const TAN_PITCH = Math.tan((16 * Math.PI) / 180);
/** Inter-arm level: the disc still shows faintly between the arms. */
export const ARM_FLOOR = 0.18;

export interface Galaxy {
  /** Center on screen, px */
  cx: number;
  cy: number;
  /** Semi-major axis on screen, px */
  radius: number;
  /** On-screen minor/major axis ratio (SK-4) */
  axisRatio: number;
  /** Angle of the major axis on screen, radians */
  positionAngle: number;
  noiseSeed: number;
}

/** A distant galaxy: a small elliptical smudge (SK-5). */
export interface Smudge {
  x: number;
  y: number;
  /** Half-axes, px */
  ax: number;
  ay: number;
  angle: number;
  amplitude: number;
}

export interface Star {
  x: number;
  y: number;
  amplitude: number;
  /** SK-6: twinkle period in seconds and phase in radians */
  period: number;
  phase: number;
}

export interface Sky {
  galaxy: Galaxy;
  smudges: Smudge[];
  stars: Star[];
  cellWidth: number;
  cellHeight: number;
}

/** SK-4: the galaxy's center, size, tilt. Landscape: on the left or right third line; portrait: on the upper third line. */
function placeGalaxy(grid: Grid, rng: Random): Galaxy {
  const { width: w, height: h } = grid;
  const axisRatio = between(rng, 0.65, 0.8);
  const positionAngle = (between(rng, -28, -12) * Math.PI) / 180;
  // The disc (the galaxy's extent, r < 1) spans 54–60% of the width; the drawn part is smaller and changes as the
  // arms turn, because the faint disc between the arms draws no glyph. On very wide screens the disc is reduced so
  // the galaxy fits vertically.
  const halfHeightFactor = Math.hypot(Math.sin(positionAngle), axisRatio * Math.cos(positionAngle));
  const radius = Math.min((between(rng, 0.54, 0.6) * w) / 2, (0.46 * h) / halfHeightFactor);
  const landscape = w >= h;
  const cx = landscape ? (rng.next() < 0.5 ? w / 3 : (2 * w) / 3) : w / 2;
  const cy = landscape ? h / 2 : h / 3;
  return { cx, cy, radius, axisRatio, positionAngle, noiseSeed: integer(rng, 0, 0x7fffffff) };
}

/** Screen px → coordinates in the galaxy plane, in units of its radius (r = 1 is the edge of the disc). */
export function screenToPlane(g: Galaxy, x: number, y: number): [number, number] {
  const dx = x - g.cx;
  const dy = y - g.cy;
  const c = Math.cos(g.positionAngle);
  const s = Math.sin(g.positionAngle);
  return [(dx * c + dy * s) / g.radius, (-dx * s + dy * c) / (g.radius * g.axisRatio)];
}

export function planeToScreen(g: Galaxy, u: number, v: number): [number, number] {
  const p = u * g.radius;
  const q = v * g.radius * g.axisRatio;
  const c = Math.cos(g.positionAngle);
  const s = Math.sin(g.positionAngle);
  return [g.cx + p * c - q * s, g.cy + p * s + q * c];
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Integer hash → [0, 1) */
function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1) */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** SK-2: the angle the arm pattern has turned by at time t. */
export const patternAngle = (t: number): number => (2 * Math.PI * t) / PATTERN_PERIOD;

/** SK-3: angular speed of the noise layer, decreasing with radius (rad/s). */
export const noiseAngularSpeed = (r: number): number => (2 * Math.PI * (1.6 - Math.min(1, r))) / PATTERN_PERIOD;

/**
 * What does not change with time at a point of the galaxy plane. The field is computed from it, either point by
 * point (skyField) or for a fixed set of points prepared once per screen size (prepareSkyField); both use the same
 * functions below, so they give the same values.
 */
interface PlanePoint {
  r: number;
  theta: number;
  /** ln r / tan(pitch), the spiral's angle offset at this radius */
  spiral: number;
  /** Fades the arms into the core */
  armFade: number;
  /** SK-3 */
  omega: number;
  /** SK-1: core and disc terms; zero outside the disc */
  core: number;
  disc: number;
}

/** SK-1: the core (exponential fall-off) and disc terms at radius r; both zero outside the disc. */
export function discTerms(r: number): { core: number; disc: number } {
  if (!(r < 1)) return { core: 0, disc: 0 };
  return { core: Math.exp(-r / 0.05) + 0.3 * Math.exp(-((r / 0.16) ** 2)), disc: 0.95 * Math.exp(-r / 0.55) * (1 - smoothstep(0.75, 1, r)) };
}

function planePoint(u: number, v: number): PlanePoint {
  const r = Math.hypot(u, v);
  return {
    r,
    theta: Math.atan2(v, u),
    spiral: Math.log(Math.max(r, 1e-3)) / TAN_PITCH,
    armFade: smoothstep(0.04, 0.2, r),
    omega: noiseAngularSpeed(r),
    ...discTerms(r),
  };
}

// The formula takes plain numbers, so the prepared field can keep them in typed arrays and call the same code
const armValue = (theta: number, spiral: number, armFade: number, t: number): number => {
  const phi = ARMS * (theta - spiral - patternAngle(t));
  return ((1 + Math.cos(phi)) / 2) ** 2 * armFade;
};

const noiseValue = (seed: number, r: number, theta: number, omega: number, t: number): number => {
  const a = theta - omega * t;
  return valueNoise(14 * r * Math.cos(a) + 50, 14 * r * Math.sin(a) + 50, seed);
};

/** SK-1: core + disc × arm strength. The noise is applied to the arms only, so the inter-arm level falls smoothly with radius. */
const galaxyValue = (
  seed: number,
  r: number,
  theta: number,
  spiral: number,
  armFade: number,
  omega: number,
  core: number,
  disc: number,
  t: number,
): number => (r >= 1 ? 0 : core + disc * (ARM_FLOOR + (1 - ARM_FLOOR) * armValue(theta, spiral, armFade, t) * (0.45 + 1.1 * noiseValue(seed, r, theta, omega, t))));

const armAt = (p: PlanePoint, t: number): number => armValue(p.theta, p.spiral, p.armFade, t);
const noiseAt = (g: Galaxy, p: PlanePoint, t: number): number => noiseValue(g.noiseSeed, p.r, p.theta, p.omega, t);
const galaxyAt = (g: Galaxy, p: PlanePoint, t: number): number =>
  galaxyValue(g.noiseSeed, p.r, p.theta, p.spiral, p.armFade, p.omega, p.core, p.disc, t);

/** SK-2: the arm pattern in [0, 1] at plane coordinates (u, v): a logarithmic spiral that turns rigidly. */
export const armPattern = (u: number, v: number, t: number): number => armAt(planePoint(u, v), t);

/** SK-3: the particle noise in [0, 1) at plane coordinates (u, v), flowing at an angular speed that falls with radius. */
export const noiseLayer = (g: Galaxy, u: number, v: number, t: number): number => noiseAt(g, planePoint(u, v), t);

/** SK-1: brightness of the galaxy at plane coordinates (u, v) and time t. */
export const galaxyBrightness = (g: Galaxy, u: number, v: number, t: number): number => galaxyAt(g, planePoint(u, v), t);

function smudgeBrightness(m: Smudge, x: number, y: number): number {
  const dx = x - m.x;
  const dy = y - m.y;
  const c = Math.cos(m.angle);
  const s = Math.sin(m.angle);
  const p = (dx * c + dy * s) / m.ax;
  const q = (-dx * s + dy * c) / m.ay;
  const d2 = p * p + q * q;
  return d2 < 2.5 ? m.amplitude * Math.exp(-1.6 * d2) : 0;
}

/**
 * A star's profile, exp(−e / STAR_SPREAD) over its cell (e = squared distance in cell units). Averaged over a
 * cell's sample points it keeps about half of the amplitude, so with the twinkle at its lowest (0.6) and the lowest
 * amplitude (0.4) the star's cell stays near 0.12, above the first glyph (1/11). The spread stays narrow enough that
 * the neighbouring cells draw nothing.
 */
const STAR_SPREAD = 0.18;

/** SK-6: a star's twinkle period (5 + 3u s) and phase (2πu′) from two uniform draws u, u′ in [0, 1). */
export const twinkleTiming = (u: number, u2: number): { period: number; phase: number } => ({ period: 5 + 3 * u, phase: 2 * Math.PI * u2 });

/** SK-6: twinkle factor in [0.6, 1]. */
export const twinkle = (star: Star, t: number): number => 0.8 + 0.2 * Math.sin((2 * Math.PI * t) / star.period + star.phase);

/** Squared distance from a star in cell units. */
function cellDistance2(star: Star, sky: Sky, x: number, y: number): number {
  const ex = (x - star.x) / sky.cellWidth;
  const ey = (y - star.y) / sky.cellHeight;
  return ex * ex + ey * ey;
}

/** A star's brightness at (x, y) before its twinkle: zero beyond one cell. */
function starProfile(star: Star, sky: Sky, x: number, y: number): number {
  const e = cellDistance2(star, sky, x, y);
  return e < 1 ? star.amplitude * Math.exp(-e / STAR_SPREAD) : 0;
}

/** SK-7: a flare in progress, with its envelope level in [0, 1] (from E03, through M01). */
export interface Glow {
  star: number;
  level: number;
}

/** SK-7: at full level a flare adds FLARE_GAIN × exp(−d / FLARE_SPREAD), d the squared distance in cells, for d < FLARE_REACH. */
export const FLARE_GAIN = 1.2;
export const FLARE_SPREAD = 0.6;
export const FLARE_REACH = 4;

/** SK-7: a flare's brightness at (x, y) at full level: zero from two cells out. */
export function flareProfile(star: Star, sky: Sky, x: number, y: number): number {
  const d = cellDistance2(star, sky, x, y);
  return d < FLARE_REACH ? FLARE_GAIN * Math.exp(-d / FLARE_SPREAD) : 0;
}

/** SK-8: the plane radius below which the galaxy is its core. */
export const CORE_RADIUS = 0.2;

/** SK-8: the region at (x, y); it does not change with time. */
export function regionAt(sky: Sky, x: number, y: number): Region {
  const r = Math.hypot(...screenToPlane(sky.galaxy, x, y));
  return r < CORE_RADIUS ? Region.core : r < 1 ? Region.arm : Region.none;
}

/** SK-8: the region of each cell's center, in row-major order. */
export function cellRegions(sky: Sky, grid: Grid): Uint8Array {
  const regions = new Uint8Array(grid.cols * grid.rows);
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) regions[row * grid.cols + col] = regionAt(sky, (col + 0.5) * grid.cellWidth, (row + 0.5) * grid.cellHeight);
  }
  return regions;
}

export function createSky(grid: Grid, rng: Random): Sky {
  const galaxy = placeGalaxy(grid, rng);
  const cw = grid.cellWidth;
  const ch = grid.cellHeight;
  const outsideGalaxy = (x: number, y: number, margin: number) => Math.hypot(...screenToPlane(galaxy, x, y)) >= margin;

  // SK-5: 3–5 smudges, on screen, outside the galaxy, apart from each other
  const smudges: Smudge[] = [];
  const smudgeCount = integer(rng, 3, 5);
  for (let tries = 0; smudges.length < smudgeCount && tries < 2000; tries++) {
    const x = (Math.floor(between(rng, 0.06, 0.94) * grid.cols) + 0.5) * cw;
    const y = (Math.floor(between(rng, 0.06, 0.94) * grid.rows) + 0.5) * ch;
    if (!outsideGalaxy(x, y, 1.3)) continue;
    if (smudges.some((m) => Math.hypot(m.x - x, m.y - y) < 12 * cw)) continue;
    smudges.push({
      x,
      y,
      ax: between(rng, 1.2, 1.9) * cw,
      ay: between(rng, 0.45, 0.6) * ch,
      angle: (between(rng, -15, 15) * Math.PI) / 180,
      amplitude: between(rng, 0.45, 0.6),
    });
  }

  // SK-5, SK-6: 30–60 stars at cell centers, outside the galaxy and the smudges
  const stars: Star[] = [];
  const starCount = integer(rng, 30, 60);
  for (let tries = 0; stars.length < starCount && tries < 20000; tries++) {
    const x = (Math.floor(rng.next() * grid.cols) + 0.5) * cw;
    const y = (Math.floor(rng.next() * grid.rows) + 0.5) * ch;
    if (x > grid.width || y > grid.height || !outsideGalaxy(x, y, 1.05)) continue;
    if (smudges.some((m) => Math.hypot(m.x - x, m.y - y) < 4 * cw)) continue;
    if (stars.some((s) => s.x === x && s.y === y)) continue;
    const amplitude = between(rng, 0.4, 0.8);
    stars.push({ x, y, amplitude, ...twinkleTiming(rng.next(), rng.next()) });
  }
  return { galaxy, smudges, stars, cellWidth: cw, cellHeight: ch };
}

const clampUnit = (b: number): number => (b > 0 ? (b < 1 ? b : 1) : 0);

interface StarPart {
  index: number;
  profile: number;
}

/**
 * The parts that do not change with time at (x, y): the smudge sum, each nearby star's profile, and each nearby
 * star's flare profile at full level (SK-7).
 */
function staticPart(sky: Sky, x: number, y: number): { smudges: number; stars: StarPart[]; flares: StarPart[] } {
  let smudges = 0;
  for (const m of sky.smudges) {
    // Bounding box first, so most points skip most smudges
    const reach = 1.6 * Math.max(m.ax, m.ay);
    if (Math.abs(x - m.x) < reach && Math.abs(y - m.y) < reach) smudges += smudgeBrightness(m, x, y);
  }
  // A star reaches less than one cell from its center, and its flare less than two cells; the center is a cell
  // center, so only the stars in the 5 × 5 cells around the point can reach it. They are taken in star order, so the
  // sum is the same as over all stars
  const byCell = starCells(sky);
  const col = Math.floor(x / sky.cellWidth);
  const row = Math.floor(y / sky.cellHeight);
  const near: number[] = [];
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) near.push(...(byCell.get(cellKey(col + dc, row + dr)) ?? []));
  }
  near.sort((a, b) => a - b);
  const stars: StarPart[] = [];
  const flares: StarPart[] = [];
  for (const index of near) {
    const star = sky.stars[index]!;
    const profile = starProfile(star, sky, x, y);
    if (profile > 0) stars.push({ index, profile });
    const flare = flareProfile(star, sky, x, y);
    if (flare > 0) flares.push({ index, profile: flare });
  }
  return { smudges, stars, flares };
}

/** SK-7: each star's flare level at this moment (0 for stars without a flare). */
function flareLevels(sky: Sky, glows: readonly Glow[]): Float64Array {
  const levels = new Float64Array(sky.stars.length);
  for (const g of glows) {
    if (g.star >= 0 && g.star < levels.length) levels[g.star] = Math.max(levels[g.star]!, clampUnit(g.level));
  }
  return levels;
}

/** A number for a cell (col and row may be −1 at the screen's edge; the grid has fewer than 2^20 columns). */
const cellKey = (col: number, row: number): number => (row + 1) * 2 ** 20 + (col + 1);

/** The indices of the stars in each cell (createSky puts at most one in a cell, but a Sky may hold more), built once per sky. */
const starCellCache = new WeakMap<Sky, Map<number, number[]>>();
function starCells(sky: Sky): Map<number, number[]> {
  let map = starCellCache.get(sky);
  if (!map) {
    map = new Map();
    for (const [index, star] of sky.stars.entries()) {
      const key = cellKey(Math.floor(star.x / sky.cellWidth), Math.floor(star.y / sky.cellHeight));
      const list = map.get(key);
      if (list) list.push(index);
      else map.set(key, [index]);
    }
    starCellCache.set(sky, map);
  }
  return map;
}

/** The sky's brightness field at time t with the flares in progress (SK-7), clamped to [0, 1] (C-2). */
export function skyField(sky: Sky, t: number, glows: readonly Glow[] = []): Field {
  const twinkles = sky.stars.map((star) => twinkle(star, t));
  const levels = flareLevels(sky, glows);
  return {
    brightness(x, y) {
      const { smudges, stars, flares } = staticPart(sky, x, y);
      let b = galaxyAt(sky.galaxy, planePoint(...screenToPlane(sky.galaxy, x, y)), t) + smudges;
      for (const s of stars) b += s.profile * twinkles[s.index]!;
      for (const f of flares) b += f.profile * levels[f.index]!;
      return clampUnit(b);
    },
  };
}

/**
 * The same field as skyField, for a fixed set of points (x, y pairs): what does not change with time is computed
 * here once, and the returned function computes only the rest for each time. M01 prepares it once per screen size
 * with E02's sample points, so each frame costs far less than sampling skyField point by point.
 */
export function prepareSkyField(sky: Sky, points: ArrayLike<number>): (t: number, glows?: readonly Glow[]) => Float64Array {
  const n = points.length / 2;
  const smudges = new Float64Array(n);
  // Only the points inside the disc carry the galaxy's terms (outside it the galaxy adds 0), in typed arrays
  const disc: { index: number; p: PlanePoint }[] = [];
  const starPoint: number[] = [];
  const starIndex: number[] = [];
  const starProfileAt: number[] = [];
  const flarePoint: number[] = [];
  const flareIndex: number[] = [];
  const flareProfileAt: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = points[2 * i]!;
    const y = points[2 * i + 1]!;
    const [u, v] = screenToPlane(sky.galaxy, x, y);
    if (Math.hypot(u, v) < 1) disc.push({ index: i, p: planePoint(u, v) });
    const part = staticPart(sky, x, y);
    smudges[i] = part.smudges;
    for (const s of part.stars) {
      starPoint.push(i);
      starIndex.push(s.index);
      starProfileAt.push(s.profile);
    }
    for (const f of part.flares) {
      flarePoint.push(i);
      flareIndex.push(f.index);
      flareProfileAt.push(f.profile);
    }
  }
  const m = disc.length;
  const index = Int32Array.from(disc, (d) => d.index);
  const column = (key: keyof PlanePoint) => Float64Array.from(disc, (d) => d.p[key]);
  const [r, theta, spiral, armFade, omega, core, discTerm] = (["r", "theta", "spiral", "armFade", "omega", "core", "disc"] as const).map(column) as [
    Float64Array,
    Float64Array,
    Float64Array,
    Float64Array,
    Float64Array,
    Float64Array,
    Float64Array,
  ];
  disc.length = 0;
  const seed = sky.galaxy.noiseSeed;
  return (t, glows = []) => {
    // Outside the disc the value is 0 + smudges, which is the smudges themselves
    const out = Float64Array.from(smudges);
    for (let k = 0; k < m; k++) {
      const i = index[k]!;
      out[i] = galaxyValue(seed, r[k]!, theta[k]!, spiral[k]!, armFade[k]!, omega[k]!, core[k]!, discTerm[k]!, t) + smudges[i]!;
    }
    const twinkles = sky.stars.map((star) => twinkle(star, t));
    for (let k = 0; k < starPoint.length; k++) out[starPoint[k]!]! += starProfileAt[k]! * twinkles[starIndex[k]!]!;
    // Each point's flares are added after all of its stars, in star order, as in skyField
    if (glows.length > 0) {
      const levels = flareLevels(sky, glows);
      for (let k = 0; k < flarePoint.length; k++) out[flarePoint[k]!]! += flareProfileAt[k]! * levels[flareIndex[k]!]!;
    }
    for (let i = 0; i < n; i++) out[i] = clampUnit(out[i]!);
    return out;
  };
}
