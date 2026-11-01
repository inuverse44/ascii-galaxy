// Measures the #21 prototype: frame times at PC and phone width (phone also with the CPU 4× slower), and stills.
// Usage: node prototypes/density-wave/proto-measure.mjs (stills go to prototypes/density-wave/shots/)
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const dir = here;
const page0 = `file://${here}/index.html`;
mkdirSync(`${here}/shots`, { recursive: true });
const browser = await chromium.launch();

const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))];

for (const [name, width, height, throttle] of [["pc", 1440, 900, 1], ["phone", 390, 844, 1], ["phone-cpu4x", 390, 844, 4]]) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: name.startsWith("phone") ? 2 : 1 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await page.goto(page0);
  await page.waitForTimeout(500);
  await page.evaluate(() => (window.frameTimes.length = 0));
  await page.waitForTimeout(3000);
  const { times, n } = await page.evaluate(() => ({ times: window.frameTimes.slice(), n: window.starCount() }));
  console.log(`${name}: ${n} stars, ${times.length} frames in 3 s, draw median ${quantile(times, 0.5).toFixed(1)} ms, p95 ${quantile(times, 0.95).toFixed(1)} ms`);
  await context.close();
}

for (const [name, width, height] of [["pc", 1440, 900], ["phone", 390, 844]]) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  for (const t of [0, 20, 120]) {
    await page.goto(`${page0}?still&t=${t}`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/shots/${name}-t${t}.png` });
  }
  await context.close();
}
await browser.close();
