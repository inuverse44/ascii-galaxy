import { describe, expect, it, vi } from "vitest";
import { DisplayAccess, type DrawingContext, type Surface } from "../access/display";
import { type Flare, advanceFlares, createFlares, flareEnvelope, starOf } from "../engine/events";
import { type Cell, type Grid, INK, MAX_SCREEN, MIN_SCREEN, cellBrightness, createGlintClocks, createGrid, glintInks, rasterize } from "../engine/raster";
import { type Glow, cellRegions, createSky, prepareSkyField, skyField } from "../engine/sky";
import { createRandom } from "../util/random";
import { AmbienceManager, CELLS_PER_SECOND, DRAWS_PER_SECOND, drawInterval, flareRandom, glintRandom } from "./ambience";

// The real E01, with its two costly builders counted, so laziness (MG-2) is checked by what runs, not by time
vi.mock("../engine/sky", async (importOriginal) => {
  const real = await importOriginal<typeof import("../engine/sky")>();
  return { ...real, createSky: vi.fn(real.createSky), prepareSkyField: vi.fn(real.prepareSkyField) };
});
const builds = () => ({ skies: vi.mocked(createSky).mock.calls.length, fields: vi.mocked(prepareSkyField).mock.calls.length });

/** The real A01 on a canvas spy that keeps nothing (for long runs that do not read the draws). */
function quietDisplay(): DisplayAccess {
  return recordingDisplay(false).display;
}

/** A display that records each draw's cells, through the real A01 with a canvas spy. */
function recordingDisplay(record = true) {
  const draws: Cell[][] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    fillRect() {},
    fillText() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    setTransform() {},
  } as unknown as DrawingContext;
  const surface: Surface = { width: 0, height: 0, getContext: () => ctx };
  const display = new DisplayAccess(surface);
  if (!record) return { display, draws };
  const draw = display.draw.bind(display);
  display.draw = (cells, grid) => {
    draws.push([...cells]);
    draw(cells, grid);
  };
  return { display, draws };
}

/** Frames at 60 Hz for `seconds`, starting at `fromMs`; returns the time after the last frame. */
function run(manager: AmbienceManager, fromMs: number, seconds: number): number {
  let ms = fromMs;
  for (let i = 0; i < seconds * 60; i++) {
    ms += 1000 / 60;
    manager.frame(ms);
  }
  return ms;
}

describe("MG-1 live drawing", () => {
  it("advances sky time with the frames and draws at most 12 times a second, and at least 10", () => {
    const { display, draws } = recordingDisplay();
    const m = new AmbienceManager(display, 1, 400, 300, 1, "live");
    expect(draws).toHaveLength(1); // the first picture, at t = 0
    run(m, 0, 10);
    expect(m.time).toBeCloseTo(10, 1);
    const perSecond = (draws.length - 1) / 10;
    expect(perSecond).toBeLessThanOrEqual(DRAWS_PER_SECOND);
    expect(perSecond).toBeGreaterThanOrEqual(10);
  });

  it("a draw shows the sky at the manager's time (same cells as rasterizing skyField at that time, with its glints)", () => {
    const { display, draws } = recordingDisplay();
    const m = new AmbienceManager(display, 7, 400, 300, 1, "live");
    run(m, 0, 2);
    // Live draws fall on 1/12 s steps, so the time may have moved on since the last one; still draws now
    m.setMode("still");
    expect(m.time).toBeGreaterThan(1.9);
    const expected = expectedCells(7, createGrid(400, 300), m.time);
    expect(draws.at(-1)).toEqual(expected);
    expect(expected.some((c) => c.ink !== INK)).toBe(true); // the glints are really compared
  });
});

/**
 * The cells M01 should draw, built another way: rasterize E01's point-by-point field, then colour the cells by E02's
 * glintInks with E01's regions and clocks from M01's glint stream.
 */
function expectedCells(seed: number, grid: Grid, t: number, glows: Glow[] = []): Cell[] {
  const sky = createSky(grid, createRandom(seed));
  const field = skyField(sky, t, glows);
  const brightness = Array.from({ length: grid.cols * grid.rows }, (_, i) => cellBrightness(field, grid, i % grid.cols, Math.floor(i / grid.cols)));
  const inks = glintInks(brightness, cellRegions(sky, grid), createGlintClocks(grid.cols * grid.rows, glintRandom(seed)), t);
  return rasterize(field, grid).map((cell, i) => ({ ...cell, ink: inks[i]! }));
}

