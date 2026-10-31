// E04 CompositionEngine: chill music, one bar at a time (docs/02-detailed-design.md H, V, RH, M, F rules, R-10).
// Pure: the state is plain data, advanced with a random source; a style is data (VOL-04). No audio here: E05 turns
// notes into patches and A02 plays them.

import { type Quality, QUALITIES, chordPitchClasses, pitchClass, scalePitchClasses } from "../util/pitch";
import type { Random } from "../util/random";

export type Mode = "major" | "minor";
export interface Key {
  /** Pitch class of the tonic, 0–11 (C = 0) */
  tonic: number;
  mode: Mode;
}

export interface Chord {
  /** Pitch class of the root */
  root: number;
  quality: Quality;
}

export type Layer = "pad" | "epiano" | "bass" | "drums" | "melody" | "chime";
export type Drum = "kick" | "snare" | "hat";

export interface Note {
  layer: Layer;
  /** MIDI number; null for drums */
  midi: number | null;
  /** Drum kind; null for pitched notes */
  drum: Drum | null;
  bar: number;
  /** 16th step in the bar, 0–15 */
  step: number;
  /** Start in seconds from the start of the music, before the RH-4 offset */
  nominal: number;
  /** Start after the RH-4 offset */
  time: number;
  /** Length in seconds */
  length: number;
  /** In [0, 1], after the RH-4 factor */
  velocity: number;
}

export interface ChordEvent {
  chord: Chord;
  startStep: number;
  steps: number;
  /** V-1–V-3: the four upper voices, low to high */
  voicing: number[];
}

export interface Bar {
  index: number;
  /** Start in seconds from the start of the music */
  start: number;
  bpm: number;
  key: Key;
  chords: ChordEvent[];
  layers: Layer[];
  notes: Note[];
}

/** One chord of a template: degree above the (major) tonic, quality, and length in 16th steps. */
export interface TemplateChord {
  degree: number;
  quality: Quality;
  steps: number;
}

export interface Template {
  name: string;
  weight: number;
  /** Four bars, each one or more chords whose steps add up to 16 */
  bars: TemplateChord[][];
}

/** A style is data (VOL-04). */
export interface Style {
  templates: Template[];
  /** F-1: layer sets per phrase; phrases before `loopFrom` play once, the rest repeat */
  form: Layer[][];
  loopFrom: number;
  /** RH-5: electric piano comping patterns, onset steps in a bar */
  comping: number[][];
  /** Base velocities per layer (and per drum) before the RH-4 factor */
  velocity: Record<Exclude<Layer, "drums">, number> & Record<Drum, number>;
}

const t = (degree: number, quality: Quality, steps = 16): TemplateChord => ({ degree, quality, steps });

/** The default chill style (docs/02 E04). */
export const CHILL: Style = {
  templates: [
    { name: "IVmaj7 III7 VIm7 Vm7 I7", weight: 3, bars: [[t(5, "maj7")], [t(4, "7")], [t(9, "m7")], [t(7, "m7", 8), t(0, "7", 8)]] },
    { name: "ii–V–I sway", weight: 3, bars: [[t(2, "m9")], [t(7, "13sus4")], [t(0, "maj9")], [t(9, "7b9")]] },
    { name: "descending", weight: 2, bars: [[t(5, "maj9")], [t(4, "m7")], [t(2, "m9")], [t(0, "maj7")]] },
    { name: "Dorian vamp", weight: 2, bars: [[t(2, "m9")], [t(7, "9")], [t(2, "m9")], [t(7, "9")]] },
  ],
  form: [
    ["pad"],
    ["pad", "epiano"],
    ["pad", "epiano", "bass"],
    ["pad", "epiano", "bass", "drums"],
    ["pad", "epiano", "bass", "drums", "melody"],
    ["pad", "epiano", "bass", "melody"],
    ["pad", "epiano", "bass", "drums", "melody"],
    ["pad", "epiano", "bass", "melody"],
    ["pad", "epiano", "melody"],
    ["pad", "epiano"],
  ],
  loopFrom: 2,
  comping: [[0], [0, 10], [0, 6, 10], [2, 8], [0, 7], [3, 10], [0, 8, 14], [0, 6]],
  velocity: { pad: 0.35, epiano: 0.5, bass: 0.6, melody: 0.5, chime: 0.45, kick: 0.7, snare: 0.45, hat: 0.25 },
};

// ---- Formulas with their own tests (u, u′ uniform in [0, 1)) ----

