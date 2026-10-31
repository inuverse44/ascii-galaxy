// U01 Clock: turns frame times (ms, from requestAnimationFrame) into fixed 1/60 s steps.
// Pure: C01 passes in the frame times and sets the mode; the clock uses no browser API.

export const STEP_SECONDS = 1 / 60;
/** After a long gap (a background tab), at most this many steps are taken at once. */
export const MAX_STEPS_PER_FRAME = 10;

export type ClockMode = "live" | "still" | "paused" | "fixed";

export class Clock {
  private mode: ClockMode;
  private lastFrameMs: number | null = null;
  private carry = 0;
  /** Simulated time in seconds. */
  time = 0;

  constructor(mode: ClockMode = "live") {
    this.mode = mode;
  }

  setMode(mode: ClockMode): void {
    this.mode = mode;
    // Time spent paused or still is not caught up afterwards
    this.lastFrameMs = null;
    this.carry = 0;
  }

  getMode(): ClockMode {
    return this.mode;
  }

  /** Live mode: the number of fixed steps to take for this frame. Other modes take none. */
  advance(frameMs: number): number {
    if (!Number.isFinite(frameMs)) throw new RangeError(`frame time must be finite: ${frameMs}`);
    if (this.mode !== "live") return 0;
    if (this.lastFrameMs === null || frameMs < this.lastFrameMs) {
      this.lastFrameMs = frameMs;
      return 0;
    }
    this.carry += (frameMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = frameMs;
    const steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(this.carry / STEP_SECONDS + 1e-9));
    this.carry = steps === MAX_STEPS_PER_FRAME ? 0 : this.carry - steps * STEP_SECONDS;
    this.time += steps * STEP_SECONDS;
    return steps;
  }

  /** Fixed mode (tests): move time forward by whole steps. */
  stepFixed(steps: number): void {
    if (this.mode !== "fixed") throw new Error("stepFixed is only for fixed mode");
    if (!(Number.isInteger(steps) && steps >= 0)) throw new RangeError(`steps must be a non-negative integer: ${steps}`);
    this.time += steps * STEP_SECONDS;
  }
}
