// A02 AudioAccess: builds the Web Audio graph from E05's data and plays patches (R02). It works on an AudioContext
// (the page) or an OfflineAudioContext (the sound renders, UC-05). Only C01 creates the context, after "♪" (R-11).

import { MASTER, type Patch, type Stage, VINYL, impulseResponse, saturationCurve, wobbleDelayAmplitude } from "../engine/voice";

/** What M01 needs from A02. */
export interface AudioOut {
  /** The audio clock in seconds */
  readonly now: number;
  /** L-2: starts the master output, fading in from `at` */
  start(at: number): void;
  play(patch: Patch): void;
  /** MC-5: a vinyl click at `time` */
  click(time: number): void;
}

const stage = <K extends Stage["kind"]>(kind: K) => MASTER.find((s) => s.kind === kind) as Extract<Stage, { kind: K }>;

/** The master chain's nodes, kept so that a browser test can read the parameters A02 applied (#8 MC). */
export interface Chain {
  input: GainNode;
  lowpass: BiquadFilterNode;
  saturation: WaveShaperNode;
  wobble: { delay: DelayNode; lfo: OscillatorNode; depth: GainNode };
  reverb: { convolver: ConvolverNode; dry: GainNode; wet: GainNode; sum: GainNode };
  vinyl: { source: AudioBufferSourceNode; highpass: BiquadFilterNode; lowpass: BiquadFilterNode; level: GainNode };
  output: GainNode;
}

