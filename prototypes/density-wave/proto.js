// Prototype for #21: star particles on density-wave orbits, drawn as characters every frame.
// Kinematic density waves: each star moves on an ellipse; the ellipse's orientation grows with its size, so orbits
// crowd into two arms. The orientations turn rigidly at the pattern speed; each star runs round its ellipse at
// Ω(r) − Ωp in that turning frame, so it turns at about Ω(r) on screen and passes through the arms.
"use strict";

const TAU = Math.PI * 2;
const params = new URLSearchParams(location.search);
// Turn times: about 1 minute near the centre, 3 minutes at the edge, the pattern 8 minutes
const OMEGA_EDGE = TAU / 180;
const OMEGA_PATTERN = TAU / 480;
const CORE_R = 0.12; // where the rotation curve stops rising
const TWIST = Number(params.get("twist") ?? 1.1); // radians of ellipse orientation per unit radius: how tightly the arms wind
const AXIS = Number(params.get("axis") ?? 0.7); // the ellipses' minor/major axis ratio
const TILT = 0.55; // the disc seen at an angle: y scaled by this
const RAMP = " .:;t%SX8#@";

let seed = Number(params.get("seed") ?? 1) >>> 0 || 1;
const rand = () => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Flat rotation curve with a rising core: v(r) = vflat (1 − e^(−r/rc)); Ω = v / r. */
const vflat = OMEGA_EDGE / (1 - Math.exp(-1 / CORE_R));
const omega = (r) => (vflat * (1 - Math.exp(-Math.max(r, 1e-3) / CORE_R))) / Math.max(r, 1e-3);

const canvas = document.getElementById("sky");
const ctx = canvas.getContext("2d", { alpha: false });
let W = 0, H = 0, dpr = 1, scale = 0, cx = 0, cy = 0;
let stars = [];

function makeStars(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    // An exponential disc (scale length 0.35) from 0.05 out to 1.15, so the edge fades; a tenth in a round bulge
    const bulge = rand() < 0.1;
    const span = 1 - Math.exp(-1.1 / 0.35);
    const a = bulge ? Math.min(0.3, 0.08 * Math.sqrt(-2 * Math.log(1 - rand()))) : 0.05 - 0.35 * Math.log(1 - rand() * span);
    out.push({
      a,
      axis: bulge ? 1 : AXIS,
      // One family of ellipses whose orientation turns with ln(size): a logarithmic spiral; the ellipse's own
      // 2-fold symmetry gives two arms
      orient: bulge ? rand() * TAU : TWIST * Math.log(a / 0.05),
      phase: rand() * TAU,
      jitter: (rand() - 0.5) * 0.04, // a little spread, so arms are not one-star thin
      twinklePhase: rand() * TAU,
      twinkleRate: TAU / (5 + 3 * rand()),
      glint: rand() < 0.015 ? (a < 0.15 ? "#c98a1a" : rand() < 0.5 ? "#4a7bd0" : "#d0608a") : null,
      x: 0,
      y: 0,
    });
  }
  return out;
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  // Disc 55% of the width (or of the height on tall screens), centred on a third line
  scale = (W > H ? 0.55 * Math.min(W, H * 1.6) : 0.9 * W) / 2;
  cx = W > H ? W * 0.62 : W * 0.5;
  cy = W > H ? H * 0.5 : H * 0.4;
  // Stars by the galaxy's size on screen, not the screen's
  const count = Math.round(Number(params.get("n") ?? Math.min(6000, Math.max(2500, 0.035 * scale * scale))));
  seed = Number(params.get("seed") ?? 1) >>> 0 || 1;
  stars = makeStars(count);
}

// Polar density grid in the disc's plane: a star's brightness is how crowded its cell is compared with the mean of
// its ring (the arm contrast), plus a radial term for the bright centre
const RINGS = 24, SECTORS = 48, RMAX = 1.2;
const density = new Float32Array(RINGS * SECTORS);
const ringMean = new Float32Array(RINGS);

function step(t) {
  density.fill(0);
  for (const s of stars) {
    const theta = s.phase + (omega(s.a) - OMEGA_PATTERN) * t;
    const ex = s.a * Math.cos(theta);
    const ey = s.a * s.axis * Math.sin(theta);
    const o = s.orient + OMEGA_PATTERN * t;
    const r = 1 + s.jitter;
    const gx = (ex * Math.cos(o) - ey * Math.sin(o)) * r;
    const gy = (ex * Math.sin(o) + ey * Math.cos(o)) * r;
    s.x = cx + gx * scale;
    s.y = cy + gy * scale * TILT;
    s.r = Math.hypot(gx, gy);
    const ring = Math.floor((s.r / RMAX) * RINGS);
    const sector = Math.floor(((Math.atan2(gy, gx) + Math.PI) / TAU) * SECTORS) % SECTORS;
    s.cell = ring < RINGS ? ring * SECTORS + sector : -1;
    if (s.cell >= 0) density[s.cell]++;
  }
  for (let k = 0; k < RINGS; k++) {
    let sum = 0;
    for (let q = 0; q < SECTORS; q++) sum += density[k * SECTORS + q];
    ringMean[k] = sum / SECTORS;
  }
}

let maxDensity = 1;
function draw(t) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  const base = Math.max(8, Math.min(15, W / 100));
  // Bucket by (glyph level, ink): one font and one fill per bucket
  const buckets = new Map();
  for (const s of stars) {
    // Arm contrast: 1 at the ring's mean; arms reach about 2–3. The centre adds e^(−r/0.15).
    // Few stars in a cell say little: shrink toward the ring's mean by adding K stars of the mean to both sides
    const K = 1.5;
    const mean = s.cell >= 0 ? ringMean[Math.floor(s.cell / SECTORS)] : 0;
    const contrast = s.cell >= 0 ? (density[s.cell] + K) / (mean + K) : 0;
    const d = Math.max(0, Math.min(1, 0.6 * (contrast - 0.8) + 0.8 * Math.exp(-s.r / 0.15)));
    const tw = 0.75 + 0.25 * Math.sin(s.twinklePhase + s.twinkleRate * t);
    const level = Math.max(1, Math.min(RAMP.length - 1, Math.round(d * tw * (RAMP.length - 1))));
    const sizeStep = Math.min(4, Math.floor(d * 5)); // 5 sizes
    const glintOn = s.glint && Math.sin(s.twinklePhase * 3 + t * 2.4) > 0.2;
    const ink = glintOn ? s.glint : `rgba(20,20,20,${(0.3 + 0.45 * d * tw).toFixed(1)})`;
    const key = `${sizeStep}|${ink}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { sizeStep, ink, items: [] }));
    b.items.push(s, RAMP[level]);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const b of buckets.values()) {
    ctx.font = `600 ${(base * (0.6 + 0.12 * b.sizeStep)).toFixed(1)}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = b.ink;
    const it = b.items;
    for (let k = 0; k < it.length; k += 2) ctx.fillText(it[k + 1], it[k].x, it[k].y);
  }
}

// Fixed start time (?t=) for screenshots; otherwise the clock runs
const t0 = Number(params.get("t") ?? 0);
const speed = Number(params.get("speed") ?? 1);
const start = performance.now();
window.frameTimes = [];
function frame(now) {
  const t = t0 + ((now - start) / 1000) * speed;
  const a = performance.now();
  step(t);
  draw(t);
  window.frameTimes.push(performance.now() - a);
  if (!params.has("still")) requestAnimationFrame(frame);
}
window.addEventListener("resize", resize);
resize();
requestAnimationFrame(frame);
window.starCount = () => stars.length;