/** RH-1 */
export const tempo = (u: number): number => 72 + 12 * u;
/** H-5: bars from one key change to the next */
export const keyChangeGap = (u: number): number => 32 + 4 * Math.floor(9 * u);
/** RH-4: timing offset in ms and velocity factor */
export const wobble = (u: number, u2: number): { offsetMs: number; factor: number } => ({ offsetMs: -8 + 16 * u, factor: 0.85 + 0.3 * u2 });
/** RH-2 */
export const SWING = 0.58;
/** RH-3 */
export const SNARE_LATE = 0.015;
/** RH-3: a hat is kept if its draw is below this */
export const HAT_KEEP = 0.75;
export const keepsHat = (u: number): boolean => u < HAT_KEEP;
/** RH-5 */
export const STRUM = 0.012;
/** M-2 */
export const MELODY_RANGE = [65, 83] as const;
/** V-2 */
export const VOICE_RANGE = [48, 72] as const;
/** V-3: the first chord moves from this voicing */
export const REFERENCE_VOICING = [55, 59, 62, 65];
/** C-4: steps in a bar */
export const STEPS = 16;
/** F-1: bars in a phrase */
export const PHRASE = 8;

/** C-4: one 16th step lasts 60 / BPM / 4 s. */
export const stepLength = (bpm: number): number => 60 / bpm / 4;

/** RH-2: seconds from the bar's start to step s (0–16): off-beat 16ths start at SWING of their 8th. */
export function stepTime(s: number, bpm: number): number {
  const d = stepLength(bpm);
  const pair = Math.floor(s / 2);
  return pair * 2 * d + (s % 2 === 1 ? SWING * 2 * d : 0);
}

// ---- Keys and harmony ----

/** The tonic the templates are transposed to: a minor key uses its relative major's (docs/02 E04 "Data"). */
export const templateTonic = (key: Key): number => (key.mode === "minor" ? pitchClass(key.tonic + 3) : key.tonic);

/** H-5: the three targets of a key change. */
export function keyChangeTargets(key: Key): Key[] {
  const relative: Key = key.mode === "major" ? { tonic: pitchClass(key.tonic + 9), mode: "minor" } : { tonic: pitchClass(key.tonic + 3), mode: "major" };
  return [relative, { tonic: pitchClass(key.tonic + 3), mode: key.mode }, { tonic: key.tonic, mode: key.mode === "major" ? "minor" : "major" }];
}

const DOMINANT_QUALITIES: readonly Quality[] = ["7", "9", "13", "7b9"];

/** H-2: a dominant of `key` (rooted on tonic + 7, quality 7, 9, 13, or 7♭9). */
export const isDominant = (chord: Chord, key: Key): boolean => chord.root === pitchClass(key.tonic + 7) && DOMINANT_QUALITIES.includes(chord.quality);
/** H-2: a chord rooted on the tonic of `key`. */
export const isTonic = (chord: Chord, key: Key): boolean => chord.root === key.tonic;
/** H-2: the sus4 form of a dominant. */
export const susOf = (quality: Quality): Quality => (quality === "9" ? "9sus4" : quality === "13" ? "13sus4" : "7sus4");

/** M-1 */
export const scaleOf = (key: Key): number[] => scalePitchClasses(key.tonic, key.mode);

// ---- Voicing ----

/** V-1: the allowed tones of a chord: [3rd or 4th, 7th, 9th, 5th, 13th] as pitch classes. */
export function allowedTones(chord: Chord): { third: number; seventh: number; colours: number[] } {
  const iv = QUALITIES[chord.quality] as readonly number[];
  const third = iv.includes(5) && !iv.includes(4) && !iv.includes(3) ? 5 : iv.includes(3) ? 3 : 4;
  const seventh = iv.includes(11) ? 11 : 10;
  const ninth = chord.quality === "7b9" ? 13 : 14;
  return { third: pitchClass(chord.root + third), seventh: pitchClass(chord.root + seventh), colours: [ninth, 7, 21].map((i) => pitchClass(chord.root + i)) };
}

/** V-1, V-2: every voicing of four upper voices for the chord within the voice range, each sorted low to high. */
export function voicingsOf(chord: Chord): number[][] {
  const { third, seventh, colours } = allowedTones(chord);
  const placements = (pc: number): number[] => {
    const out: number[] = [];
    for (let m = VOICE_RANGE[0]; m <= VOICE_RANGE[1]; m++) if (pitchClass(m) === pc) out.push(m);
    return out;
  };
  const out: number[][] = [];
  for (let a = 0; a < colours.length; a++) {
    for (let b = a + 1; b < colours.length; b++) {
      const pcs = [third, seventh, colours[a]!, colours[b]!];
      const [p0, p1, p2, p3] = pcs.map(placements) as [number[], number[], number[], number[]];
      for (const m0 of p0) for (const m1 of p1) for (const m2 of p2) for (const m3 of p3) out.push([m0, m1, m2, m3].sort((x, y) => x - y));
    }
  }
  return out;
}