describe("MG-4 flares and glints through M01", () => {
  /** E03's flares from M01's stream up to `until`. */
  function schedule(seed: number, until: number): Flare[] {
    const rng = flareRandom(seed);
    return advanceFlares(createFlares(rng), until, rng).started;
  }

  /** Live frames at 60 Hz for `seconds`, recording each flare the listener hears with the sky time it heard it. */
  function listen(seed: number, seconds: number, resizeEvery?: number) {
    const m = new AmbienceManager(quietDisplay(), seed, MIN_SCREEN, MIN_SCREEN, 1, "live");
    const heard: { flare: Flare; at: number }[] = [];
    m.onFlare((flare) => heard.push({ flare, at: m.time }));
    let ms = 0;
    for (let i = 1; i <= seconds * 60; i++) {
      ms += 1000 / 60;
      if (resizeEvery && i % (resizeEvery * 60) === 0) m.resize(i % (2 * resizeEvery * 60) === 0 ? MIN_SCREEN : 300, 250, 1);
      m.frame(ms);
    }
    return { heard, m };
  }

  it("over 30 minutes the listener hears each flare once, on the first frame at or after its start, also across resizes", () => {
    // Seeds 1–2: each 30-minute run draws about 21,600 times and takes about 14 s alone
    for (const seed of [1, 2]) {
      for (const resizeEvery of [undefined, 420]) {
        const { heard, m } = listen(seed, 1800, resizeEvery);
        // The first frame only sets the clock's base, so sky time is one step short of 30 minutes
        expect(m.time).toBeCloseTo(1800 - 1 / 60, 6);
        const expected = schedule(seed, m.time);
        expect(expected.length).toBeGreaterThanOrEqual(6);
        expect(heard.map((h) => h.flare), `seed ${seed}, resize ${resizeEvery}`).toEqual(expected);
        for (const { flare, at } of heard) {
          expect(at).toBeGreaterThanOrEqual(flare.start);
          expect(at - flare.start).toBeLessThan(1 / 60 + 1e-9);
        }
      }
    }
  }); // about 60 s alone

  it("a draw during a flare shows E01's field with that flare at its level, with the glints", () => {
    const seed = 3;
    const [flare] = schedule(seed, 300);
    const { display, draws } = recordingDisplay();
    const m = new AmbienceManager(display, seed, 400, 300, 1, "live");
    run(m, 0, flare!.start + 8); // the peak of the first flare
    m.setMode("still");
    const grid = createGrid(400, 300);
    const stars = createSky(grid, createRandom(seed)).stars.length;
    const glows = [{ star: starOf(flare!, stars), level: flareEnvelope(m.time - flare!.start) }];
    expect(glows[0]!.level).toBeGreaterThan(0.9);
    const expected = expectedCells(seed, grid, m.time, glows);
    expect(draws.at(-1)).toEqual(expected);
    expect(expected).not.toEqual(expectedCells(seed, grid, m.time)); // the flare really shows
  });

  it("still and paused for 10 minutes of frames start no flare and call no listener", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const mode of ["still", "paused"] as const) {
        const m = new AmbienceManager(quietDisplay(), seed, MIN_SCREEN, MIN_SCREEN, 1, mode);
        let calls = 0;
        m.onFlare(() => calls++);
        run(m, 0, 600);
        expect(m.time).toBe(0);
        expect(calls, `seed ${seed} ${mode}`).toBe(0);
      }
    }
  });
});

describe("MG-1 work budget and MG-3 cost at the largest screen", () => {
  it("draw interval: exactly 1/12 s up to 200,000 cells per second, then cells ÷ 200,000 s, at every corner and the stated sizes", () => {
    const sizes = [[MIN_SCREEN, MIN_SCREEN], [MIN_SCREEN, MAX_SCREEN], [MAX_SCREEN, MIN_SCREEN], [MAX_SCREEN, MAX_SCREEN], [1440, 900], [2560, 1440]] as const;
    for (const [w, h] of sizes) {
      const grid = createGrid(w, h);
      const cells = grid.cols * grid.rows;
      const interval = drawInterval(grid);
      expect(interval, `${w}×${h}`).toBe(cells <= CELLS_PER_SECOND / DRAWS_PER_SECOND ? 1 / DRAWS_PER_SECOND : cells / CELLS_PER_SECOND);
      expect(cells / interval).toBeLessThanOrEqual(CELLS_PER_SECOND + 1e-6);
    }
    // The stated sizes: 12 draws a second up to 2560 × 1440 and at the corners except the largest, about 3 there
    for (const [w, h] of sizes.slice(0, 3).concat(sizes.slice(4))) expect(drawInterval(createGrid(w, h)), `${w}×${h}`).toBe(1 / DRAWS_PER_SECOND);
    expect(1 / drawInterval(createGrid(MAX_SCREEN, MAX_SCREEN))).toBeCloseTo(2.93, 2);
  });

  it(`at ${MAX_SCREEN} × ${MAX_SCREEN} live for 5 s: draws stay within the cell budget`, () => {
    // How long preparing and drawing take is measured and written in docs/02 MG-3, not tested: a wall-clock bound
    // fails on a busy machine without any change in the code (review of #13)
    const { display, draws } = recordingDisplay();
    const m = new AmbienceManager(display, 1, MAX_SCREEN, MAX_SCREEN, 1, "live");
    run(m, 0, 5);
    const grid = createGrid(MAX_SCREEN, MAX_SCREEN);
    const perSecond = (draws.length - 1) / 5;
    expect(perSecond * grid.cols * grid.rows).toBeLessThanOrEqual(CELLS_PER_SECOND);
    expect(perSecond).toBeGreaterThan(0);
  });

  it("starting paused builds no sky, prepares no field, and sizes no canvas until the first draw", () => {
    const { display, draws } = recordingDisplay();
    let resizes = 0;
    const resize = display.resize.bind(display);
    display.resize = (grid, ratio) => {
      resizes++;
      resize(grid, ratio);
    };
    const before = builds();
    const m = new AmbienceManager(display, 1, 1440, 900, 1, "paused");
    run(m, 0, 2);
    expect(builds()).toEqual(before);
    expect(resizes).toBe(0);
    expect(draws).toHaveLength(0);
    m.setMode("still");
    expect(builds()).toEqual({ skies: before.skies + 1, fields: before.fields + 1 }); // the path that builds really ran
    expect(resizes).toBe(1);
    expect(draws.at(-1)).toHaveLength(createGrid(1440, 900).cols * createGrid(1440, 900).rows);
  });

  it("a resize while paused builds nothing until it is drawn, and then builds once for the new size", () => {
    const { display, draws } = recordingDisplay();
    const m = new AmbienceManager(display, 1, 400, 300, 1, "paused");
    const before = builds();
    for (const [w, h] of [[MAX_SCREEN, MAX_SCREEN], [1440, 900], [500, 400]] as const) m.resize(w, h, 1);
    expect(builds()).toEqual(before);
    expect(draws).toHaveLength(0);
    m.setMode("still");
    expect(builds()).toEqual({ skies: before.skies + 1, fields: before.fields + 1 });
    expect(draws.at(-1)).toHaveLength(createGrid(500, 400).cols * createGrid(500, 400).rows);
  });
});

