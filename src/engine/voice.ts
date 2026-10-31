// E05 VoiceEngine: what each note sounds like, and the master chain, as data (docs/02-detailed-design.md T, MC, L-1).
// Pure: no Web Audio here. A02 builds the nodes from these descriptions.

import { midiToFrequency } from "../util/pitch";
import type { Layer, Note } from "./composition";

/** Gain over time: rise for `attack` s, fall to `sustain` (0–1) over `decay` s, hold, then fall for `release` s. */
export interface Envelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

/** FM: a carrier at carrierRatio × the note, modulated by a sine at modulatorRatio × the note. */
export interface FmSource {
  kind: "fm";
  carrierRatio: number;
  modulatorRatio: number;
  /** Modulation index (peak deviation ÷ modulator frequency) at the start, falling exponentially to indexEnd at indexTime s */
  index: number;
  indexEnd: number;
  indexTime: number;
  gain: number;
}

export interface OscSource {
  kind: "osc";
  wave: "sine" | "sawtooth" | "triangle";
  ratio: number;
  detuneCents: number;
  gain: number;
}

/** A sine whose frequency falls from `from` to `to` Hz (exponentially) within `time` s: the kick. */
export interface SweepSource {
  kind: "sweep";
  from: number;
  to: number;
  time: number;
  gain: number;
}

/** White noise. */
export interface NoiseSource {
  kind: "noise";
  gain: number;
}

export type Source = FmSource | OscSource | SweepSource | NoiseSource;

export interface Filter {
  type: "lowpass" | "highpass" | "bandpass";
  frequency: number;
  q: number;
}

export interface Patch {
  layer: Layer;
  /** Start in seconds on the music's clock */
  time: number;
  /** Hz; 0 for unpitched sounds (noise, the kick's sweep has its own) */
  frequency: number;
  /** Seconds from the start to the start of the release */
  length: number;
  /** Peak gain: velocity × the instrument's level */
  gain: number;
  envelope: Envelope;
  sources: Source[];
  filter: Filter | null;
}

/** Instrument levels before velocity; the loudness limits (L-3, L-4) are met by these and the master chain. */
export const LEVEL: Record<Layer, number> = { pad: 0.08, epiano: 0.1, bass: 0.16, drums: 0.12, melody: 0.08, chime: 0.07 };

/** T-1 */
const EPIANO: Pick<Patch, "envelope" | "sources" | "filter"> = {
  envelope: { attack: 0.005, decay: 1.2, sustain: 0.25, release: 0.4 },
  sources: [
    { kind: "fm", carrierRatio: 1, modulatorRatio: 1, index: 1.2, indexEnd: 0.5, indexTime: 1.5, gain: 1 },
    { kind: "fm", carrierRatio: 1, modulatorRatio: 14, index: 0.6, indexEnd: 0.06, indexTime: 0.25, gain: 0.25 },
  ],
  filter: null,
};

/** T-2 */
const BASS: Pick<Patch, "envelope" | "sources" | "filter"> = {
  envelope: { attack: 0.008, decay: 0.3, sustain: 0.6, release: 0.08 },
  sources: [
    { kind: "osc", wave: "sine", ratio: 1, detuneCents: 0, gain: 1 },
    { kind: "osc", wave: "sine", ratio: 2, detuneCents: 0, gain: 0.2 },
  ],
  filter: null,
};

/** T-3 */
const PAD: Pick<Patch, "envelope" | "sources" | "filter"> = {
  envelope: { attack: 0.8, decay: 1, sustain: 0.8, release: 1.2 },
  sources: [
    { kind: "osc", wave: "sawtooth", ratio: 1, detuneCents: -6, gain: 0.5 },
    { kind: "osc", wave: "sawtooth", ratio: 1, detuneCents: 6, gain: 0.5 },
  ],
  filter: { type: "lowpass", frequency: 1400, q: 0.5 },
};

/** The melody: a softer, rounder FM voice than the electric piano. */
const MELODY: Pick<Patch, "envelope" | "sources" | "filter"> = {
  envelope: { attack: 0.01, decay: 0.6, sustain: 0.4, release: 0.3 },
  sources: [{ kind: "fm", carrierRatio: 1, modulatorRatio: 2, index: 0.8, indexEnd: 0.3, indexTime: 0.8, gain: 1 }],
  filter: null,
};

/** T-5: carrier 1, modulator 3.5 (ratio 1 : 3.5, 0.29, far from any integer). */
const CHIME: Pick<Patch, "envelope" | "sources" | "filter"> = {
  envelope: { attack: 0.005, decay: 2.5, sustain: 0, release: 0.5 },
  sources: [{ kind: "fm", carrierRatio: 1, modulatorRatio: 3.5, index: 1.5, indexEnd: 0.2, indexTime: 1.5, gain: 1 }],
  filter: null,
};

