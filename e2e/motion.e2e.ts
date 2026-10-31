// R-08 and MG-1 in a real browser. Draws are counted without any hook in the app: A01 strokes the grid lines exactly
// once per draw, so CanvasRenderingContext2D.prototype.stroke is wrapped to record the time of each call.
import { type Page, expect, test } from "@playwright/test";

declare global {
  interface Window {
    __draws: number[];
  }
}

async function countDraws(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__draws = [];
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function (this: CanvasRenderingContext2D, ...args: []) {
      window.__draws.push(performance.now());
      return stroke.apply(this, args);
    };
  });
}

/**
 * Draws recorded during about `ms` milliseconds, timed inside the page: the window's start and end are both taken
 * there, so a slow test runner cannot stretch it. Returns the count and the window's actual length.
 */
async function drawsDuring(page: Page, ms: number): Promise<{ count: number; seconds: number }> {
  return page.evaluate(async (wait) => {
    const start = performance.now();
    await new Promise((resolve) => setTimeout(resolve, wait));
    const end = performance.now();
    return { count: window.__draws.filter((t) => t >= start && t <= end).length, seconds: (end - start) / 1000 };
  }, ms);
}

test("live: the sky is redrawn, at most 12 times a second, and the picture changes (MG-1, R-03)", async ({ page }) => {
  await countDraws(page);
  await page.goto("/?seed=1");
  await page.waitForTimeout(1000);
  const before = await page.locator("#sky").screenshot();
  const { count, seconds } = await drawsDuring(page, 3000);
  expect(count).toBeGreaterThanOrEqual(6);
  expect(count).toBeLessThanOrEqual(Math.floor(12 * seconds) + 1);
  const after = await page.locator("#sky").screenshot();
  expect(after.equals(before)).toBe(false);
});

test("reduced motion: exactly one draw in 3 s (R-08)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await countDraws(page);
  await page.goto("/?seed=1");
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__draws.length)).toBe(1);
});

test("off screen: no draws for 2 s, and drawing resumes when the canvas comes back (R-08)", async ({ page }) => {
  await countDraws(page);
  await page.goto("/?seed=1");
  await page.waitForTimeout(1000);
  expect((await drawsDuring(page, 1000)).count).toBeGreaterThan(0); // the path is live before the test moves the canvas
  await page.evaluate(() => {
    document.querySelector<HTMLCanvasElement>("#sky")!.style.transform = "translateY(300vh)";
  });
  await page.waitForTimeout(500); // IntersectionObserver reports asynchronously
  expect((await drawsDuring(page, 2000)).count).toBe(0);
  await page.evaluate(() => {
    document.querySelector<HTMLCanvasElement>("#sky")!.style.transform = "";
  });
  expect((await drawsDuring(page, 1500)).count).toBeGreaterThan(0);
});