describe("MG-2 still and paused (R-08)", () => {
  it("still: exactly one draw, at the current time, and none for later frames", () => {
    const { display, draws } = recordingDisplay();
    const m = new AmbienceManager(display, 1, 400, 300, 1, "still");
    run(m, 0, 5);
    expect(draws).toHaveLength(1);
    expect(m.time).toBe(0);
  });

  it("switching to still from live draws once more, then stops", () => {
    const { display, draws } = recordingDisplay();
    const m = new AmbienceManager(display, 1, 400, 300, 1, "live");
    const ms = run(m, 0, 2);
    const before = draws.length;
    m.setMode("still");
    expect(draws).toHaveLength(before + 1);
    run(m, ms, 3);
    expect(draws).toHaveLength(before + 1);
  });

  it("paused: no draws and no time passes; live again resumes without catching up", () => {
    const { display, draws } = recordingDisplay();
    const m = new AmbienceManager(display, 1, 400, 300, 1, "live");
    let ms = run(m, 0, 2);
    const t = m.time;
    m.setMode("paused");
    const before = draws.length;
    ms = run(m, ms, 30);
    expect(draws).toHaveLength(before);
    expect(m.time).toBe(t);
    m.setMode("live");
    run(m, ms, 1);
    expect(m.time).toBeGreaterThan(t);
    expect(m.time).toBeLessThan(t + 1.1); // no jump of the 30 s spent paused
    expect(draws.length).toBeGreaterThan(before);
  });

  it("starting paused draws nothing until live", () => {
    const { display, draws } = recordingDisplay();
    const m = new AmbienceManager(display, 1, 400, 300, 1, "paused");
    run(m, 0, 2);
    expect(draws).toHaveLength(0);
    m.setMode("live");
    run(m, 2000, 1);
    expect(draws.length).toBeGreaterThan(0);
  });

  it("resize: still redraws at once; paused draws nothing; live redraws on the next frame that MG-1 allows", () => {
    for (const [mode, expected] of [["still", 1], ["paused", 0], ["live", 0]] as const) {
      const { display, draws } = recordingDisplay();
      const m = new AmbienceManager(display, 1, 400, 300, 1, mode);
      const before = draws.length;
      m.resize(500, 400, 1);
      expect(draws.length - before, mode).toBe(expected);
    }
    const { display, draws } = recordingDisplay();
    const m = new AmbienceManager(display, 1, 400, 300, 1, "live");
    const ms = run(m, 0, 1);
    const before = draws.length;
    m.resize(500, 400, 1);
    // Within the next 1/12 s (5 frames) exactly one draw is due, and it is at the new size
    run(m, ms, 1 / DRAWS_PER_SECOND);
    expect(draws.length).toBe(before + 1);
    expect(draws.at(-1)).toHaveLength(createGrid(500, 400).cols * createGrid(500, 400).rows); // drawn at the new size
  });

  it("live: resizing on every frame still draws at most 12 times a second, never twice in one frame", () => {
    const { display, draws } = recordingDisplay();
    const m = new AmbienceManager(display, 1, 400, 300, 1, "live");
    let ms = 0;
    for (let i = 0; i < 120; i++) {
      const before = draws.length;
      m.resize(400 + (i % 7), 300, 1);
      ms += 1000 / 60;
      m.frame(ms);
      expect(draws.length - before).toBeLessThanOrEqual(1);
    }
    expect(draws.length - 1).toBeLessThanOrEqual(DRAWS_PER_SECOND * 2);
  });
});
