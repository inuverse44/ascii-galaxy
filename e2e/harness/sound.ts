// C02 for the sound renders (docs/02 L-2–L-4, MC-1–MC-6, UC-05): drives M01 with A02 on an OfflineAudioContext and
// measures the result in the page, so only small reports cross to the test runner.
import { type AudioOut, AudioAccess } from "../../src/access/audio";
import { DisplayAccess } from "../../src/access/display";
import { type Layer, CHILL, type Style, chimeNote } from "../../src/engine/composition";
import { MASTER, VINYL, patchFor, saturationCurve } from "../../src/engine/voice";
import { AmbienceManager } from "../../src/manager/ambience";
import { createRandom } from "../../src/util/random";
import { report } from "./measure";

const RATE = 44100;
const ALL_LAYERS: Layer[] = ["pad", "epiano", "bass", "drums", "melody"];

/** The forced style: every layer from bar 1 (docs/02 L-2–L-4, forced render). */
const FORCED: Style = { ...CHILL, form: [ALL_LAYERS], loopFrom: 0 };

/** Records every connect() so the chain's wiring can be read back (MC-1); installed before A02 builds its nodes. */
const edges: [AudioNode, AudioNode | AudioParam][] = [];
const connect = AudioNode.prototype.connect;
AudioNode.prototype.connect = function (this: AudioNode, destination: AudioNode | AudioParam, ...rest: number[]) {
  edges.push([this, destination]);
  return (connect as (...a: unknown[]) => AudioNode).call(this, destination, ...rest);
} as typeof AudioNode.prototype.connect;

/** Counts what was played, by layer, so a render can show every source sounded. */
function counting(audio: AudioAccess, setNow: () => number) {
  const played: Record<string, number> = {};
  const out: AudioOut = {
    get now() {
      return setNow();
    },
    start: (at) => audio.start(at),
    play: (p) => {
      played[p.layer] = (played[p.layer] ?? 0) + 1;
      audio.play(p);
    },
    click: (t) => {
      played.click = (played.click ?? 0) + 1;
      audio.click(t);
    },
  };
  return { out, played };
}

declare global {
  interface Window {
    render: (options: { seed: number; seconds: number; forced: boolean }) => Promise<unknown>;
    probeFadeIn: () => Promise<number[]>;
    probeVinyl: () => Promise<number>;
    inspectChain: () => unknown;
  }
}

/**
 * Renders `seconds` of music through M01 and A02, mono at 44.1 kHz. All bars are made before rendering: the
 * offline clock does not advance while scheduling, so M01's audio clock is moved to the end and pumped once.
 * The forced render adds a chime at 10 s and 40 s and a vinyl click every 5 s.
 */
window.render = async ({ seed, seconds, forced }) => {
  const ctx = new OfflineAudioContext(1, Math.round(seconds * RATE), RATE);
  const audio = new AudioAccess(ctx, createRandom(seed + 1000).next);
  let now = 0;
  const { out, played } = counting(audio, () => now);
  const manager = new AmbienceManager(new DisplayAccess(document.querySelector("canvas")!), seed, 200, 200, 1, "paused");
  manager.startMusic(out, forced ? FORCED : CHILL);
  now = seconds;
  manager.pumpMusic();
  if (forced) {
    const rng = createRandom(seed + 2000);
    for (const t of [10, 40]) out.play(patchFor(chimeNote({ tonic: 0, mode: "major" }, t, rng)));
    for (let t = 5; t < seconds; t += 5) out.click(t);
  }
  const buffer = await ctx.startRendering();
  const samples = buffer.getChannelData(0);
  const fadeEnd = 0.1 + (MASTER.find((s) => s.kind === "output") as { fadeIn: number }).fadeIn;
  return { played, ...report(samples, RATE, fadeEnd) };
};

