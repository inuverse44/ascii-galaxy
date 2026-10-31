// E03 EventEngine: rare events, now the flare of a star (docs/02-detailed-design.md EV-1–EV-3).
// Pure: the state is plain data, advanced with a random source; M01 routes the flares to E01 and to the chime.

import type { Random } from "../util/random";

/** EV-2: a flare rises for this long, then fades for FLARE_FADE; it lasts FLARE_LENGTH in all. */
export const FLARE_RISE = 8;
export const FLARE_FADE = 12;
export const FLARE_LENGTH = FLARE_RISE + FLARE_FADE;

export interface Flare {
  /** Sky time the flare starts, in seconds */
  start: number;
  /** In [0, 1): picks the star (EV-1, starOf) */
  pick: number;
}

export interface FlareState {
  /** The next flare, not yet started */
  next: Flare;
  /** Flares started within the last FLARE_LENGTH seconds, oldest first */
  active: Flare[];
  /** The time the state was last advanced to */
  time: number;
}

/** EV-1: the time from one flare's start to the next, from a uniform u in [0, 1). */
export const flareInterval = (u: number): number => 120 + 180 * u;

/** EV-1: the star a flare belongs to, for a sky with `stars` stars (-1 for none). */
export const starOf = (flare: Flare, stars: number): number => (stars > 0 ? Math.min(stars - 1, Math.floor(flare.pick * stars)) : -1);

const drawFlare = (after: number, rng: Random): Flare => {
  const start = after + flareInterval(rng.next());
  return { start, pick: rng.next() };
};

/** EV-1: the first flare starts one interval after time 0. */
export const createFlares = (rng: Random): FlareState => ({ next: drawFlare(0, rng), active: [], time: 0 });

const smoothstep = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** EV-2: the flare's level in [0, 1] at `age` seconds after its start; 0 outside [0, FLARE_LENGTH). */
export function flareEnvelope(age: number): number {
  if (!(age > 0 && age < FLARE_LENGTH)) return 0;
  return age <= FLARE_RISE ? smoothstep(age / FLARE_RISE) : smoothstep((FLARE_LENGTH - age) / FLARE_FADE);
}

/**
 * EV-3: advances to time t and returns the new state and, in order, the flares whose start is in (previous time, t].
 * Each flare is returned once, by the call whose interval holds its start, however the time is stepped.
 */
export function advanceFlares(state: FlareState, t: number, rng: Random): { state: FlareState; started: Flare[] } {
  if (!(t >= state.time)) return { state, started: [] };
  const started: Flare[] = [];
  let next = state.next;
  while (next.start <= t) {
    started.push(next);
    next = drawFlare(next.start, rng);
  }
  const active = [...state.active, ...started].filter((f) => t - f.start < FLARE_LENGTH);
  return { state: { next, active, time: t }, started };
}