/** T-4 */
export const DRUMS = {
  kick: { envelope: { attack: 0.005, decay: 0.25, sustain: 0, release: 0.05 }, sources: [{ kind: "sweep", from: 120, to: 50, time: 0.08, gain: 1 }], filter: null },
  snare: { envelope: { attack: 0.005, decay: 0.15, sustain: 0, release: 0.05 }, sources: [{ kind: "noise", gain: 0.5 }], filter: { type: "bandpass", frequency: 1800, q: 0.8 } },
  hat: { envelope: { attack: 0.005, decay: 0.05, sustain: 0, release: 0.03 }, sources: [{ kind: "noise", gain: 0.1 }], filter: { type: "highpass", frequency: 7000, q: 0.7 } },
} as const satisfies Record<"kick" | "snare" | "hat", Pick<Patch, "envelope" | "sources" | "filter">>;

const INSTRUMENTS: Record<Exclude<Layer, "drums">, Pick<Patch, "envelope" | "sources" | "filter">> = { pad: PAD, epiano: EPIANO, bass: BASS, melody: MELODY, chime: CHIME };

/** The patch for one note from E04. */
export function patchFor(note: Note): Patch {
  const base = note.layer === "drums" ? DRUMS[note.drum!] : INSTRUMENTS[note.layer];
  return {
    layer: note.layer,
    time: note.time,
    frequency: note.midi === null ? 0 : midiToFrequency(note.midi),
    length: note.length,
    gain: note.velocity * LEVEL[note.layer],
    envelope: base.envelope,
    sources: base.sources as Source[],
    filter: base.filter,
  };
}

/** Every instrument's patch template, for checks over all of them (L-1). */
export const ALL_PATCHES: { name: string; envelope: Envelope; sources: readonly Source[]; filter: Filter | null }[] = [
  ...Object.entries(INSTRUMENTS).map(([name, p]) => ({ name, ...p })),
  ...Object.entries(DRUMS).map(([name, p]) => ({ name, envelope: p.envelope, sources: p.sources as readonly Source[], filter: p.filter as Filter | null })),
];

/** T-1: the FM index of a source at `t` s after the note starts (exponential fall to indexEnd at indexTime, then held). */
export function fmIndexAt(source: FmSource, t: number): number {
  if (t >= source.indexTime) return source.indexEnd;
  return source.index * (source.indexEnd / source.index) ** (Math.max(0, t) / source.indexTime);
}

/** T-4: the kick's frequency at `t` s (exponential fall to `to` at `time`, then held). */
export function sweepAt(source: SweepSource, t: number): number {
  if (t >= source.time) return source.to;
  return source.from * (source.to / source.from) ** (Math.max(0, t) / source.time);
}

// ---- The master chain (MC-1–MC-6) ----

export type Stage =
  | { kind: "lowpass"; frequency: number; q: number }
  | { kind: "saturation"; drive: number }
  | { kind: "wobble"; rate: number; depthCents: number }
  | { kind: "reverb"; decay: number; mix: number }
  | { kind: "output"; gain: number; fadeIn: number };

/** MC-1: the stages in order; vinyl noise (VINYL) is mixed in after the reverb, before the output. */
export const MASTER: Stage[] = [
  { kind: "lowpass", frequency: 2500, q: 0.6 },
  { kind: "saturation", drive: 1.5 },
  { kind: "wobble", rate: 0.3, depthCents: 6 },
  { kind: "reverb", decay: 2.5, mix: 0.3 },
  { kind: "output", gain: 0.8, fadeIn: 4 },
];

/** MC-5 */
export const VINYL = { low: 200, high: 4000, levelDb: -50, clicksPerSecond: 0.25, clickLevel: 0.05 };

/** MC-5: the next vinyl click after `after` s: clicks come at random, `clicksPerSecond` on average (exponential gaps). */
export const nextClick = (after: number, u: number, clicksPerSecond = VINYL.clicksPerSecond): number => after - Math.log(1 - u) / clicksPerSecond;

/** MC-3: the saturation curve, tanh(drive × x) / tanh(drive), at n points over [−1, 1]. */
export function saturationCurve(drive: number, n = 1025): Float32Array {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * i) / (n - 1) - 1;
    curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  return curve;
}

/**
 * MC-4: a pitch LFO made by modulating a short delay. A delay that changes at rate dD/dt shifts pitch by the ratio
 * 1 − dD/dt; a sine of amplitude A at f Hz peaks at 2πfA, so A = (2^(cents/1200) − 1) / (2πf).
 */
export const wobbleDelayAmplitude = (rate: number, depthCents: number): number => (2 ** (depthCents / 1200) - 1) / (2 * Math.PI * rate);

/** MC-6: a stereo-free impulse response of decaying noise that falls by 60 dB in `decay` s. */
export function impulseResponse(decay: number, sampleRate: number, random: () => number): Float32Array {
  const n = Math.ceil(decay * sampleRate);
  const ir = new Float32Array(n);
  // 60 dB is a factor of 1000 in amplitude: exp(−k decay) = 1/1000
  const k = Math.log(1000) / decay;
  for (let i = 0; i < n; i++) ir[i] = (2 * random() - 1) * Math.exp((-k * i) / sampleRate);
  return ir;
}