/** V-3: total movement between two voicings, both sorted low to high. */
export const movement = (a: readonly number[], b: readonly number[]): number => a.reduce((sum, m, i) => sum + Math.abs(m - b[i]!), 0);

/** V-3: the voicing of `chord` that moves least from `previous`; ties go to the lower sum, then lower pitches from the bottom up. */
export function voiceLead(chord: Chord, previous: readonly number[]): number[] {
  let best: number[] | null = null;
  let bestKey: number[] = [];
  for (const v of voicingsOf(chord)) {
    const key = [movement(v, previous), v.reduce((s, m) => s + m, 0), ...v];
    if (!best || compare(key, bestKey) < 0) [best, bestKey] = [v, key];
  }
  return best!;
}

const compare = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
};

/** V-4: the pitch class `pc` placed 12–24 semitones below `lowest` (the higher one when two fit). */
export const bassPitch = (pc: number, lowest: number): number => {
  for (let m = lowest - 12; m >= lowest - 24; m--) if (pitchClass(m) === pc) return m;
  throw new RangeError("unreachable: 13 consecutive numbers hold every pitch class");
};

// ---- State ----

interface Progression {
  startBar: number;
  key: Key;
  bpm: number;
  template: number;
  /** Chords per bar, after H-3 */
  chords: { chord: Chord; steps: number }[][];
}

export interface Motif {
  phrase: number;
  /** Onsets in the 2-bar block: step 0–31, length in steps, pitch */
  onsets: { step: number; steps: number; pitch: number }[];
}

export interface ComposerState {
  style: Style;
  /** The next bar to make */
  bar: number;
  /** Its start in seconds */
  time: number;
  /** The progression being played and the one after it (H-3 looks one chord ahead) */
  current: Progression;
  next: Progression;
  /** The bar of the next key change, and the key and tempo in force for the next progression drawn */
  nextChange: number;
  key: Key;
  bpm: number;
  voicing: number[];
  motif: Motif | null;
}

/** H-4: a template by weight, the previous one's weight halved. */
export function drawTemplate(style: Style, previous: number | null, rng: Random): number {
  const weights = style.templates.map((tpl, i) => (i === previous ? tpl.weight / 2 : tpl.weight));
  let u = rng.next() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    u -= weights[i]!;
    if (u < 0) return i;
  }
  return weights.length - 1;
}

/** H-4: a template transposed to `key`, before H-3. */
export function transpose(template: Template, key: Key): { chord: Chord; steps: number }[][] {
  const tonic = templateTonic(key);
  return template.bars.map((bar) => bar.map((c) => ({ chord: { root: pitchClass(tonic + c.degree), quality: c.quality }, steps: c.steps })));
}

/** Draws the progression starting at `startBar`, after any key change there (H-5, RH-1). */
function drawProgression(state: Pick<ComposerState, "style" | "nextChange" | "key" | "bpm">, startBar: number, previous: number | null, rng: Random) {
  let { nextChange, key, bpm } = state;
  if (startBar === nextChange) {
    key = keyChangeTargets(key)[Math.min(2, Math.floor(3 * rng.next()))]!;
    bpm = tempo(rng.next());
    nextChange = startBar + keyChangeGap(rng.next());
  }
  const template = drawTemplate(state.style, previous, rng);
  const progression: Progression = { startBar, key, bpm, template, chords: transpose(state.style.templates[template]!, key) };
  return { progression, nextChange, key, bpm };
}

/** H-3: replaces each dominant that would resolve to the tonic of the key in force at the next chord by its sus4 form. */
function resolveSoftly(current: Progression, next: Progression): Progression {
  const flat = current.chords.flatMap((bar, b) => bar.map((c, k) => ({ b, k, chord: c.chord })));
  const chords = current.chords.map((bar) => bar.map((c) => ({ ...c })));
  flat.forEach(({ b, k, chord }, i) => {
    const following = i + 1 < flat.length ? { chord: flat[i + 1]!.chord, key: current.key } : { chord: next.chords[0]![0]!.chord, key: next.key };
    if (isDominant(chord, following.key) && isTonic(following.chord, following.key)) chords[b]![k] = { ...chords[b]![k]!, chord: { ...chord, quality: susOf(chord.quality) } };
  });
  return { ...current, chords };
}

