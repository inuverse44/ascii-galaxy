// M01 AmbienceManager: the frame workflow. Engines never call each other; M01 passes one's output to the next.
// It owns the clock (U01): C01 passes in frame times and the mode, and M01 decides when to draw (MG-1, MG-2).
// It routes E03's flares to E01 and to a listener (the chime), and E01's regions to E02's glints (MG-4).
// Music is added in later steps (docs/02 "Build order").

import type { DisplayAccess } from "../access/display";
import { type Flare, type FlareState, advanceFlares, createFlares, flareEnvelope, starOf } from "../engine/events";
import { type GlintClocks, type Grid, cellsFromSamples, createGlintClocks, createGrid, samplePoints } from "../engine/raster";
import { type Glow, type Sky, cellRegions, createSky, prepareSkyField } from "../engine/sky";
import { Clock, type ClockMode } from "../util/clock";
import { type Random, createRandom } from "../util/random";

/** MG-1: in live mode, at most this many draws per second of sky time, */
export const DRAWS_PER_SECOND = 12;
/** and at most this many cells drawn per second, so very large screens draw less often (4096 × 4096: about 3 a second). */
export const CELLS_PER_SECOND = 200_000;

/** MG-1: the shortest time between two live draws on this grid. */
export const drawInterval = (grid: Grid): number => Math.max(1 / DRAWS_PER_SECOND, (grid.cols * grid.rows) / CELLS_PER_SECOND);

/** MG-4: the random streams, one per purpose, so that adding draws to one leaves the others unchanged. */
export const skyRandom = (seed: number): Random => createRandom(seed);
export const glintRandom = (seed: number): Random => createRandom(seed ^ 0x2545f491);
export const flareRandom = (seed: number): Random => createRandom(seed ^ 0x68e31da4);

/** MG-4: the flares in progress at time t, with their envelope levels, on a sky with `stars` stars. */
export const glowsAt = (active: readonly Flare[], stars: number, t: number): Glow[] =>
  active.map((f) => ({ star: starOf(f, stars), level: flareEnvelope(t - f.start) }));

export class AmbienceManager {
  private grid: Grid;
  private sky!: Sky;
  private field!: (t: number, glows?: readonly Glow[]) => Float64Array;
  private regions!: Uint8Array;
  private clocks!: GlintClocks;
  private readonly clock: Clock;
  private readonly flareRng: Random;
  private flares: FlareState;
  private readonly listeners: ((flare: Flare) => void)[] = [];
  /** Sky time of the last draw; null before the first. */
  private drawnAt: number | null = null;
  /** The grid changed since the sky, the prepared field, and the canvas were last built for it (true until the first draw). */
  private stale = true;

  constructor(
    private readonly display: DisplayAccess,
    private readonly seed: number,
    width: number,
    height: number,
    private pixelRatio: number,
    mode: Exclude<ClockMode, "fixed"> = "live",
  ) {
    // Like a resize: the sky, the prepared field, and the canvas are built by the first draw, so a page that
    // starts paused (hidden or off screen) costs nothing until it is shown
    this.grid = createGrid(width, height);
    this.clock = new Clock(mode);
    this.flareRng = flareRandom(seed);
    this.flares = createFlares(this.flareRng);
    if (mode !== "paused") this.draw();
  }

  /** Sky time in seconds. */
  get time(): number {
    return this.clock.time;
  }

  /** MG-4: calls `listener` once for each flare, when it starts (EV-3). */
  onFlare(listener: (flare: Flare) => void): void {
    this.listeners.push(listener);
  }

  /** MG-2: still draws once, now; paused draws nothing; live resumes without catching up on the time missed. */
  setMode(mode: Exclude<ClockMode, "fixed">): void {
    if (mode === this.clock.getMode()) return;
    this.clock.setMode(mode);
    if (mode === "still") this.draw();
  }

  /** Called for each animation frame with its time in ms. MG-1: advances the sky and draws at most once per drawInterval. */
  frame(frameMs: number): void {
    this.clock.advance(frameMs);
    // MG-4: sky time only passes when live, so flares only start then
    const { state, started } = advanceFlares(this.flares, this.clock.time, this.flareRng);
    this.flares = state;
    for (const flare of started) for (const listener of this.listeners) listener(flare);
    if (this.clock.getMode() !== "live") return;
    if (this.drawnAt === null || this.clock.time - this.drawnAt >= drawInterval(this.grid) - 1e-9) this.draw();
  }

  /**
   * A new screen size keeps the same seed, so the sky keeps its character. MG-2: still redraws at once; live redraws
   * on the next draw MG-1 allows (so resizing never adds draws); paused draws nothing. Only the grid is computed now
   * (it also checks the size); the sky, the prepared field, and the canvas size are rebuilt just before the next
   * draw, so resizes while paused cost nothing, and the canvas (which resizing clears) is not left blank.
   */
  resize(width: number, height: number, pixelRatio: number): void {
    this.grid = createGrid(width, height);
    this.pixelRatio = pixelRatio;
    this.stale = true;
    if (this.clock.getMode() === "still") this.draw();
  }

  private draw(): void {
    if (this.stale) {
      this.sky = createSky(this.grid, skyRandom(this.seed));
      this.prepare();
      this.display.resize(this.grid, this.pixelRatio);
      this.stale = false;
    }
    const t = this.clock.time;
    const values = this.field(t, glowsAt(this.flares.active, this.sky.stars.length, t));
    this.display.draw(cellsFromSamples(values, this.grid, { regions: this.regions, clocks: this.clocks, t }), this.grid);
    this.drawnAt = t;
  }

  /** The sky's field at E02's sample points, the cells' regions, and their glint clocks, prepared once per screen size. */
  private prepare(): void {
    this.field = prepareSkyField(this.sky, samplePoints(this.grid));
    this.regions = cellRegions(this.sky, this.grid);
    this.clocks = createGlintClocks(this.grid.cols * this.grid.rows, glintRandom(this.seed));
  }
}
