// L-2–L-4 and MC-1–MC-6 in a real browser (docs/02 "Sound output"): renders through M01 and A02 on an
// OfflineAudioContext, on a harness page served by the Vite dev server (playwright.config.ts).
import { type Page, expect, test } from "@playwright/test";

const HARNESS = "http://localhost:5174/e2e/harness/sound.html";

interface Render {
  played: Record<string, number>;
  maxPeakDb: number;
  maxWindowCentroid: number;
  overallCentroid: number;
  maxRiseDb: number;
  maxRiseAt: number;
}

async function open(page: Page) {
  await page.goto(HARNESS);
  await expect(page).toHaveTitle("ready");
}

/** L-3, L-4 on one render. */
function expectLimits(r: Render, label: string) {
  expect(r.maxPeakDb, `${label}: peak`).toBeLessThanOrEqual(-6);
  expect(r.maxWindowCentroid, `${label}: centroid of a window`).toBeLessThanOrEqual(3000);
  expect(r.overallCentroid, `${label}: centroid overall`).toBeLessThanOrEqual(2000);
  expect(r.maxRiseDb, `${label}: loudness rise at ${r.maxRiseAt} s`).toBeLessThanOrEqual(10);
}

test("L-3, L-4 forced render: every source sounds within 60 s, and the limits hold", async ({ page }) => {
  test.setTimeout(300_000);
  await open(page);
  const r = (await page.evaluate(() => window.render({ seed: 1, seconds: 60, forced: true }))) as Render;
  // Every source the master chain can play: the five layers, the chime (two flares), and the vinyl clicks
  for (const source of ["pad", "epiano", "bass", "drums", "melody", "chime", "click"]) expect(r.played[source] ?? 0, source).toBeGreaterThan(0);
  expect(r.played.chime).toBe(2);
  expectLimits(r, "forced");
});

for (const seed of [1, 2]) {
  test(`L-3, L-4 natural render, seed ${seed}: 6 minutes of the default style within the limits`, async ({ page }) => {
    test.setTimeout(1_200_000);
    await open(page);
    const r = (await page.evaluate((s) => window.render({ seed: s, seconds: 360, forced: false }), seed)) as Render;
    for (const source of ["pad", "epiano", "bass", "drums", "melody", "click"]) expect(r.played[source] ?? 0, source).toBeGreaterThan(0);
    expectLimits(r, `natural ${seed}`);
  });
}

test("L-2: the output fades in linearly over 4 s from the start", async ({ page }) => {
  await open(page);
  const levels = await page.evaluate(() => window.probeFadeIn());
  // A steady tone measured at 0.5, 1, 2, 3, 3.9, 4.5, 5.5 s, as a share of its level after the fade
  [0.5, 1, 2, 3, 3.9].forEach((t, i) => expect(Math.abs(levels[i]! - t / 4), `${t} s`).toBeLessThanOrEqual(0.03));
  expect(Math.abs(levels[5]! - 1)).toBeLessThanOrEqual(0.01);
});

test("MC-1–MC-6: the chain A02 built has the stages in order, wired as described, with the stated parameters", async ({ page }) => {
  await open(page);
  const c = (await page.evaluate(() => window.inspectChain())) as {
    edges: [string, string][];
    lowpass: { type: string; frequency: number; q: number };
    saturation: { curveLength: number; curveError: number };
    wobble: { lfoType: string; rate: number; depth: number };
    reverb: { seconds: number };
    vinyl: { loop: boolean; highpass: [string, number]; lowpass: [string, number] };
  };
  // MC-1: input → low-pass → saturation → wobble (delay) → reverb (dry and convolver → wet) → sum → output;
  // the vinyl joins at the sum, after the reverb; the LFO moves the delay time. Nothing else is connected.
  expect(new Set(c.edges.map((e) => e.join(" → ")))).toEqual(
    new Set([
      "input → lowpass",
      "lowpass → saturation",
      "saturation → delay",
      "delay → dry",
      "delay → convolver",
      "convolver → wet",
      "dry → sum",
      "wet → sum",
      "vinyl → vinyl.highpass",
      "vinyl.highpass → vinyl.lowpass",
      "vinyl.lowpass → vinyl.level",
      "vinyl.level → sum",
      "sum → output",
      "output → destination",
      "lfo → depth",
      "depth → delay.delayTime",
    ]),
  );
  // MC-2
  expect(c.lowpass.type).toBe("lowpass");
  expect(Math.abs(c.lowpass.frequency - 2500)).toBeLessThanOrEqual(250);
  // MC-3: the curve A02 set is E05's tanh curve
  expect(c.saturation.curveLength).toBeGreaterThan(256);
  expect(c.saturation.curveError).toBeLessThan(1e-6);
  // MC-4: a sine LFO at 0.3 Hz ± 0.05 with the delay amplitude for 6 cents ± 1
  expect(c.wobble.lfoType).toBe("sine");
  expect(Math.abs(c.wobble.rate - 0.3)).toBeLessThanOrEqual(0.05);
  const cents = 1200 * Math.log2(1 + 2 * Math.PI * c.wobble.rate * c.wobble.depth);
  expect(Math.abs(cents - 6)).toBeLessThanOrEqual(1);
  // MC-5: band-limited noise, 200 Hz–4 kHz
  expect(c.vinyl.loop).toBe(true);
  expect(c.vinyl.highpass).toEqual(["highpass", 200]);
  expect(c.vinyl.lowpass).toEqual(["lowpass", 4000]);
  // MC-6: the impulse response loaded into the convolver lasts the decay time (its fall is measured in the unit test)
  expect(Math.abs(c.reverb.seconds - 2.5)).toBeLessThanOrEqual(0.2);
});

test("MC-5: the vinyl noise alone, after the fade, is at most −45 dBFS", async ({ page }) => {
  await open(page);
  const db = await page.evaluate(() => window.probeVinyl());
  expect(db).toBeLessThanOrEqual(-45);
  expect(db).toBeGreaterThan(-70); // it really sounds
});