/** The music's start: a key, a tempo, and the first two progressions. */
export function createComposer(style: Style, rng: Random): ComposerState {
  const key: Key = { tonic: Math.min(11, Math.floor(12 * rng.next())), mode: rng.next() < 0.5 ? "major" : "minor" };
  const bpm = tempo(rng.next());
  const nextChange = keyChangeGap(rng.next());
  const first = drawProgression({ style, nextChange, key, bpm }, 0, null, rng);
  const second = drawProgression({ style, nextChange: first.nextChange, key: first.key, bpm: first.bpm }, 4, first.progression.template, rng);
  return {
    style,
    bar: 0,
    time: 0,
    current: resolveSoftly(first.progression, second.progression),
    next: second.progression,
    nextChange: second.nextChange,
    key: second.key,
    bpm: second.bpm,
    voicing: REFERENCE_VOICING,
    motif: null,
  };
}

/** F-1: the layers of phrase p (counting from 0). */
export function layersOf(style: Style, phrase: number): Layer[] {
  const loop = style.form.length - style.loopFrom;
  return style.form[phrase < style.loopFrom ? phrase : style.loopFrom + ((phrase - style.loopFrom) % loop)]!;
}

// ---- Melody ----

/** M-1, M-4, M-2: the pitches a melody note may take at a step under a chord in a key. */
export function melodyPitches(key: Key, chord: Chord, step: number): number[] {
  const scale = scaleOf(key);
  const strong = step % 16 === 0 || step % 16 === 8;
  const chordTones = chordPitchClasses(chord.root, chord.quality);
  const out: number[] = [];
  for (let m = MELODY_RANGE[0]; m <= MELODY_RANGE[1]; m++) {
    const pc = pitchClass(m);
    if (scale.includes(pc) && (!strong || chordTones.includes(pc))) out.push(m);
  }
  return out;
}

/** M-3: the allowed pitch nearest to `pitch`, the lower one on a tie. */
export function bend(pitch: number, allowed: readonly number[]): number {
  let best = allowed[0]!;
  for (const m of allowed) {
    const [d, bestD] = [Math.abs(m - pitch), Math.abs(best - pitch)];
    if (d < bestD || (d === bestD && m < best)) best = m;
  }
  return best;
}

/** M-3, M-4: a motif of 4–7 onsets on distinct steps of a 2-bar block, 1 or 2 steps each, walking by at most 2 scale steps. */
export function drawMotif(phrase: number, key: Key, rng: Random): Motif {
  const count = 4 + Math.min(3, Math.floor(4 * rng.next()));
  const steps = new Set<number>();
  while (steps.size < count) steps.add(Math.min(31, Math.floor(32 * rng.next())));
  const sorted = [...steps].sort((a, b) => a - b);
  const scale: number[] = [];
  for (let m = MELODY_RANGE[0]; m <= MELODY_RANGE[1]; m++) if (scaleOf(key).includes(pitchClass(m))) scale.push(m);
  let index = scale.indexOf(bend(74, scale));
  const onsets = sorted.map((step, i) => {
    const room = (i + 1 < sorted.length ? sorted[i + 1]! : 32) - step;
    const length = Math.min(room, 1 + Math.min(1, Math.floor(2 * rng.next())));
    if (i > 0) index = Math.max(0, Math.min(scale.length - 1, index + Math.min(2, Math.floor(5 * rng.next())) - 2));
    return { step, steps: length, pitch: scale[index]! };
  });
  return { phrase, onsets };
}

// ---- One bar ----

/** The chord sounding at step s of a bar's chord events. */
const chordAt = (chords: readonly ChordEvent[], s: number): ChordEvent => chords.find((c) => s >= c.startStep && s < c.startStep + c.steps) ?? chords.at(-1)!;

