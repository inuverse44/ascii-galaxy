import { describe, expect, it } from "vitest";
import { chordPitchClasses, pitchClass, type Quality } from "../util/pitch";
import { type Random, createRandom } from "../util/random";
import {
  type Bar,
  CHILL,
  type Chord,
  type ComposerState,
  type Key,
  type Note,
  type Style,
  bend,
  chimeNote,
  createComposer,
  drawMotif,
  drawTemplate,
  keepsHat,
  keyChangeGap,
  melodyPitches,
  nextBar,
  stepLength,
  tempo,
  transpose,
  voiceLead,
  wobble,
} from "./composition";

const SEEDS = [1, 2, 3, 4, 5];
const HALF_HOUR = 1800;

/** The bars of `seconds` of music for a seed (C02: fixed time, seeded random). */
function compose(seed: number, seconds = HALF_HOUR, style: Style = CHILL): Bar[] {
  const rng = createRandom(seed);
  let state: ComposerState = createComposer(style, rng);
  const bars: Bar[] = [];
  while (state.time < seconds) {
    const next = nextBar(state, rng);
    bars.push(next.bar);
    state = next.state;
  }
  return bars;
}
const cache = new Map<number, Bar[]>();
const music = (seed: number): Bar[] => {
  if (!cache.has(seed)) cache.set(seed, compose(seed));
  return cache.get(seed)!;
};
const allBars = () => SEEDS.flatMap((seed) => music(seed).map((bar) => ({ seed, bar })));

