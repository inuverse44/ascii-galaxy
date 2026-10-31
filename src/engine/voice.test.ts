import { describe, expect, it } from "vitest";
import { midiToFrequency } from "../util/pitch";
import { createRandom } from "../util/random";
import type { Note } from "./composition";
import {
  ALL_PATCHES,
  DRUMS,
  type FmSource,
  LEVEL,
  MASTER,
  type OscSource,
  type SweepSource,
  VINYL,
  fmIndexAt,
  impulseResponse,
  patchFor,
  saturationCurve,
  sweepAt,
  wobbleDelayAmplitude,
} from "./voice";

const note = (layer: Note["layer"], midi: number | null, drum: Note["drum"] = null): Note => ({ layer, midi, drum, bar: 0, step: 0, nominal: 1, time: 1.003, length: 0.5, velocity: 0.5 });
const sources = (layer: Note["layer"], drum: Note["drum"] = null) => patchFor(note(layer, drum ? null : 60, drum)).sources;

describe("T timbres", () => {
  it("T-1: the electric piano is two FM pairs, 1:1 and 14:1, and the 14:1 modulation is at most 10% by 0.3 s", () => {
    const fm = sources("epiano") as FmSource[];
    expect(fm.map((s) => s.kind)).toEqual(["fm", "fm"]);
    expect(fm.map((s) => s.modulatorRatio / s.carrierRatio)).toEqual([1, 14]);
    const tine = fm[1]!;
    expect(fmIndexAt(tine, 0)).toBe(tine.index);
    expect(fmIndexAt(tine, 0.3)).toBeLessThanOrEqual(0.1 * tine.index);
    // The index falls exponentially from the start to its end value, and is held after
    expect(fmIndexAt(tine, tine.indexTime / 2)).toBeCloseTo(Math.sqrt(tine.index * tine.indexEnd), 12);
    expect(fmIndexAt(tine, 10)).toBe(tine.indexEnd);
  });

  it("T-2: the bass is a sine plus its second harmonic at 0.1–0.3 of its gain", () => {
    const osc = sources("bass") as OscSource[];
    expect(osc.map((s) => [s.kind, s.wave, s.ratio])).toEqual([["osc", "sine", 1], ["osc", "sine", 2]]);
    const ratio = osc[1]!.gain / osc[0]!.gain;
    expect(ratio).toBeGreaterThanOrEqual(0.1);
    expect(ratio).toBeLessThanOrEqual(0.3);
  });

  it("T-3: the pad is two sawtooths detuned by ±3 to ±10 cents, through a low-pass at most 2 kHz, with an attack of at least 0.5 s", () => {
    const p = patchFor(note("pad", 60));
    const osc = p.sources as OscSource[];
    expect(osc.map((s) => s.wave)).toEqual(["sawtooth", "sawtooth"]);
    const [a, b] = osc.map((s) => s.detuneCents) as [number, number];
    expect(Math.sign(a)).toBe(-Math.sign(b));
    for (const d of [a, b]) {
      expect(Math.abs(d)).toBeGreaterThanOrEqual(3);
      expect(Math.abs(d)).toBeLessThanOrEqual(10);
    }
    expect(p.filter?.type).toBe("lowpass");
    expect(p.filter!.frequency).toBeLessThanOrEqual(2000);
    expect(p.envelope.attack).toBeGreaterThanOrEqual(0.5);
  });

  it("T-4: kick is a sine sweep from ≥ 100 Hz to ≤ 60 Hz within 100 ms; snare and hat are noise, band-passed 1–3 kHz and high-passed ≥ 5 kHz, the hat ≥ 12 dB below", () => {
    // #8: the source types, not only the numbers
    const [kick] = sources("drums", "kick") as SweepSource[];
    expect(sources("drums", "kick")).toHaveLength(1);
    expect(kick!.kind).toBe("sweep"); // A02 plays a sweep with a sine oscillator only
    expect(sweepAt(kick!, 0)).toBeGreaterThanOrEqual(100);
    expect(sweepAt(kick!, 0.1)).toBeLessThanOrEqual(60);
    for (const drum of ["snare", "hat"] as const) {
      expect(sources("drums", drum).map((s) => s.kind)).toEqual(["noise"]);
    }
    expect(DRUMS.snare.filter.type).toBe("bandpass");
    expect(DRUMS.snare.filter.frequency).toBeGreaterThanOrEqual(1000);
    expect(DRUMS.snare.filter.frequency).toBeLessThanOrEqual(3000);
    expect(DRUMS.hat.filter.type).toBe("highpass");
    expect(DRUMS.hat.filter.frequency).toBeGreaterThanOrEqual(5000);
    expect(20 * Math.log10(DRUMS.hat.sources[0].gain / DRUMS.snare.sources[0].gain)).toBeLessThanOrEqual(-12);
  });

  it("T-5: the chime is FM with a carrier/modulator ratio at least 0.05 from every integer", () => {
    const [fm] = sources("chime") as FmSource[];
    expect(fm!.kind).toBe("fm");
    for (const r of [fm!.carrierRatio / fm!.modulatorRatio, fm!.modulatorRatio / fm!.carrierRatio]) expect(Math.abs(r - Math.round(r))).toBeGreaterThanOrEqual(0.05);
  });

  it("L-1: every patch (all instruments, the drums, the chime) has an attack of at least 5 ms and a release of at least 30 ms", () => {
    expect(ALL_PATCHES.map((p) => p.name).sort()).toEqual(["bass", "chime", "epiano", "hat", "kick", "melody", "pad", "snare"]);
    for (const p of ALL_PATCHES) {
      expect(p.envelope.attack, p.name).toBeGreaterThanOrEqual(0.005);
      expect(p.envelope.release, p.name).toBeGreaterThanOrEqual(0.03);
    }
  });

  it("a note's patch: its time, frequency from its MIDI number, length, and velocity × the instrument's level", () => {
    for (const layer of ["pad", "epiano", "bass", "melody", "chime"] as const) {
      const p = patchFor(note(layer, 64));
      expect([p.layer, p.time, p.length]).toEqual([layer, 1.003, 0.5]);
      expect(p.frequency).toBe(midiToFrequency(64));
      expect(p.gain).toBeCloseTo(0.5 * LEVEL[layer], 12);
    }
    const kick = patchFor(note("drums", null, "kick"));
    expect(kick.frequency).toBe(0);
    expect(kick.sources).toEqual(DRUMS.kick.sources);
  });
});

