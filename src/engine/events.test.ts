import { describe, expect, it } from "vitest";
import { createRandom } from "../util/random";
import { FLARE_FADE, FLARE_LENGTH, FLARE_RISE, type Flare, advanceFlares, createFlares, flareEnvelope, flareInterval, starOf } from "./events";

const SEEDS = [1, 2, 3, 4, 5];
const TWO_HOURS = 7200;

/** Every flare that starts within two hours, advancing in the given steps; each step's flares with its interval. */
function run(seed: number, steps: number[]): { flare: Flare; from: number; to: number }[] {
  const rng = createRandom(seed);
  let state = createFlares(rng);
  const out: { flare: Flare; from: number; to: number }[] = [];
  let t = 0;
  for (const step of steps) {
    const to = Math.min(TWO_HOURS, t + step);
    const result = advanceFlares(state, to, rng);
    for (const flare of result.started) out.push({ flare, from: t, to });
    state = result.state;
    t = to;
  }
  return out;
}

describe("EV-1 flare intervals", () => {
  it("interval = 120 + 180u at fixed u, and the first flare starts one interval after 0", () => {
    for (const [u, interval] of [[0, 120], [0.5, 210], [0.999, 299.82]] as const) {
      expect(flareInterval(u)).toBeCloseTo(interval, 9);
      expect(createFlares({ next: () => u }).next.start).toBeCloseTo(interval, 9);
    }
  });

  it("with real seeds over 2 hours, every interval is in [120, 300] and both halves occur", () => {
    const intervals: number[] = [];
    for (const seed of SEEDS) {
      const flares = run(seed, [TWO_HOURS]).map((f) => f.flare.start);
      expect(flares.length).toBeGreaterThanOrEqual(TWO_HOURS / 300 - 1);
      flares.forEach((start, k) => intervals.push(start - (k === 0 ? 0 : flares[k - 1]!))); // the first is measured from 0
    }
    for (const d of intervals) {
      expect(d).toBeGreaterThanOrEqual(120);
      expect(d).toBeLessThanOrEqual(300);
    }
    expect(intervals.some((d) => d < 210) && intervals.some((d) => d >= 210)).toBe(true);
  });

  it("a pick maps to star floor(pick × stars)", () => {
    for (const [stars, picks] of [[30, [[0, 0], [0.5, 15], [0.999, 29]]], [60, [[0, 0], [0.5, 30], [0.999, 59]]]] as const) {
      for (const [pick, star] of picks) expect(starOf({ start: 0, pick }, stars)).toBe(star);
    }
    expect(starOf({ start: 0, pick: 0.5 }, 0)).toBe(-1);
  });
});

describe("EV-2 flare envelope", () => {
  it("lasts 20 s: 0 before and from 20 s, 1 at 8 s, strictly rising for 8 s and strictly falling for 12 s", () => {
    expect(FLARE_RISE).toBe(8);
    expect(FLARE_FADE).toBe(12);
    expect(FLARE_LENGTH).toBe(20);
    for (const age of [-10, -0.01, 0, 20, 20.01, 1000, Number.NaN]) expect(flareEnvelope(age), `age ${age}`).toBe(0);
    expect(flareEnvelope(8)).toBe(1);
    for (let k = 1; k <= 800; k++) expect(flareEnvelope(k / 100), `${k / 100} s`).toBeGreaterThan(flareEnvelope((k - 1) / 100));
    for (let k = 801; k < 2000; k++) expect(flareEnvelope(k / 100), `${k / 100} s`).toBeLessThan(flareEnvelope((k - 1) / 100));
    expect(flareEnvelope(19.99)).toBeGreaterThan(0);
  });
});

describe("EV-3 each flare is emitted once, at its start", () => {
  it("in steps of 1/60 s, in uneven steps, and in one step: the same flares, each once, by the step that holds its start", () => {
    for (const seed of SEEDS) {
      const frames = run(seed, Array.from({ length: TWO_HOURS * 60 + 1 }, () => 1 / 60));
      const rng = createRandom(seed + 50);
      const uneven = run(seed, Array.from({ length: 2000 }, () => 0.001 + 39.999 * rng.next()));
      const once = run(seed, [TWO_HOURS]);
      for (const steps of [frames, uneven, once]) {
        for (const { flare, from, to } of steps) {
          expect(flare.start).toBeGreaterThan(from);
          expect(flare.start).toBeLessThanOrEqual(to);
        }
        const starts = steps.map((s) => s.flare.start);
        expect(new Set(starts).size).toBe(starts.length);
      }
      expect(frames.map((f) => f.flare)).toEqual(once.map((f) => f.flare));
      expect(uneven.map((f) => f.flare)).toEqual(once.map((f) => f.flare));
      expect(once.length).toBeGreaterThan(0);
    }
  });

  it("keeps a flare active for 20 s after its start, then drops it", () => {
    const rng = createRandom(1);
    let state = createFlares(rng);
    const first = state.next;
    state = advanceFlares(state, first.start + 19.9, rng).state;
    expect(state.active).toContainEqual(first);
    state = advanceFlares(state, first.start + 20, rng).state;
    expect(state.active).not.toContainEqual(first);
  });

  it("does not go back in time", () => {
    const rng = createRandom(1);
    const state = advanceFlares(createFlares(rng), 1000, rng).state;
    expect(advanceFlares(state, 500, rng)).toEqual({ state, started: [] });
  });
});
