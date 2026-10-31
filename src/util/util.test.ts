import { describe, expect, it } from "vitest";
import { Clock, MAX_STEPS_PER_FRAME, STEP_SECONDS } from "./clock";
import { QUALITIES, chordPitchClasses, frequencyToMidi, midiToFrequency, pitchClass, scalePitchClasses } from "./pitch";
import { between, createRandom, integer } from "./random";

describe("U02 Random", () => {
  it("repeats the same sequence for the same seed and differs for another", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const c = createRandom(43);
    const sa = Array.from({ length: 100 }, () => a.next());
    expect(Array.from({ length: 100 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 100 }, () => c.next())).not.toEqual(sa);
  });

  it("returns values in [0, 1) that cover both halves", () => {
    const rng = createRandom(7);
    const values = Array.from({ length: 10000 }, () => rng.next());
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(values.filter((v) => v < 0.5).length).toBeGreaterThan(4500);
    expect(values.filter((v) => v >= 0.5).length).toBeGreaterThan(4500);
  });

  it("between and integer stay in their ranges and reach both ends of integer", () => {
    const rng = createRandom(1);
    const ints = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const x = between(rng, 2, 3);
      expect(x).toBeGreaterThanOrEqual(2);
      expect(x).toBeLessThan(3);
      ints.add(integer(rng, 3, 5));
    }
    expect([...ints].sort()).toEqual([3, 4, 5]);
  });

  it("rejects a seed that is not finite", () => {
    for (const seed of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(() => createRandom(seed)).toThrow(RangeError);
  });
});

describe("U03 Pitch (C-3)", () => {
  it("maps MIDI to 12-TET frequencies with A4 = 440 Hz", () => {
    expect(midiToFrequency(69)).toBe(440);
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 2);
    expect(midiToFrequency(81)).toBeCloseTo(880, 10);
  });

  it("frequency → MIDI is the inverse", () => {
    for (const midi of [0, 21, 48, 60, 69, 72, 108, 127]) expect(frequencyToMidi(midiToFrequency(midi))).toBeCloseTo(midi, 9);
  });

  it("rejects values outside the domain", () => {
    expect(() => midiToFrequency(Number.NaN)).toThrow(RangeError);
    for (const f of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => frequencyToMidi(f)).toThrow(RangeError);
  });
});

describe("U03 chords and scales (docs/02 E04 \"Data\", M-1)", () => {
  it("spells each quality as the table in docs/02 says", () => {
    expect(QUALITIES).toEqual({
      maj7: [0, 4, 7, 11],
      maj9: [0, 4, 7, 11, 14],
      m7: [0, 3, 7, 10],
      m9: [0, 3, 7, 10, 14],
      "7": [0, 4, 7, 10],
      "9": [0, 4, 7, 10, 14],
      "13": [0, 4, 7, 10, 14, 21],
      "7b9": [0, 4, 7, 10, 13],
      "7sus4": [0, 5, 7, 10],
      "9sus4": [0, 5, 7, 10, 14],
      "13sus4": [0, 5, 7, 10, 14, 21],
    });
    expect(chordPitchClasses(9, "7b9")).toEqual([9, 1, 4, 7, 10]); // A7(♭9): A C♯ E G B♭
    expect(chordPitchClasses(7, "13sus4")).toEqual([7, 0, 2, 5, 9, 4]); // G13sus4: G C D F A E
  });

  it("scales: the major pentatonic; the minor pentatonic plus the 9th and 13th", () => {
    expect(scalePitchClasses(0, "major")).toEqual([0, 2, 4, 7, 9]); // C D E G A
    expect(scalePitchClasses(9, "minor")).toEqual([9, 11, 0, 2, 4, 6, 7]); // A B C D E F♯ G
    for (const n of [-13, -1, 0, 11, 12, 25]) expect(pitchClass(n)).toBe(((n % 12) + 12) % 12);
  });
});

describe("U01 Clock", () => {
  it("turns frame times into whole 1/60 s steps, carrying the remainder", () => {
    const clock = new Clock("live");
    expect(clock.advance(1000)).toBe(0); // the first frame only sets the origin
    expect(clock.advance(1000 + 1000 / 60)).toBe(1);
    expect(clock.advance(1000 + 1000 / 60 + 8)).toBe(0);
    expect(clock.advance(1000 + 1000 / 60 + 17)).toBe(1); // 8 + 9 ms ≥ one step
    expect(clock.time).toBeCloseTo(2 * STEP_SECONDS, 12);
  });

  it("caps the steps after a long gap and does not catch up later", () => {
    const clock = new Clock("live");
    clock.advance(0);
    expect(clock.advance(60_000)).toBe(MAX_STEPS_PER_FRAME);
    expect(clock.advance(60_000 + 1000 / 60)).toBe(1);
  });

  it("takes no steps when still or paused, and does not catch up after resuming", () => {
    for (const mode of ["still", "paused"] as const) {
      const clock = new Clock("live");
      clock.advance(0);
      clock.setMode(mode);
      expect(clock.advance(5000)).toBe(0);
      clock.setMode("live");
      expect(clock.advance(10_000)).toBe(0);
      expect(clock.advance(10_000 + 1000 / 60)).toBe(1);
    }
  });

  it("fixed mode moves only by stepFixed", () => {
    const clock = new Clock("fixed");
    expect(clock.advance(1000)).toBe(0);
    clock.stepFixed(120);
    expect(clock.time).toBeCloseTo(2, 12);
    expect(() => clock.stepFixed(-1)).toThrow(RangeError);
    expect(() => new Clock("live").stepFixed(1)).toThrow();
  });

  it("rejects a frame time that is not finite", () => {
    expect(() => new Clock("live").advance(Number.NaN)).toThrow(RangeError);
  });
});