/** Makes the next bar and returns it with the advanced state. */
export function nextBar(state: ComposerState, rng: Random): { state: ComposerState; bar: Bar } {
  let s = state;
  const index = s.bar;
  // A new progression every 4 bars: the next one becomes current and the one after it is drawn (H-3 needs it)
  if (index > 0 && index % 4 === 0) {
    const drawn = drawProgression(s, index + 4, s.next.template, rng);
    s = { ...s, current: resolveSoftly(s.next, drawn.progression), next: drawn.progression, nextChange: drawn.nextChange, key: drawn.key, bpm: drawn.bpm };
  }
  const { current, style } = s;
  const key = current.key;
  const bpm = current.bpm;
  const start = s.time;
  const at = (step: number) => start + stepTime(step, bpm);
  const span = (from: number, steps: number) => stepTime(from + steps, bpm) - stepTime(from, bpm);

  // Chords and voicings (V-3)
  let voicing = s.voicing;
  let stepAt = 0;
  const chords: ChordEvent[] = current.chords[index % 4]!.map((c) => {
    voicing = voiceLead(c.chord, voicing);
    const event = { chord: c.chord, startStep: stepAt, steps: c.steps, voicing };
    stepAt += c.steps;
    return event;
  });

  const phrase = Math.floor(index / PHRASE);
  const layers = layersOf(style, phrase);
  const notes: Note[] = [];
  const add = (layer: Layer, midi: number | null, drum: Drum | null, step: number, nominal: number, length: number, base: number) => {
    const { offsetMs, factor } = wobble(rng.next(), rng.next());
    notes.push({ layer, midi, drum, bar: index, step, nominal, time: nominal + offsetMs / 1000, length, velocity: Math.min(1, base * factor) });
  };
  // RH-5: each voice starts k × STRUM late but all end together, at the onset's end
  const strum = (layer: Layer, event: ChordEvent, step: number, steps: number) => {
    event.voicing.forEach((m, k) => add(layer, m, null, step, at(step) + k * STRUM, span(step, steps) - k * STRUM, style.velocity[layer as "pad" | "epiano"]));
  };

  if (layers.includes("pad")) for (const c of chords) strum("pad", c, c.startStep, c.steps);
  if (layers.includes("epiano")) {
    const pattern = style.comping[Math.min(style.comping.length - 1, Math.floor(style.comping.length * rng.next()))]!;
    pattern.forEach((step, i) => {
      const c = chordAt(chords, step);
      const end = Math.min(i + 1 < pattern.length ? pattern[i + 1]! : STEPS, c.startStep + c.steps, step + 6);
      strum("epiano", c, step, end - step);
    });
  }
  if (layers.includes("bass")) {
    for (const c of chords) {
      const lowest = c.voicing[0]!;
      add("bass", bassPitch(c.chord.root, lowest), null, c.startStep, at(c.startStep), span(c.startStep, 3), style.velocity.bass);
      if (c.steps > 8) add("bass", bassPitch(pitchClass(c.chord.root + 7), lowest), null, c.startStep + 8, at(c.startStep + 8), span(c.startStep + 8, 3), style.velocity.bass);
    }
  }
  if (layers.includes("drums")) {
    add("drums", null, "kick", 0, at(0), span(0, 2), style.velocity.kick);
    add("drums", null, "snare", 8, at(8) + SNARE_LATE, span(8, 2), style.velocity.snare);
    add("drums", null, "kick", 10, at(10), span(10, 2), style.velocity.kick);
    for (let step = 0; step < STEPS; step += 2) if (keepsHat(rng.next())) add("drums", null, "hat", step, at(step), span(step, 1), style.velocity.hat);
  }
  let motif = s.motif;
  if (layers.includes("melody")) {
    if (!motif || motif.phrase !== phrase) motif = drawMotif(phrase, key, rng);
    const half = index % 2; // which bar of the 2-bar block
    for (const o of motif.onsets) {
      if (Math.floor(o.step / STEPS) !== half) continue;
      const step = o.step % STEPS;
      const pitch = bend(o.pitch, melodyPitches(key, chordAt(chords, step).chord, step));
      // A note does not run past the end of its bar (a motif note at step 15 of the first bar ends there)
      add("melody", pitch, null, step, at(step), span(step, Math.min(o.steps, STEPS - step)), style.velocity.melody);
    }
  }

  const bar: Bar = { index, start, bpm, key, chords, layers, notes };
  return { state: { ...s, bar: index + 1, time: start + STEPS * stepLength(bpm), voicing, motif }, bar };
}

/**
 * F-3: the chime for a flare: the 5th or the 9th above the key's tonic in octave 5 (MIDI 72–83), at `time` before
 * the RH-4 wobble. Draws: the choice, then the wobble's two draws (it is a note like the others).
 */
export function chimeNote(key: Key, time: number, rng: Random, velocity = CHILL.velocity.chime): Note {
  const midi = 72 + key.tonic + (rng.next() < 0.5 ? 7 : 14);
  const { offsetMs, factor } = wobble(rng.next(), rng.next());
  return { layer: "chime", midi, drum: null, bar: -1, step: 0, nominal: time, time: time + offsetMs / 1000, length: 2, velocity: Math.min(1, velocity * factor) };
}
