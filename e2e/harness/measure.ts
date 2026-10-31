// Measurements on a rendered buffer for the loudness limits (docs/02 L-2–L-4). Pure, so they run in the browser on
// the render (e2e) and in Node on known signals (their own unit tests).

/** The samples of [start, start + length) for consecutive windows of `windowS` s every `hopS` s. */
export function windows(samples: Float32Array, sampleRate: number, windowS: number, hopS = windowS): { start: number; data: Float32Array }[] {
  const size = Math.round(windowS * sampleRate);
  const hop = Math.round(hopS * sampleRate);
  const out: { start: number; data: Float32Array }[] = [];
  for (let i = 0; i + size <= samples.length; i += hop) out.push({ start: i / sampleRate, data: samples.subarray(i, i + size) });
  return out;
}

/** Peak level in dBFS (−Infinity for silence). */
export function peakDb(data: Float32Array): number {
  let peak = 0;
  for (const x of data) peak = Math.max(peak, Math.abs(x));
  return 20 * Math.log10(peak);
}

/** In-place radix-2 FFT of (re, im); the length must be a power of 2. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
}

/** The power spectrum of a window (Hann-weighted, zero-padded to a power of 2): power per bin and the bin width in Hz. */
export function powerSpectrum(data: Float32Array, sampleRate: number): { power: Float64Array; binHz: number } {
  let n = 1;
  while (n < data.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < data.length; i++) re[i] = data[i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (data.length - 1)));
  fft(re, im);
  const power = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) power[k] = re[k]! ** 2 + im[k]! ** 2;
  return { power, binHz: sampleRate / n };
}

/** Spectral centroid in Hz of a power spectrum (0 for silence). */
export function centroid(power: Float64Array, binHz: number): number {
  let weighted = 0;
  let total = 0;
  for (let k = 0; k < power.length; k++) {
    weighted += k * binHz * power[k]!;
    total += power[k]!;
  }
  return total > 0 ? weighted / total : 0;
}

/** A biquad as (b0, b1, b2, a1, a2), a0 normalized to 1. */
type Biquad = [number, number, number, number, number];

/**
 * ITU-R BS.1770 K-weighting at any sample rate: the high-shelf "pre-filter" and the high-pass "RLB" filter, from
 * their analog prototypes by the bilinear transform (the published 48 kHz coefficients are this design at 48 kHz).
 */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Pre-filter: shelf of +4 dB above about 1.5 kHz
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / Q + K * K;
  const shelf: Biquad = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  // RLB: second-order high-pass at about 38 Hz
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / sampleRate);
  const a01 = 1 + K1 / Q1 + K1 * K1;
  const highpass: Biquad = [1, -2, 1, (2 * (K1 * K1 - 1)) / a01, (1 - K1 / Q1 + K1 * K1) / a01];
  return [shelf, highpass];
}

function filter(x: Float32Array, [b0, b1, b2, a1, a2]: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let [x1, x2, y1, y2] = [0, 0, 0, 0];
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i]! + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    [x2, x1, y2, y1] = [x1, x[i]!, y1, v];
    y[i] = v;
  }
  return y;
}

/** L-4: momentary loudness (LUFS) of a mono signal in 400 ms windows every 100 ms. */
export function momentaryLoudness(samples: Float32Array, sampleRate: number): { start: number; lufs: number }[] {
  const [shelf, highpass] = kWeighting(sampleRate);
  const weighted = filter(filter(samples, shelf), highpass);
  return windows(weighted, sampleRate, 0.4, 0.1).map(({ start, data }) => {
    let sum = 0;
    for (const v of data) sum += v * v;
    return { start, lufs: -0.691 + 10 * Math.log10(sum / data.length) };
  });
}

export interface Report {
  /** L-3: the highest peak of any 100 ms window, dBFS */
  maxPeakDb: number;
  /** L-3: the highest centroid of any 100 ms window, Hz, and the centroid of the whole render */
  maxWindowCentroid: number;
  overallCentroid: number;
  /** L-4: the largest rise of momentary loudness from one window to the next, from `after` s on (dB), and where */
  maxRiseDb: number;
  maxRiseAt: number;
  /** L-2: peak level per second over the first 6 s, dBFS */
  firstSeconds: number[];
}

/** The L-2–L-4 report of a mono render. Windows quieter than −70 LUFS count as silence for the rises. */
export function report(samples: Float32Array, sampleRate: number, after: number): Report {
  const ws = windows(samples, sampleRate, 0.1);
  let maxPeakDb = Number.NEGATIVE_INFINITY;
  let maxWindowCentroid = 0;
  let total: Float64Array | null = null;
  let binHz = 0;
  for (const { data } of ws) {
    maxPeakDb = Math.max(maxPeakDb, peakDb(data));
    const s = powerSpectrum(data, sampleRate);
    binHz = s.binHz;
    maxWindowCentroid = Math.max(maxWindowCentroid, centroid(s.power, s.binHz));
    if (!total) total = new Float64Array(s.power.length);
    for (let k = 0; k < s.power.length; k++) total[k]! += s.power[k]!;
  }
  const loud = momentaryLoudness(samples, sampleRate).filter((w) => w.start >= after);
  let maxRiseDb = Number.NEGATIVE_INFINITY;
  let maxRiseAt = 0;
  for (let i = 1; i < loud.length; i++) {
    const from = Math.max(loud[i - 1]!.lufs, -70);
    const to = Math.max(loud[i]!.lufs, -70);
    if (to - from > maxRiseDb) [maxRiseDb, maxRiseAt] = [to - from, loud[i]!.start];
  }
  const firstSeconds = windows(samples, sampleRate, 1).slice(0, 6).map((w) => peakDb(w.data));
  return { maxPeakDb, maxWindowCentroid, overallCentroid: total ? centroid(total, binHz) : 0, maxRiseDb, maxRiseAt, firstSeconds };
}
