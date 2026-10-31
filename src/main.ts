// C01 Page: the canvas and the wiring. The only place, with A01, that touches browser APIs.
// It feeds animation frame times to M01 and sets the mode: still under prefers-reduced-motion, paused while the
// canvas is off screen or the page is hidden, live otherwise (R-08).

import { AudioAccess } from "./access/audio";
import { DisplayAccess } from "./access/display";
import { MAX_SCREEN, MIN_SCREEN } from "./engine/raster";
import { AmbienceManager } from "./manager/ambience";
import { seedFromQuery } from "./seed";

const canvas = document.querySelector<HTMLCanvasElement>("#sky");
if (!canvas) throw new Error("missing #sky canvas");

// ?seed=<integer> reproduces a sky; otherwise each visit gets a new one
const seed = seedFromQuery(location.search) ?? Math.floor(Math.random() * 2 ** 31);

const screenSize = (): [number, number] => {
  const clamp = (v: number) => Math.min(MAX_SCREEN, Math.max(MIN_SCREEN, Math.round(v)));
  return [clamp(window.innerWidth), clamp(window.innerHeight)];
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let onScreen = true;
const mode = () => (!onScreen || document.hidden ? "paused" : reducedMotion.matches ? "still" : "live");

const [width, height] = screenSize();
const manager = new AmbienceManager(new DisplayAccess(canvas), seed, width, height, window.devicePixelRatio, mode());

const update = () => manager.setMode(mode());
reducedMotion.addEventListener("change", update);
document.addEventListener("visibilitychange", update);
new IntersectionObserver((entries) => {
  onScreen = entries.some((e) => e.isIntersecting);
  update();
}).observe(canvas);

const loop = (now: number) => {
  manager.frame(now);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

// AU-2 (R-11): "♪" is the only control. No AudioContext exists before the first press; it is created then, and
// later presses suspend and resume it. AU-1: a timer (not the animation frame, which stops in a hidden tab) asks
// M01 to make bars ahead every 250 ms.
const button = document.querySelector<HTMLButtonElement>("#music");
if (!button) throw new Error("missing #music button");
let context: AudioContext | null = null;
const show = (playing: boolean) => {
  button.setAttribute("aria-pressed", String(playing));
  button.setAttribute("aria-label", playing ? "Pause music" : "Play music");
};
show(false);
button.addEventListener("click", async () => {
  if (!context) {
    context = new AudioContext();
    manager.startMusic(new AudioAccess(context));
    setInterval(() => manager.pumpMusic(), 250);
    await context.resume();
    show(true);
  } else if (context.state === "running") {
    await context.suspend();
    show(false);
  } else {
    await context.resume();
    show(true);
  }
});

let pending = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    const [w, h] = screenSize();
    manager.resize(w, h, window.devicePixelRatio);
  });
});
