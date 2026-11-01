# Density-wave prototype (#21)

Star particles on kinematic density-wave orbits, drawn as characters every frame on a white canvas with no grid. Open `index.html` in a browser. Query parameters: `speed` (time multiplier), `t` (start time in s), `still` (draw one frame), `n` (star count), `seed`, `twist`, `axis`.

- Each star moves on an ellipse (minor/major 0.7) whose orientation is 1.1 × ln(a / 0.05) plus the pattern angle, so the crowding of orbits draws two logarithmic-spiral arms. The pattern turns once in 8 minutes; each star runs round its ellipse at Ω(r) − Ωp, with Ω from a rotation curve that rises to r = 0.12 and is flat outside (about 1 minute per turn near the centre, 3 minutes at the edge).
- A star's character, size, and ink come from its cell's count on a polar grid (24 rings × 48 sectors) compared with its ring's mean (shrunk toward the mean by 1.5 stars), plus e^(−r/0.15) for the centre.

`node prototypes/density-wave/proto-measure.mjs` measures it with Playwright and writes stills to `shots/` (not committed). On 2026-10-29, on a loaded machine: 1440 × 900, 5,489 stars, draw median 5.9 ms (p95 9.6); 390 × 844, 2,500 stars, 2.5 ms (6.2); the same with the CPU 4× slower, 16.6 ms (20.9).

Known issues: the centre fills in black; outer-arm characters vary a lot in size.
