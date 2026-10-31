// R-11 and AU-2 in a real browser, on the production build: no sound before "♪", music within a second after it,
// and "♪" the page's only interactive element. Audio is observed without hooks in the app: the AudioContext
// constructor and the start() of every source node are wrapped before the page's scripts run.
import { type Page, expect, test } from "@playwright/test";

declare global {
  interface Window {
    __contexts: AudioContext[];
    __starts: number;
  }
}

async function watchAudio(page: Page) {
  await page.addInitScript(() => {
    window.__contexts = [];
    window.__starts = 0;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        window.__contexts.push(this);
      }
    };
    for (const proto of [OscillatorNode.prototype, AudioBufferSourceNode.prototype]) {
      const start = proto.start;
      proto.start = function (this: AudioScheduledSourceNode, ...args: [number?, number?, number?]) {
        window.__starts++;
        return (start as (...a: unknown[]) => void).apply(this, args);
      };
    }
  });
}

test("R-11: no AudioContext before the button; within 1 s after it, running with notes scheduled", async ({ page }) => {
  await watchAudio(page);
  await page.goto("/?seed=1");
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__contexts.length)).toBe(0);
  expect(await page.evaluate(() => window.__starts)).toBe(0);
  const button = page.getByRole("button", { name: "Play music" });
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await page.waitForFunction(() => window.__contexts.length === 1 && window.__contexts[0]!.state === "running" && window.__starts > 0, null, { timeout: 1000 });
  await expect(page.getByRole("button", { name: "Pause music" })).toHaveAttribute("aria-pressed", "true");
});

test("AU-2: a second press suspends the music and a third resumes it", async ({ page }) => {
  await watchAudio(page);
  await page.goto("/?seed=1");
  await page.getByRole("button", { name: "Play music" }).click();
  await page.waitForFunction(() => window.__contexts[0]?.state === "running");
  await page.getByRole("button", { name: "Pause music" }).click();
  await page.waitForFunction(() => window.__contexts[0]!.state === "suspended");
  await page.getByRole("button", { name: "Play music" }).click();
  await page.waitForFunction(() => window.__contexts[0]!.state === "running");
  expect(await page.evaluate(() => window.__contexts.length)).toBe(1);
});

test("R-11: the page has exactly one interactive element, the ♪ button", async ({ page }) => {
  await page.goto("/?seed=1");
  const interactive = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]")]
      .filter((e) => e.tabIndex >= 0 || e.isContentEditable)
      .map((e) => e.textContent),
  );
  expect(interactive).toEqual(["♪"]);
});
