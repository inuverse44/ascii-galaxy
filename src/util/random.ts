// U02 Random: a small seeded PRNG, so tests can reproduce the same sky and the same music.

export interface Random {
  /** A uniform number in [0, 1). */
  next(): number;
}

/** mulberry32. Any finite seed is accepted; it is reduced to an unsigned 32-bit integer. */
export function createRandom(seed: number): Random {
  if (!Number.isFinite(seed)) throw new RangeError(`seed must be finite: ${seed}`);
  let state = Math.trunc(seed) >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let z = state;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** A uniform number in [lo, hi). */
export const between = (rng: Random, lo: number, hi: number): number => lo + (hi - lo) * rng.next();

/** A uniform integer in [lo, hi] (both included). */
export const integer = (rng: Random, lo: number, hi: number): number => lo + Math.floor((hi - lo + 1) * rng.next());