// The tests' own reading of the rules, written from docs/02, not from the implementation
const DOMINANT: readonly Quality[] = ["7", "9", "13", "7b9"];
const isV7 = (c: Chord, key: Key) => c.root === pitchClass(key.tonic + 7) && DOMINANT.includes(c.quality);
const isI = (c: Chord, key: Key) => c.root === key.tonic;
const scale = (key: Key) => (key.mode === "major" ? [0, 2, 4, 7, 9] : [0, 2, 3, 5, 7, 9, 10]).map((i) => pitchClass(key.tonic + i));
const phraseOf = (bar: Bar) => Math.floor(bar.index / 8);
/** Each chord with the key of its bar, in order. */
const chordSequence = (bars: Bar[]) => bars.flatMap((bar) => bar.chords.map((c) => ({ ...c, key: bar.key, bar: bar.index })));
/** A chord's notes: the strummed upper voices of the pad or electric piano at one step. */
function strums(bar: Bar): Note[][] {
  const groups = new Map<string, Note[]>();
  for (const n of bar.notes) {
    if (n.layer !== "pad" && n.layer !== "epiano") continue;
    const k = `${n.layer}:${n.step}`;
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  return [...groups.values()];
}

describe("C-4 time", () => {
  it("one step lasts 60 / BPM / 4 s, and every bar follows the last with no gap", () => {
    expect(stepLength(72)).toBeCloseTo(60 / 72 / 4, 12);
    expect(stepLength(84)).toBeCloseTo(60 / 84 / 4, 12);
    for (const seed of SEEDS) {
      const bars = music(seed);
      bars.forEach((bar, i) => {
        expect(bar.index).toBe(i);
        if (i > 0) expect(bar.start).toBeCloseTo(bars[i - 1]!.start + 16 * stepLength(bars[i - 1]!.bpm), 9);
      });
      expect(bars.at(-1)!.start + 16 * stepLength(bars.at(-1)!.bpm)).toBeGreaterThanOrEqual(HALF_HOUR);
    }
  });
});

describe("H-1 chords", () => {
  it("every chord has four or more notes, and every voicing four upper voices", () => {
    for (const { bar } of allBars()) {
      for (const c of bar.chords) {
        expect(chordPitchClasses(c.chord.root, c.chord.quality).length).toBeGreaterThanOrEqual(4);
        expect(c.voicing).toHaveLength(4);
      }
    }
  });
});

describe("H-2, H-3 no V7 → I", () => {
  it("no pair of consecutive chords is V7 → I in the key in force at the second, across progressions and key changes", () => {
    let sus = 0;
    let crossKey = 0;
    for (const seed of SEEDS) {
      const seq = chordSequence(music(seed));
      for (let i = 1; i < seq.length; i++) {
        const [a, b] = [seq[i - 1]!, seq[i]!];
        expect(isV7(a.chord, b.key) && isI(b.chord, b.key), `seed ${seed} bar ${b.bar}`).toBe(false);
        // A dominant turned into sus4 right before a tonic: the H-3 replacement really happened
        if (a.chord.quality.endsWith("sus4") && isI(b.chord, b.key) && a.chord.root === pitchClass(b.key.tonic + 7)) sus++;
        if (a.key.tonic !== b.key.tonic || a.key.mode !== b.key.mode) crossKey++;
      }
    }
    expect(sus).toBeGreaterThan(0);
    expect(crossKey).toBeGreaterThan(0);
  });

  it("across progression boundaries: with a test template | Imaj7 | VIm7 | IIm7 | V7 |, every V7 before the next I becomes V7sus4", () => {
    // None of the default templates starts on I, so the boundary case needs a style of its own
    const style: Style = { ...CHILL, templates: [{ name: "turnaround", weight: 1, bars: [[{ degree: 0, quality: "maj7", steps: 16 }], [{ degree: 9, quality: "m7", steps: 16 }], [{ degree: 2, quality: "m7", steps: 16 }], [{ degree: 7, quality: "7", steps: 16 }]] }] };
    let boundaries = 0;
    for (const seed of SEEDS) {
      const seq = chordSequence(compose(seed, 600, style));
      for (let i = 1; i < seq.length; i++) {
        const [a, b] = [seq[i - 1]!, seq[i]!];
        expect(isV7(a.chord, b.key) && isI(b.chord, b.key), `seed ${seed} bar ${b.bar}`).toBe(false);
        if (b.bar % 4 === 0 && isI(b.chord, b.key) && a.chord.root === pitchClass(b.key.tonic + 7)) {
          boundaries++;
          expect(a.chord.quality).toBe("7sus4");
        }
      }
    }
    expect(boundaries).toBeGreaterThan(50);
  });
});

describe("H-4 progressions", () => {
  it("bars form 4-bar progressions at multiples of 4, each a template in the key, only H-3's sus4 replacements allowed", () => {
    const susOf: Record<string, Quality> = { "7": "7sus4", "7b9": "7sus4", "9": "9sus4", "13": "13sus4" };
    const used = new Set<number>();
    for (const seed of SEEDS) {
      const bars = music(seed);
      for (let p = 0; p + 4 <= bars.length; p += 4) {
        const block = bars.slice(p, p + 4);
        const key = block[0]!.key;
        expect(block.every((b) => b.key.tonic === key.tonic && b.key.mode === key.mode && b.bpm === block[0]!.bpm)).toBe(true);
        // The templates' tonic: the key's, or its relative major's (the tests' own transposition)
        const tonic = key.mode === "minor" ? pitchClass(key.tonic + 3) : key.tonic;
        const match = CHILL.templates.findIndex((tpl) =>
          tpl.bars.every((cells, b) => {
            const chords = block[b]!.chords;
            return (
              chords.length === cells.length &&
              cells.every((cell, k) => {
                const got = chords[k]!;
                const root = pitchClass(tonic + cell.degree);
                return got.steps === cell.steps && got.chord.root === root && (got.chord.quality === cell.quality || got.chord.quality === susOf[cell.quality]);
              })
            );
          }),
        );
        expect(match, `seed ${seed} bars ${p}–${p + 3}`).toBeGreaterThanOrEqual(0);
        used.add(match);
      }
    }
    expect(used.size).toBe(CHILL.templates.length);
    // The tests' transposition agrees with E04's for a minor key (A minor plays the C templates)
    expect(transpose(CHILL.templates[2]!, { tonic: 9, mode: "minor" })[3]![0]!.chord).toEqual({ root: 0, quality: "maj7" });
  });
});

describe("H-4 template weights", () => {
  it("weights 3, 3, 2, 2, the previous template's halved: each boundary of the cumulative weights, from just below and just above", () => {
    for (const previous of [null, 0, 1, 2, 3]) {
      // The test's own reading of H-4
      const weights = [3, 3, 2, 2].map((w, i) => (i === previous ? w / 2 : w));
      const total = weights.reduce((a, b) => a + b, 0);
      let cumulative = 0;
      for (let i = 0; i < 4; i++) {
        const low = cumulative / total;
        cumulative += weights[i]!;
        const high = cumulative / total;
        for (const u of [low + 1e-9, (low + high) / 2, Math.min(high - 1e-9, 1 - 1e-12)]) {
          expect(drawTemplate(CHILL, previous, { next: () => u }), `previous ${previous}, u ${u}`).toBe(i);
        }
      }
    }
  });
});

describe("H-5 key changes", () => {
  it("gap = 32 + 4 floor(9u) at fixed u", () => {
    expect([0, 0.5, 0.999].map(keyChangeGap)).toEqual([32, 48, 64]);
  });

  it("with real seeds, changes come 32–64 bars apart at progression starts, to the relative key, a minor third up, or the parallel key", () => {
    const targets = new Set<string>();
    for (const seed of SEEDS) {
      const bars = music(seed);
      let last = 0;
      for (let i = 1; i < bars.length; i++) {
        const [a, b] = [bars[i - 1]!.key, bars[i]!.key];
        if (a.tonic === b.tonic && a.mode === b.mode) continue;
        expect(i % 4).toBe(0);
        expect(i - last).toBeGreaterThanOrEqual(32);
        expect(i - last).toBeLessThanOrEqual(64);
        last = i;
        const relative = a.mode === "major" ? b.mode === "minor" && b.tonic === pitchClass(a.tonic + 9) : b.mode === "major" && b.tonic === pitchClass(a.tonic + 3);
        const third = b.mode === a.mode && b.tonic === pitchClass(a.tonic + 3);
        const parallel = b.mode !== a.mode && b.tonic === a.tonic;
        expect(relative || third || parallel, `seed ${seed} bar ${i}`).toBe(true);
        targets.add(relative ? "relative" : third ? "third" : "parallel");
      }
      expect(last).toBeGreaterThan(0);
      expect(bars.length - last).toBeLessThanOrEqual(64);
    }
    expect(targets).toEqual(new Set(["relative", "third", "parallel"]));
  });

  it("H-5, RH-1 with a Random that records its draws: the first key and tempo, and at each change the target, tempo, and next gap, come from the draws by the rules", () => {
    let changes = 0;
    const picked = [0, 0, 0];
    for (const seed of SEEDS) {
      const real = createRandom(seed);
      const drawn: number[] = [];
      const spy: Random = { next: () => drawn[drawn.push(real.next()) - 1]! };
      let state = createComposer(CHILL, spy);
      // The composer's start draws the tonic, the mode, the tempo, then the first gap
      const [tonicU, modeU, tempoU, gapU] = drawn as [number, number, number, number];
      const bars: Bar[] = [];
      const windows: number[][] = [];
      while (state.time < HALF_HOUR) {
        const before = drawn.length;
        const next = nextBar(state, spy);
        windows.push(drawn.slice(before));
        bars.push(next.bar);
        state = next.state;
      }
      // Uniform over the 24 keys: tonic floor(12u), major if u′ < 0.5
      expect(bars[0]!.key).toEqual({ tonic: Math.floor(12 * tonicU), mode: modeU < 0.5 ? "major" : "minor" });
      expect(bars[0]!.bpm).toBeCloseTo(72 + 12 * tempoU, 9);
      let change = 32 + 4 * Math.floor(9 * gapU);
      for (let j = 4; j < bars.length; j += 4) {
        const [a, b] = [bars[j - 1]!.key, bars[j]!.key];
        const changed = a.tonic !== b.tonic || a.mode !== b.mode;
        expect(changed, `seed ${seed} bar ${j}`).toBe(j === change);
        if (!changed) continue;
        // The progression starting at bar j was drawn first thing in bar j − 4: the target, the tempo, the next gap
        const [targetU, nextTempoU, nextGapU] = windows[j - 4] as [number, number, number];
        const targets: Key[] = [
          a.mode === "major" ? { tonic: pitchClass(a.tonic + 9), mode: "minor" } : { tonic: pitchClass(a.tonic + 3), mode: "major" },
          { tonic: pitchClass(a.tonic + 3), mode: a.mode },
          { tonic: a.tonic, mode: a.mode === "major" ? "minor" : "major" },
        ];
        // Equal weights: thirds of [0, 1)
        const i = Math.floor(3 * targetU);
        expect(b, `seed ${seed} bar ${j}`).toEqual(targets[i]);
        picked[i]!++;
        expect(bars[j]!.bpm).toBeCloseTo(72 + 12 * nextTempoU, 9);
        change = j + 32 + 4 * Math.floor(9 * nextGapU);
        changes++;
      }
    }
    expect(changes).toBeGreaterThan(20);
    expect(picked.every((n) => n > 0)).toBe(true);
  });
});

describe("V-1–V-4 voicing and bass", () => {
  /** The allowed tones of V-1, read from docs/02 by the test. */
  function allowed(c: Chord) {
    const pcs = chordPitchClasses(c.root, c.quality);
    const at = (i: number) => pitchClass(c.root + i);
    const third = c.quality.endsWith("sus4") ? at(5) : pcs.includes(at(3)) && !pcs.includes(at(4)) ? at(3) : at(4);
    const seventh = c.quality.startsWith("maj") ? at(11) : at(10);
    const ninth = c.quality === "7b9" ? at(13) : at(14);
    return { third, seventh, all: [third, seventh, ninth, at(7), at(9)] };
  }

  it("V-1, V-2: upper voices are allowed tones with the 3rd (or 4th) and 7th, never the root, in MIDI 48–72", () => {
    for (const { bar } of allBars()) {
      for (const c of bar.chords) {
        const pcs = c.voicing.map(pitchClass);
        const a = allowed(c.chord);
        expect(pcs.every((pc) => a.all.includes(pc))).toBe(true);
        expect(pcs).toContain(a.third);
        expect(pcs).toContain(a.seventh);
        expect(pcs).not.toContain(c.chord.root);
        expect(new Set(c.voicing).size).toBe(4);
        expect(c.voicing.every((m) => m >= 48 && m <= 72)).toBe(true);
      }
    }
    // The check rejects foreign tones: a Cmaj7 voicing with F♯ or A♭
    const cmaj7 = allowed({ root: 0, quality: "maj7" });
    expect(cmaj7.all).not.toContain(6);
    expect(cmaj7.all).not.toContain(8);
  });

  /**
   * V-3 by the test's own enumeration: the voicings satisfying V-1 and V-2 with the smallest total movement from
   * `previous`, and among them the rule's choice (lower sum of pitches, then lower pitches from the bottom up).
   */
  function rulesChoice(chord: Chord, previous: readonly number[]): { tied: number[][]; choice: number[] } {
    const a = allowed(chord);
    const pool: number[] = [];
    for (let m = 48; m <= 72; m++) if (a.all.includes(pitchClass(m))) pool.push(m);
    let best = Number.POSITIVE_INFINITY;
    let tied: number[][] = [];
    for (let i = 0; i < pool.length; i++)
      for (let j = i + 1; j < pool.length; j++)
        for (let k = j + 1; k < pool.length; k++)
          for (let l = k + 1; l < pool.length; l++) {
            const v = [pool[i]!, pool[j]!, pool[k]!, pool[l]!];
            const pcs = new Set(v.map(pitchClass));
            if (pcs.size !== 4 || !pcs.has(a.third) || !pcs.has(a.seventh)) continue;
            const move = v.reduce((s, m, x) => s + Math.abs(m - previous[x]!), 0);
            if (move < best) [best, tied] = [move, [v]];
            else if (move === best) tied.push(v);
          }
    const sum = (v: number[]) => v.reduce((s, m) => s + m, 0);
    const choice = [...tied].sort((x, y) => sum(x) - sum(y) || x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]! || x[3]! - y[3]!)[0]!;
    return { tied, choice };
  }

  it("V-3: each voicing moves least among all voicings that satisfy V-1 and V-2, and ties go by the lower sum, then the lower pitches (enumerated by the test)", () => {
    let ties = 0;
    for (const seed of SEEDS) {
      const seq = chordSequence(music(seed));
      let previous = [55, 59, 62, 65];
      for (const c of seq) {
        const { tied, choice } = rulesChoice(c.chord, previous);
        expect(c.voicing, `seed ${seed} bar ${c.bar}`).toEqual(choice);
        if (tied.length > 1) ties++;
        previous = c.voicing;
      }
    }
    expect(ties).toBeGreaterThan(50); // the tie-breaks are really exercised
    // A tie on movement decided by the sum: D7♭9 from the reference voicing
    const d7b9: Chord = { root: 2, quality: "7b9" };
    const { tied, choice } = rulesChoice(d7b9, [55, 59, 62, 65]);
    expect(tied.length).toBeGreaterThan(1);
    expect(voiceLead(d7b9, [55, 59, 62, 65])).toEqual(choice);
    expect(choice).toEqual([54, 59, 60, 63]);
  });

  it("V-4: each chord's bass is exactly its root at the chord's start for 3 steps and, if the chord is longer than 8 steps, its fifth 8 steps later for 3 steps, 12–24 below the lowest upper voice", () => {
    let fifths = 0;
    let bassBars = 0;
    for (const { bar } of allBars()) {
      const got = bar.notes.filter((x) => x.layer === "bass");
      if (!bar.layers.includes("bass")) {
        expect(got).toHaveLength(0);
        continue;
      }
      bassBars++;
      const expected = bar.chords.flatMap((c) => [
        { step: c.startStep, pc: c.chord.root, lowest: c.voicing[0]! },
        ...(c.steps > 8 ? [{ step: c.startStep + 8, pc: pitchClass(c.chord.root + 7), lowest: c.voicing[0]! }] : []),
      ]);
      expect(got.map((n) => n.step), `bar ${bar.index}`).toEqual(expected.map((e) => e.step));
      got.forEach((n, i) => {
        const e = expected[i]!;
        expect(pitchClass(n.midi!)).toBe(e.pc);
        expect(e.lowest - n.midi!).toBeGreaterThanOrEqual(12);
        expect(e.lowest - n.midi!).toBeLessThanOrEqual(24);
        expect(n.length).toBeCloseTo(swungAt(n.step + 3, bar.bpm) - swungAt(n.step, bar.bpm), 9);
        if (e.pc !== bar.chords.find((c) => n.step >= c.startStep && n.step < c.startStep + c.steps)!.chord.root) fifths++;
      });
    }
    expect(bassBars).toBeGreaterThan(0);
    expect(fifths).toBeGreaterThan(0);
  });
});

