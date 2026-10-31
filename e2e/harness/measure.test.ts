// The measuring code of the sound renders, checked on signals whose answers are known.
import { describe, expect, it } from "vitest";
import { centroid, kWeighting, momentaryLoudness, peakDb, powerSpectrum, report, windows } from "./measure";

const RATE = 48000;
const sine = (hz: number, seconds: number, amplitude = 1, rate = RATE) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate));

describe("sound measurements", () => {
  it("K-weighting at 48 kHz has the coefficients published in ITU-R BS.1770", () => {
    const [shelf, highpass] = kWeighting(48000);
    const expected = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
    shelf.forEach((c, i) => expect(c).toBeCloseTo(expected[i]!, 9));
    expect(highpass[3]).toBeCloseTo(-1.99004745483398, 9);
    expect(highpass[4]).toBeCloseTo(0.99007225036621, 9);
  });

  it("a full-scale 1 kHz sine reads −3.01 LUFS (one channel), at 48 and 44.1 kHz", () => {
    for (const rate of [48000, 44100]) {
      const values = momentaryLoudness(sine(1000, 2, 1, rate), rate).slice(2);
      for (const { lufs } of values) expect(lufs).toBeCloseTo(-3.01, 1);
    }
  });

  it("peak of a half-scale sine is −6.02 dBFS; the centroid of a pure tone is its frequency", () => {
    expect(peakDb(sine(440, 0.1, 0.5))).toBeCloseTo(-6.02, 2);
    for (const hz of [300, 1000, 2500]) {
      const s = powerSpectrum(sine(hz, 0.1), RATE);
      expect(Math.abs(centroid(s.power, s.binHz) - hz)).toBeLessThan(15);
    }
  });

  it("windows: 100 ms windows of 1 s are 10, and 400 ms every 100 ms are 7", () => {
    expect(windows(sine(100, 1), RATE, 0.1)).toHaveLength(10);
    expect(windows(sine(100, 1), RATE, 0.4, 0.1)).toHaveLength(7);
  });

  it("report: a jump from −40 dB to 0 dB rises by over 30 dB in one step; the first seconds follow a fade-in", () => {
    const quiet = sine(500, 2, 0.01);
    const loud = sine(500, 2, 1);
    const both = new Float32Array(quiet.length + loud.length);
    both.set(quiet);
    both.set(loud, quiet.length);
    const r = report(both, RATE, 0);
    // The first 400 ms window that holds the jump holds 100 ms of it: about −40 → −6 dB in one step
    expect(r.maxRiseDb).toBeGreaterThan(30);
    expect(r.maxPeakDb).toBeCloseTo(0, 1);
    const fade = Float32Array.from(sine(500, 6), (v, i) => v * Math.min(1, i / (4 * RATE)));
    const first = report(fade, RATE, 0).firstSeconds;
    for (let k = 1; k < 4; k++) expect(first[k]!).toBeGreaterThan(first[k - 1]!);
  });
});