/** L-2: a steady tone through the chain from "♪": its level at each second, as a share of the level after the fade. */
window.probeFadeIn = async () => {
  const ctx = new OfflineAudioContext(1, 6 * RATE, RATE);
  const audio = new AudioAccess(ctx, () => 0.5);
  // Silence the vinyl and the reverb's tail so only the tone is measured
  audio.chain.vinyl.level.gain.value = 0;
  const tone = ctx.createOscillator();
  tone.frequency.value = 220;
  const gain = ctx.createGain();
  gain.gain.value = 0.1;
  tone.connect(gain).connect(audio.chain.input);
  tone.start(0);
  audio.start(0);
  const data = (await ctx.startRendering()).getChannelData(0);
  const level = (from: number) => {
    let peak = 0;
    for (let i = Math.round((from - 0.05) * RATE); i < Math.round((from + 0.05) * RATE); i++) peak = Math.max(peak, Math.abs(data[i]!));
    return peak;
  };
  const full = level(5.5);
  return [0.5, 1, 2, 3, 3.9, 4.5, 5.5].map((t) => level(t) / full);
};

/** MC-5: the vinyl noise alone through the chain, after the fade: its RMS level in dBFS. */
window.probeVinyl = async () => {
  const ctx = new OfflineAudioContext(1, 8 * RATE, RATE);
  const audio = new AudioAccess(ctx, createRandom(5).next);
  audio.start(0);
  const data = (await ctx.startRendering()).getChannelData(0);
  let sum = 0;
  const [from, to] = [5 * RATE, 8 * RATE];
  for (let i = from; i < to; i++) sum += data[i]! ** 2;
  return 10 * Math.log10(sum / (to - from));
};

/** MC-1–MC-6 as A02 built them: node types, parameter values, the curve, and the wiring. */
window.inspectChain = () => {
  edges.length = 0;
  const ctx = new OfflineAudioContext(1, RATE, RATE);
  const audio = new AudioAccess(ctx, createRandom(1).next);
  const c = audio.chain;
  const names = new Map<unknown, string>([
    [c.input, "input"],
    [c.lowpass, "lowpass"],
    [c.saturation, "saturation"],
    [c.wobble.delay, "delay"],
    [c.wobble.lfo, "lfo"],
    [c.wobble.depth, "depth"],
    [c.wobble.delay.delayTime, "delay.delayTime"],
    [c.reverb.convolver, "convolver"],
    [c.reverb.dry, "dry"],
    [c.reverb.wet, "wet"],
    [c.reverb.sum, "sum"],
    [c.vinyl.source, "vinyl"],
    [c.vinyl.highpass, "vinyl.highpass"],
    [c.vinyl.lowpass, "vinyl.lowpass"],
    [c.vinyl.level, "vinyl.level"],
    [c.output, "output"],
    [ctx.destination, "destination"],
  ]);
  const expectedCurve = saturationCurve((MASTER.find((s) => s.kind === "saturation") as { drive: number }).drive);
  const curve = c.saturation.curve!;
  let curveError = curve.length === expectedCurve.length ? 0 : Number.POSITIVE_INFINITY;
  for (let i = 0; i < Math.min(curve.length, expectedCurve.length); i++) curveError = Math.max(curveError, Math.abs(curve[i]! - expectedCurve[i]!));
  return {
    edges: edges.map(([a, b]) => [names.get(a) ?? "?", names.get(b) ?? "?"]),
    lowpass: { type: c.lowpass.type, frequency: c.lowpass.frequency.value, q: c.lowpass.Q.value },
    saturation: { curveLength: curve.length, curveError, oversample: c.saturation.oversample },
    wobble: { lfoType: c.wobble.lfo.type, rate: c.wobble.lfo.frequency.value, depth: c.wobble.depth.gain.value, delay: c.wobble.delay.delayTime.value },
    reverb: { seconds: c.reverb.convolver.buffer!.duration, dry: c.reverb.dry.gain.value, wet: c.reverb.wet.gain.value, normalize: c.reverb.convolver.normalize },
    vinyl: {
      loop: c.vinyl.source.loop,
      highpass: [c.vinyl.highpass.type, c.vinyl.highpass.frequency.value],
      lowpass: [c.vinyl.lowpass.type, c.vinyl.lowpass.frequency.value],
      level: c.vinyl.level.gain.value,
      expectedBand: [VINYL.low, VINYL.high],
    },
  };
};

document.title = "ready";