describe("RH rhythm", () => {
  it("RH-1: 72 + 12u at fixed u; with real seeds every tempo is in [72, 84) and changes only with the key", () => {
    expect(tempo(0)).toBe(72);
    expect(tempo(0.5)).toBe(78);
    expect(tempo(0.999)).toBeCloseTo(83.988, 9);
    let changes = 0;
    for (const seed of SEEDS) {
      const bars = music(seed);
      bars.forEach((bar, i) => {
        expect(bar.bpm).toBeGreaterThanOrEqual(72);
        expect(bar.bpm).toBeLessThan(84);
        if (i > 0 && bar.bpm !== bars[i - 1]!.bpm) {
          changes++;
          const [a, b] = [bars[i - 1]!.key, bar.key];
          expect(a.tonic !== b.tonic || a.mode !== b.mode).toBe(true);
        }
      });
    }
    expect(changes).toBeGreaterThan(0);
  });

  /** Seconds from the bar's start to step s with 58% swing, the test's own reading of RH-2. */
  const swung = (s: number, bpm: number) => {
    const eighth = (2 * 60) / bpm / 4;
    return Math.floor(s / 2) * eighth + (s % 2 === 1 ? 0.58 * eighth : 0);
  };

  it("RH-2, RH-5: notes start (before jitter) at their swung step; chords strum up from the lowest, 12 ms apart", () => {
    let offbeats = 0;
    for (const { bar } of allBars()) {
      for (const group of strums(bar)) {
        const sorted = [...group].sort((a, b) => a.midi! - b.midi!);
        sorted.forEach((n, k) => expect(n.nominal - bar.start, `bar ${bar.index}`).toBeCloseTo(swung(n.step, bar.bpm) + 0.012 * k, 9));
      }
      for (const n of bar.notes.filter((x) => x.layer === "bass" || x.layer === "melody" || x.drum === "hat" || x.drum === "kick")) {
        expect(n.nominal - bar.start).toBeCloseTo(swung(n.step, bar.bpm), 9);
        if (n.step % 2 === 1) offbeats++;
      }
    }
    expect(offbeats).toBeGreaterThan(100);
  });

  it("RH-5: every voice of a strummed chord ends at its onset's end: the pad at the chord's end, the electric piano at the next onset, the chord's end, or 6 steps, whichever is first", () => {
    let checked = 0;
    for (const { bar } of allBars()) {
      const groups = strums(bar);
      const epianoSteps = groups.filter((g) => g[0]!.layer === "epiano").map((g) => g[0]!.step).sort((a, b) => a - b);
      for (const group of groups) {
        const { layer, step } = group[0]!;
        const c = bar.chords.find((ch) => step >= ch.startStep && step < ch.startStep + ch.steps)!;
        const chordEnd = c.startStep + c.steps;
        const end = layer === "pad" ? chordEnd : Math.min(epianoSteps.find((s) => s > step) ?? 16, chordEnd, step + 6);
        for (const n of group) {
          expect(n.nominal + n.length - bar.start, `bar ${bar.index} ${layer} step ${step}`).toBeCloseTo(swungAt(end, bar.bpm), 9);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("RH-3: in every bar with drums, kicks on steps 0 and 10, a snare on step 8 played 15 ms late, nothing else but hats", () => {
    let drumBars = 0;
    for (const { bar } of allBars()) {
      const drums = bar.notes.filter((n) => n.layer === "drums");
      if (!bar.layers.includes("drums")) {
        expect(drums).toHaveLength(0);
        continue;
      }
      drumBars++;
      expect(drums.filter((n) => n.drum === "kick").map((n) => n.step)).toEqual([0, 10]);
      const snares = drums.filter((n) => n.drum === "snare");
      expect(snares.map((n) => n.step)).toEqual([8]);
      expect(snares[0]!.nominal - bar.start).toBeCloseTo(swung(8, bar.bpm) + 0.015, 9);
      expect(drums.every((n) => n.drum === "kick" || n.drum === "snare" || (n.drum === "hat" && n.step % 2 === 0))).toBe(true);
    }
    expect(drumBars).toBeGreaterThan(0);
  });

  it("RH-3: a hat is kept if its draw is below 0.75; over seeds 1–5, 75% ± 2% of the 8th-note hats are kept", () => {
    for (const [u, kept] of [[0, true], [0.75 - 1e-9, true], [0.75, false], [0.999, false]] as const) expect(keepsHat(u), `u ${u}`).toBe(kept);
    let slots = 0;
    let hats = 0;
    for (const { bar } of allBars()) {
      if (!bar.layers.includes("drums")) continue;
      slots += 8;
      hats += bar.notes.filter((n) => n.drum === "hat").length;
    }
    expect(slots).toBeGreaterThan(2000);
    expect(Math.abs(hats / slots - 0.75)).toBeLessThanOrEqual(0.02);
  });

  it("RH-4: offset −8 + 16u ms and factor 0.85 + 0.30u′ at fixed u", () => {
    for (const [u, offset, factor] of [[0, -8, 0.85], [0.5, 0, 1], [0.999, 7.984, 1.1497]] as const) {
      expect(wobble(u, u).offsetMs).toBeCloseTo(offset, 9);
      expect(wobble(u, u).factor).toBeCloseTo(factor, 9);
    }
  });

  it("RH-4: over 30 minutes each 8th of each range holds 12.5% ± 3% of the notes, and offset and factor are independent", () => {
    const base = (n: Note) => (n.layer === "drums" ? CHILL.velocity[n.drum!] : CHILL.velocity[n.layer as "pad"]);
    const us: number[] = [];
    const vs: number[] = [];
    for (const { bar } of allBars()) {
      for (const n of bar.notes) {
        us.push(((n.time - n.nominal) * 1000 + 8) / 16);
        vs.push((n.velocity / base(n) - 0.85) / 0.3);
      }
    }
    for (const values of [us, vs]) {
      const bins = new Array<number>(8).fill(0);
      for (const v of values) {
        expect(v).toBeGreaterThanOrEqual(-1e-9);
        expect(v).toBeLessThan(1);
        bins[Math.min(7, Math.floor(8 * v))]!++;
      }
      for (const b of bins) expect(Math.abs(b / values.length - 0.125)).toBeLessThanOrEqual(0.03);
    }
    // #8: a shared draw would make them equal; the joint 4 × 4 grid is filled evenly and the correlation is near 0
    const grid = new Array<number>(16).fill(0);
    us.forEach((u, i) => grid[Math.min(3, Math.floor(4 * u)) * 4 + Math.min(3, Math.floor(4 * vs[i]!))]!++);
    for (const g of grid) expect(Math.abs(g / us.length - 1 / 16)).toBeLessThanOrEqual(0.02);
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    const [mu, mv] = [mean(us), mean(vs)];
    const cov = mean(us.map((u, i) => (u - mu) * (vs[i]! - mv)));
    const r = cov / Math.sqrt(mean(us.map((u) => (u - mu) ** 2)) * mean(vs.map((v) => (v - mv) ** 2)));
    expect(Math.abs(r)).toBeLessThan(0.05);
  });

  it("RH-4: each note takes two draws of its own, u first (a recording Random)", () => {
    const real = createRandom(3);
    const drawn: number[] = [];
    const spy: Random = { next: () => drawn[drawn.push(real.next()) - 1]! };
    let state = createComposer(CHILL, spy);
    for (let i = 0; i < 40; i++) {
      const before = drawn.length;
      const { bar, state: next } = nextBar(state, spy);
      state = next;
      const window = drawn.slice(before);
      // Every note's offset and factor come from a consecutive pair in this bar's draws, pairs in note order
      let from = 0;
      for (const n of bar.notes) {
        const u = ((n.time - n.nominal) * 1000 + 8) / 16;
        let k = from;
        while (k + 1 < window.length && !(Math.abs(window[k]! - u) < 1e-9 && Math.abs(0.85 + 0.3 * window[k + 1]! - n.velocity / (n.layer === "drums" ? CHILL.velocity[n.drum!] : CHILL.velocity[n.layer as "pad"])) < 1e-9)) k++;
        expect(k + 1 < window.length, `bar ${bar.index} note at step ${n.step}`).toBe(true);
        from = k + 2;
      }
    }
  });
});

describe("M melody", () => {
  const melodyPhrases = () =>
    SEEDS.flatMap((seed) => {
      const byPhrase = new Map<number, Bar[]>();
      for (const bar of music(seed)) if (bar.layers.includes("melody")) byPhrase.set(phraseOf(bar), [...(byPhrase.get(phraseOf(bar)) ?? []), bar]);
      return [...byPhrase.values()].filter((bars) => bars.length === 8);
    });

  it("M-1: every melody note is in the scale of the key in force", () => {
    let notes = 0;
    for (const { bar } of allBars()) {
      for (const n of bar.notes.filter((x) => x.layer === "melody")) {
        expect(scale(bar.key)).toContain(pitchClass(n.midi!));
        notes++;
      }
    }
    expect(notes).toBeGreaterThan(100);
  });

  it("M-2: every melody note is in MIDI 65–83, and every phrase's melody spans at most 18 semitones", () => {
    let notes = 0;
    for (const { bar } of allBars()) {
      for (const n of bar.notes.filter((x) => x.layer === "melody")) {
        expect(n.midi!, `bar ${bar.index}`).toBeGreaterThanOrEqual(65);
        expect(n.midi!, `bar ${bar.index}`).toBeLessThanOrEqual(83);
        notes++;
      }
    }
    expect(notes).toBeGreaterThan(100);
    for (const bars of melodyPhrases()) {
      const pitches = bars.flatMap((b) => b.notes.filter((n) => n.layer === "melody").map((n) => n.midi!));
      expect(Math.max(...pitches) - Math.min(...pitches)).toBeLessThanOrEqual(18);
    }
  });

  it("M-3: the three later 2-bar blocks of a phrase keep the first block's onset steps and lengths in steps", () => {
    const phrases = melodyPhrases();
    expect(phrases.length).toBeGreaterThan(5);
    /** A note's length in 16th steps, from its length in seconds at its bar's tempo */
    const steps = (bar: Bar, n: Note) => {
      for (let k = 1; k <= 16 - n.step; k++) if (Math.abs(swungAt(n.step + k, bar.bpm) - swungAt(n.step, bar.bpm) - n.length) < 1e-9) return k;
      throw new Error("length is not a whole number of steps");
    };
    for (const bars of phrases) {
      const onsets = (k: number) => [0, 1].flatMap((h) => bars[2 * k + h]!.notes.filter((n) => n.layer === "melody").map((n) => [16 * h + n.step, steps(bars[2 * k + h]!, n)]));
      for (const k of [1, 2, 3]) expect(onsets(k)).toEqual(onsets(0));
    }
  });

  it("M-3: every melody note is its motif note bent to the nearest allowed pitch (lower on a tie)", () => {
    expect(bend(70, [67, 69, 72, 74])).toBe(69);
    expect(bend(71, [69, 73])).toBe(69); // a tie goes to the lower
    expect(bend(71, [73, 69])).toBe(69); // whatever the order
    expect(bend(80, [65, 67])).toBe(67);
    let checked = 0;
    for (const seed of SEEDS) {
      const rng = createRandom(seed);
      let state = createComposer(CHILL, rng);
      while (state.time < HALF_HOUR) {
        const { bar, state: next } = nextBar(state, rng);
        state = next;
        for (const n of bar.notes.filter((x) => x.layer === "melody")) {
          const motif = state.motif!;
          expect(motif.phrase).toBe(phraseOf(bar));
          const o = motif.onsets.find((x) => x.step === 16 * (bar.index % 2) + n.step)!;
          const chord = bar.chords.find((c) => n.step >= c.startStep && n.step < c.startStep + c.steps)!.chord;
          // The nearest allowed pitch by the test's own search: lowest distance, then lowest pitch
          const allowed = melodyPitches(bar.key, chord, n.step);
          const best = [...allowed].sort((a, b) => Math.abs(a - o.pitch) - Math.abs(b - o.pitch) || a - b)[0];
          expect(n.midi).toBe(best);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("M-3, M-4: a motif has 4–7 onsets on distinct steps, 1–2 steps each, at most 14 steps sounding, walking at most 2 scale steps", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const key: Key = { tonic: seed % 12, mode: seed % 2 ? "major" : "minor" };
      const m = drawMotif(0, key, createRandom(seed));
      expect(m.onsets.length).toBeGreaterThanOrEqual(4);
      expect(m.onsets.length).toBeLessThanOrEqual(7);
      const inScale: number[] = [];
      for (let p = 65; p <= 83; p++) if (scale(key).includes(pitchClass(p))) inScale.push(p);
      m.onsets.forEach((o, i) => {
        expect(o.steps === 1 || o.steps === 2).toBe(true);
        if (i > 0) {
          expect(o.step).toBeGreaterThanOrEqual(m.onsets[i - 1]!.step + m.onsets[i - 1]!.steps);
          expect(Math.abs(inScale.indexOf(o.pitch) - inScale.indexOf(m.onsets[i - 1]!.pitch))).toBeLessThanOrEqual(2);
        }
        expect(inScale).toContain(o.pitch);
      });
      expect(m.onsets.at(-1)!.step + m.onsets.at(-1)!.steps).toBeLessThanOrEqual(32);
      expect(m.onsets.reduce((s, o) => s + o.steps, 0)).toBeLessThanOrEqual(14);
    }
  });

  it("M-4: more than half of each phrase's steps are rests; notes on beats 1 and 3 are chord tones", () => {
    for (const bars of melodyPhrases()) {
      let sounding = 0;
      for (const bar of bars) {
        const steps = new Set<number>();
        for (const n of bar.notes.filter((x) => x.layer === "melody")) {
          // The steps a note covers: from its onset until its length runs out (lengths are 1 or 2 steps)
          const end = bar.start + (n.nominal - bar.start) + n.length;
          for (let s = n.step; s < 16 && bar.start + swungAt(s, bar.bpm) < end - 1e-9; s++) steps.add(s);
          if (n.step === 0 || n.step === 8) {
            const c = bar.chords.find((ch) => n.step >= ch.startStep && n.step < ch.startStep + ch.steps)!;
            expect(chordPitchClasses(c.chord.root, c.chord.quality)).toContain(pitchClass(n.midi!));
          }
        }
        sounding += steps.size;
      }
      expect(sounding).toBeLessThan(64);
    }
  });

  it("every chord of every template in every key has an allowed melody pitch on beats 1 and 3", () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of ["major", "minor"] as const) {
        for (const tpl of CHILL.templates) {
          for (const bar of transpose(tpl, { tonic, mode })) {
            for (const { chord } of bar) {
              for (const q of [chord.quality, "7sus4", "9sus4", "13sus4"] as Quality[]) {
                if (q !== chord.quality && !DOMINANT.includes(chord.quality)) continue;
                expect(melodyPitches({ tonic, mode }, { ...chord, quality: q }, 0).length).toBeGreaterThan(0);
              }
            }
          }
        }
      }
    }
  });
});

const swungAt = (s: number, bpm: number) => {
  const eighth = (2 * 60) / bpm / 4;
  return Math.floor(s / 2) * eighth + (s % 2 === 1 ? 0.58 * eighth : 0);
};

describe("F form", () => {
  const LIST = ["P", "PE", "PEB", "PEBD", "PEBDM", "PEBM", "PEBDM", "PEBM", "PEM", "PE"];
  const code = (layers: readonly string[]) =>
    ["pad", "epiano", "bass", "drums", "melody"].filter((l) => layers.includes(l)).map((l) => ({ pad: "P", epiano: "E", bass: "B", drums: "D", melody: "M" })[l]).join("");

  it("F-1: the layer sets per phrase follow the list (1–10, then 3–10 again) and never change inside a phrase", () => {
    for (const seed of SEEDS) {
      const bars = music(seed);
      bars.forEach((bar) => {
        const p = phraseOf(bar);
        const expected = LIST[p < 10 ? p : 2 + ((p - 10) % 8)]!;
        expect(code(bar.layers), `seed ${seed} bar ${bar.index}`).toBe(expected);
        const notesLayers = new Set(bar.notes.map((n) => n.layer));
        for (const layer of notesLayers) expect(bar.layers).toContain(layer);
      });
      expect(phraseOf(bars.at(-1)!)).toBeGreaterThan(10); // the loop really came round
    }
  });

  it("F-2: never more than 4 consecutive phrases with drums, and drums appear", () => {
    for (const seed of SEEDS) {
      const phrases = new Map<number, boolean>();
      for (const bar of music(seed)) phrases.set(phraseOf(bar), bar.layers.includes("drums"));
      let run = 0;
      let any = false;
      for (const drums of phrases.values()) {
        run = drums ? run + 1 : 0;
        any ||= drums;
        expect(run).toBeLessThanOrEqual(4);
      }
      expect(any).toBe(true);
    }
  });

  it("F-3: a chime is exactly one note, the key's tonic in octave 5 plus 7 or 14, also right after a key change", () => {
    const rng = createRandom(8);
    const seen = new Set<number>();
    const keys: Key[] = [];
    for (let tonic = 0; tonic < 12; tonic++) keys.push({ tonic, mode: "major" }, { tonic, mode: "minor" });
    // The keys in force right after each key change of the generated music
    for (const seed of SEEDS) {
      const bars = music(seed);
      for (let i = 1; i < bars.length; i++) if (bars[i]!.key !== bars[i - 1]!.key && bars[i]!.key.tonic !== bars[i - 1]!.key.tonic) keys.push(bars[i]!.key);
    }
    for (const key of keys) {
      for (let k = 0; k < 10; k++) {
        const note = chimeNote(key, 12.5, rng);
        expect(note.layer).toBe("chime");
        expect(note.nominal).toBe(12.5);
        expect(Math.abs(note.time - 12.5)).toBeLessThanOrEqual(0.008);
        const tonic = 72 + key.tonic;
        expect(tonic).toBeGreaterThanOrEqual(72);
        expect(tonic).toBeLessThanOrEqual(83);
        expect([tonic + 7, tonic + 14]).toContain(note.midi);
        seen.add(note.midi! - tonic);
      }
    }
    expect(seen).toEqual(new Set([7, 14]));
  });

  it("F-3, RH-4: the chime takes the wobble from the two draws after its choice", () => {
    for (const [u, choice, offset, factor] of [[0, 7, -8, 0.85], [0.5, 14, 0, 1], [0.999, 14, 7.984, 1.1497]] as const) {
      const note = chimeNote({ tonic: 0, mode: "major" }, 10, { next: () => u });
      expect(note.midi).toBe(72 + choice);
      expect((note.time - 10) * 1000).toBeCloseTo(offset, 9);
      expect(note.velocity).toBeCloseTo(CHILL.velocity.chime * factor, 9);
    }
    const draws = [0.9, 0.25, 0.75];
    const note = chimeNote({ tonic: 2, mode: "minor" }, 3, { next: () => draws.shift()! });
    expect([note.midi, (note.time - 3) * 1000, note.velocity / CHILL.velocity.chime]).toEqual([88, expect.closeTo(-4, 9), expect.closeTo(1.075, 9)]);
    expect(draws).toEqual([]);
  });
});

describe("R-10 no repeats", () => {
  it("no 16-bar window of notes (layer, pitch or drum, bar offset, step) appears twice in 30 minutes", () => {
    for (const seed of SEEDS) {
      const bars = music(seed);
      const barKeys = bars.map((bar) =>
        bar.notes
          .map((n) => `${n.layer}:${n.midi ?? n.drum}:${n.step}`)
          .sort()
          .join(","),
      );
      const windows = new Set<string>();
      for (let i = 0; i + 16 <= bars.length; i++) windows.add(barKeys.slice(i, i + 16).join("|"));
      expect(windows.size, `seed ${seed}`).toBe(bars.length - 15);
    }
  });
});
