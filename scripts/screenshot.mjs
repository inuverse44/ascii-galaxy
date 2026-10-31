// Screenshots at PC and phone width, for comparing with the reference (docs/02 "Visual and listening").
// Usage: npm run screenshot -- <output dir> [--seed <n>] [--url <page to capture as well>]...
// Builds the app, serves dist/ with Vite's preview server, and captures 1440 × 900 and 390 × 844.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { build, preview } from "vite";
import { seedFromQuery } from "../src/seed.ts";

const SIZES = [
  { name: "pc", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const args = process.argv.slice(2);
const outDir = args[0];
if (!outDir || outDir.startsWith("--")) {
  console.error("usage: npm run screenshot -- <output dir> [--seed <n>] [--url <url>]...");
  process.exit(2);
}
let seed = 1;
const urls = [];
for (let i = 1; i < args.length; i += 2) {
  // The page's own parser, so a seed accepted here is one the page reproduces
  const given = args[i] === "--seed" && args[i + 1] !== undefined ? seedFromQuery(`?seed=${encodeURIComponent(args[i + 1])}`) : null;
  if (given !== null) seed = given;
  else if (args[i] === "--url" && args[i + 1]) urls.push(args[i + 1]);
  else {
    console.error(`unknown or incomplete argument: ${args[i]}`);
    process.exit(2);
  }
}
mkdirSync(outDir, { recursive: true });

await build({ logLevel: "warn" });
const server = await preview({ preview: { port: 0, strictPort: false }, logLevel: "warn" });
const base = server.resolvedUrls?.local[0];
if (!base) throw new Error("preview server has no local URL");

const browser = await chromium.launch();
try {
  const targets = [{ label: `galaxy-seed${seed}`, url: `${base}?seed=${seed}` }, ...urls.map((url, k) => ({ label: `ref${k + 1}`, url }))];
  for (const { label, url } of targets) {
    for (const size of SIZES) {
      const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 2 });
      await page.goto(url, { waitUntil: "networkidle" });
      const file = join(outDir, `${label}-${size.name}.png`);
      await page.screenshot({ path: file });
      console.log(file);
      await page.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