export class AudioAccess implements AudioOut {
  readonly chain: Chain;
  private readonly noise: AudioBuffer;
  private readonly clickBuffer: AudioBuffer;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly random: () => number = Math.random,
  ) {
    const rate = ctx.sampleRate;
    // Two seconds of white noise, shared by the drums and the vinyl (each plays it from its own offset)
    this.noise = ctx.createBuffer(1, 2 * rate, rate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = 2 * random() - 1;
    // A click: a few milliseconds of decaying noise
    this.clickBuffer = ctx.createBuffer(1, Math.round(0.004 * rate), rate);
    const click = this.clickBuffer.getChannelData(0);
    for (let i = 0; i < click.length; i++) click[i] = (2 * random() - 1) * Math.exp(-i / (0.0008 * rate));
    this.chain = this.buildChain();
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** MC-1–MC-6: input → low-pass → saturation → wobble → reverb (dry + wet) → sum (+ vinyl) → output. */
  private buildChain(): Chain {
    const { ctx } = this;
    const input = ctx.createGain();

    const lp = stage("lowpass");
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = lp.frequency;
    lowpass.Q.value = lp.q;

    const saturation = ctx.createWaveShaper();
    saturation.curve = saturationCurve(stage("saturation").drive) as Float32Array<ArrayBuffer>;
    saturation.oversample = "2x";

    const wb = stage("wobble");
    const amplitude = wobbleDelayAmplitude(wb.rate, wb.depthCents);
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = 0.01;
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = wb.rate;
    const depth = ctx.createGain();
    depth.gain.value = amplitude;
    lfo.connect(depth).connect(delay.delayTime);

    const rv = stage("reverb");
    const convolver = ctx.createConvolver();
    convolver.normalize = false;
    const irData = impulseResponse(rv.decay, ctx.sampleRate, this.random);
    const ir = ctx.createBuffer(1, irData.length, ctx.sampleRate);
    ir.copyToChannel(irData as Float32Array<ArrayBuffer>, 0);
    // Scaled so the wet signal's energy matches the dry's: the IR's energy is about Σ e^(−2kt) ≈ rate / (2k)
    const k = Math.log(1000) / rv.decay;
    const irScale = Math.sqrt((2 * k) / ctx.sampleRate);
    convolver.buffer = ir;
    const dry = ctx.createGain();
    dry.gain.value = 1 - rv.mix;
    const wet = ctx.createGain();
    wet.gain.value = rv.mix * irScale;
    const sum = ctx.createGain();

    const vinylSource = ctx.createBufferSource();
    vinylSource.buffer = this.noise;
    vinylSource.loop = true;
    const vhp = ctx.createBiquadFilter();
    vhp.type = "highpass";
    vhp.frequency.value = VINYL.low;
    const vlp = ctx.createBiquadFilter();
    vlp.type = "lowpass";
    vlp.frequency.value = VINYL.high;
    const level = ctx.createGain();
    // White noise of uniform amplitude has an RMS of 1/√3; the band keeps about (high − low) / (rate / 2) of its power
    const bandPower = (VINYL.high - VINYL.low) / (ctx.sampleRate / 2);
    level.gain.value = 10 ** (VINYL.levelDb / 20) / Math.sqrt(bandPower / 3);

    // Silent until start() fades it in (L-2)
    const output = ctx.createGain();
    output.gain.value = 0;

    input.connect(lowpass).connect(saturation).connect(delay);
    delay.connect(dry).connect(sum);
    delay.connect(convolver).connect(wet).connect(sum);
    vinylSource.connect(vhp).connect(vlp).connect(level).connect(sum);
    sum.connect(output).connect(ctx.destination);
    return {
      input,
      lowpass,
      saturation,
      wobble: { delay, lfo, depth },
      reverb: { convolver, dry, wet, sum },
      vinyl: { source: vinylSource, highpass: vhp, lowpass: vlp, level },
      output,
    };
  }

  /** L-2: the output fades in over the stage's fadeIn seconds from `at`; the LFO and the vinyl start then. */
  start(at: number): void {
    const out = stage("output");
    const gain = this.chain.output.gain;
    gain.setValueAtTime(0, at);
    gain.linearRampToValueAtTime(out.gain, at + out.fadeIn);
    this.chain.wobble.lfo.start(at);
    this.chain.vinyl.source.start(at, this.random() * this.noise.duration);
  }

  click(time: number): void {
    const source = this.ctx.createBufferSource();
    source.buffer = this.clickBuffer;
    const gain = this.ctx.createGain();
    gain.gain.value = VINYL.clickLevel;
    source.connect(gain).connect(this.chain.reverb.sum);
    source.start(time);
  }

  /** Builds and schedules one patch: its sources, its filter, its envelope, into the chain's input. */
  play(p: Patch): void {
    const { ctx } = this;
    const t = Math.max(p.time, ctx.currentTime);
    const { attack, decay, sustain, release } = p.envelope;
    const end = t + p.length + release;

    const env = ctx.createGain();
    // Linear segments, so the level where the release starts is known without reading the param back
    const peak = p.gain;
    const level = (dt: number) =>
      dt < attack ? peak * (dt / attack) : dt < attack + decay ? peak * (1 - ((1 - sustain) * (dt - attack)) / decay) : peak * sustain;
    env.gain.setValueAtTime(0, t);
    if (p.length > attack) {
      env.gain.linearRampToValueAtTime(peak, t + attack);
      if (p.length > attack + decay) env.gain.linearRampToValueAtTime(peak * sustain, t + attack + decay);
    }
    env.gain.linearRampToValueAtTime(level(p.length), t + p.length);
    env.gain.linearRampToValueAtTime(0, end);

    let into: AudioNode = env;
    if (p.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = p.filter.type;
      filter.frequency.value = p.filter.frequency;
      filter.Q.value = p.filter.q;
      filter.connect(env);
      into = filter;
    }
    env.connect(this.chain.input);

    for (const s of p.sources) {
      const gain = ctx.createGain();
      gain.gain.value = s.gain;
      gain.connect(into);
      if (s.kind === "osc") {
        const osc = ctx.createOscillator();
        osc.type = s.wave;
        osc.frequency.value = p.frequency * s.ratio;
        osc.detune.value = s.detuneCents;
        osc.connect(gain);
        osc.start(t);
        osc.stop(end);
      } else if (s.kind === "fm") {
        const carrier = ctx.createOscillator();
        carrier.frequency.value = p.frequency * s.carrierRatio;
        const modulator = ctx.createOscillator();
        const modFrequency = p.frequency * s.modulatorRatio;
        modulator.frequency.value = modFrequency;
        const depth = ctx.createGain();
        // Peak deviation = index × modulator frequency
        depth.gain.setValueAtTime(s.index * modFrequency, t);
        depth.gain.exponentialRampToValueAtTime(s.indexEnd * modFrequency, t + s.indexTime);
        modulator.connect(depth).connect(carrier.frequency);
        carrier.connect(gain);
        for (const o of [carrier, modulator]) {
          o.start(t);
          o.stop(end);
        }
      } else if (s.kind === "sweep") {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(s.from, t);
        osc.frequency.exponentialRampToValueAtTime(s.to, t + s.time);
        osc.connect(gain);
        osc.start(t);
        osc.stop(end);
      } else {
        const noise = ctx.createBufferSource();
        noise.buffer = this.noise;
        noise.loop = true;
        noise.connect(gain);
        noise.start(t, this.random() * this.noise.duration);
        noise.stop(end);
      }
    }
  }
}
