// U03 Pitch: 12-tone equal temperament, A4 = MIDI 69 = 440 Hz (C-3), and the pitch classes of chords and scales.

export function midiToFrequency(midi: number): number {
  if (!Number.isFinite(midi)) throw new RangeError(`MIDI number must be finite: ${midi}`);
  return 440 * 2 ** ((midi - 69) / 12);
}

export function frequencyToMidi(frequency: number): number {
  if (!(Number.isFinite(frequency) && frequency > 0)) throw new RangeError(`frequency must be finite and positive: ${frequency}`);
  return 69 + 12 * Math.log2(frequency / 440);
}

/** A pitch class in 0–11 (C = 0), for any integer. */
export const pitchClass = (n: number): number => ((n % 12) + 12) % 12;

/** Chord qualities: intervals in semitones above the root (docs/02 E04 "Data"). */
export const QUALITIES = {
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
} as const satisfies Record<string, readonly number[]>;
export type Quality = keyof typeof QUALITIES;

/** The pitch classes of a chord with root pitch class `root`. */
export const chordPitchClasses = (root: number, quality: Quality): number[] => QUALITIES[quality].map((i) => pitchClass(root + i));

/** M-1: the major pentatonic, and the minor pentatonic plus the 9th and 13th, above the tonic. */
export const SCALES = { major: [0, 2, 4, 7, 9], minor: [0, 2, 3, 5, 7, 9, 10] } as const;

/** The pitch classes of the scale of a key. */
export const scalePitchClasses = (tonic: number, mode: keyof typeof SCALES): number[] => SCALES[mode].map((i) => pitchClass(tonic + i));
