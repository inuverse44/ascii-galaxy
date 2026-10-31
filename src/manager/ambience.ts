// M01 AmbienceManager: the frame workflow. Engines never call each other; M01 passes one's output to the next.
// It owns the clock (U01): C01 passes in frame times and the mode, and M01 decides when to draw (MG-1, MG-2).
// It routes E03's flares to E01 and to listeners, and E01's regions to E02's glints (MG-4). Once music starts, it
// makes E04's bars ahead of the audio clock, turns their notes into E05's patches for A02, and sounds a chime in
// the key in force for each flare (MG-5).

import type { AudioOut } from "../access/audio";
import type { DisplayAccess } from "../access/display";
import { type ComposerState, type Key, type Style, CHILL, chimeNote, createComposer, nextBar } from "../engine/composition";
import { type Flare, type FlareState, advanceFlares, createFlares, flareEnvelope, starOf } from "../engine/events";
import { nextClick, patchFor } from "../engine/voice";
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
export const musicRandom = (seed: number): Random => createRandom(seed ^ 0x1b873593);
export const chimeRandom = (seed: number): Random => createRandom(seed ^ 0x7feb352d);
export const clickRandom = (seed: number): Random => createRandom(seed ^ 0x3c6ef372);

/** AU-1: bars are made until their start is at least this far past the audio clock. */
export const MUSIC_AHEAD = 4;
/** MG-5: the music starts this long after "♪", so its first notes are not late. */
export const MUSIC_LEAD = 0.1;
/** MG-5: a chime sounds this long after its flare starts (on the audio clock). */
export const CHIME_DELAY = 0.05;

interface Music {
  audio: AudioOut;
  /** The audio time of the music's time 0 */
  start: number;
  composer: ComposerState;
  rng: Random;
  chimeRng: Random;
  clickRng: Random;
  nextClick: number;
  /** The key of each bar made, from its start on the audio clock, oldest first */
  keys: { at: number; key: Key }[];
}

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
  private music: Music | null = null;
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
    this.listeners.push(() => this.chime());
    if (mode !== "paused") this.draw();
  }

  /** MG-5: starts the music on `audio` (once; later calls do nothing) and makes the first bars. */
  startMusic(audio: AudioOut, style: Style = CHILL): void {
    if (this.music) return;
    const rng = musicRandom(this.seed);
    const start = audio.now + MUSIC_LEAD;
    audio.start(start);
    const clickRng = clickRandom(this.seed);
    this.music = {
      audio,
      start,
      composer: createComposer(style, rng),
      rng,
      chimeRng: chimeRandom(this.seed),
      clickRng,
      nextClick: nextClick(start, clickRng.next()),
      keys: [],
    };
    this.pumpMusic();
  }

  /** AU-1, MG-5: makes bars, and vinyl clicks, until they reach MUSIC_AHEAD past the audio clock. C01 calls it every 250 ms. */
  pumpMusic(): void {
    const m = this.music;
    if (!m) return;
    const until = m.audio.now + MUSIC_AHEAD;
    while (m.start + m.composer.time < until) {
      const { state, bar } = nextBar(m.composer, m.rng);
      m.composer = state;
      m.keys.push({ at: m.start + bar.start, key: bar.key });
      // Keys older than the bar in force now are no longer needed for chimes
      while (m.keys.length > 1 && m.keys[1]!.at <= m.audio.now) m.keys.shift();
      for (const note of bar.notes) m.audio.play(patchFor({ ...note, time: m.start + note.time, nominal: m.start + note.nominal }));
    }
    while (m.nextClick < until) {
      m.audio.click(m.nextClick);
      m.nextClick = nextClick(m.nextClick, m.clickRng.next());
    }
  }

  /** MG-5 (R-12): one chime for a flare, in the key in force on the audio clock, if music is playing. */
  private chime(): void {
    const m = this.music;
    if (!m) return;
    const at = m.audio.now + CHIME_DELAY;
    let key = m.keys[0]?.key;
    for (const k of m.keys) if (k.at <= at) key = k.key;
    if (!key) return;
    m.audio.play(patchFor(chimeNote(key, at, m.chimeRng)));
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