describe("MC master chain (data)", () => {
  it("MC-1: low-pass → saturation → tape wobble → reverb → output; vinyl noise joins after the reverb", () => {
    expect(MASTER.map((s) => s.kind)).toEqual(["lowpass", "saturation", "wobble", "reverb", "output"]);
  });

  it("MC-2–MC-5: cutoff 2.5 kHz ± 10%; drive ≤ 2 with a tanh curve; wobble 0.3 Hz ± 0.05 at 6 ± 1 cents; vinyl band 200 Hz–4 kHz at ≤ −45 dBFS with 0.1–0.5 clicks a second", () => {
    const stage = <K extends (typeof MASTER)[number]["kind"]>(kind: K) => MASTER.find((s) => s.kind === kind) as Extract<(typeof MASTER)[number], { kind: K }>;
    expect(stage("lowpass").frequency).toBeGreaterThanOrEqual(2250);
    expect(stage("lowpass").frequency).toBeLessThanOrEqual(2750);
    const { drive } = stage("saturation");
    expect(drive).toBeLessThanOrEqual(2);
    const curve = saturationCurve(drive);
    expect(curve[0]).toBeCloseTo(-1, 6);
    expect(curve.at(-1)).toBeCloseTo(1, 6);
    for (let i = 0; i < curve.length; i++) {
      const x = (2 * i) / (curve.length - 1) - 1;
      expect(curve[i]).toBeCloseTo(Math.tanh(drive * x) / Math.tanh(drive), 6);
    }
    const { rate, depthCents } = stage("wobble");
    expect(Math.abs(rate - 0.3)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(depthCents - 6)).toBeLessThanOrEqual(1);
    // The delay's peak rate of change 2πfA is the pitch ratio's deviation: 6 cents
    expect(1 + 2 * Math.PI * rate * wobbleDelayAmplitude(rate, depthCents)).toBeCloseTo(2 ** (depthCents / 1200), 12);
    expect([VINYL.low, VINYL.high]).toEqual([200, 4000]);
    expect(VINYL.levelDb).toBeLessThanOrEqual(-45);
    expect(VINYL.clicksPerSecond).toBeGreaterThanOrEqual(0.1);
    expect(VINYL.clicksPerSecond).toBeLessThanOrEqual(0.5);
  });

  it("MC-6: the impulse response, measured, falls by 60 dB in 2.5 s ± 0.2", () => {
    const reverb = MASTER.find((s) => s.kind === "reverb") as { decay: number };
    const sampleRate = 44100;
    const ir = impulseResponse(reverb.decay, sampleRate, createRandom(4).next);
    // Schroeder's backward integration, then the slope of the decay curve between −5 and −25 dB, extended to 60 dB
    const energy = new Float64Array(ir.length);
    let sum = 0;
    for (let i = ir.length - 1; i >= 0; i--) energy[i] = sum += ir[i]! ** 2;
    const db = (i: number) => 10 * Math.log10(energy[i]! / energy[0]!);
    const at = (level: number) => {
      let i = 0;
      while (db(i) > level) i++;
      return i / sampleRate;
    };
    const t60 = ((at(-25) - at(-5)) / 20) * 60;
    expect(Math.abs(t60 - 2.5)).toBeLessThanOrEqual(0.2);
  });
});
