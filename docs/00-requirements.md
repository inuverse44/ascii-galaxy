# 00 Requirements

A calm screen: an ASCII spiral galaxy turning slowly on white paper, with chill music composed on the fly. Meant to be left open in a browser and looked at.

## Premises
- The visual reference is material provided by the user ([stackedlol/ascii-sharks](https://github.com/stackedlol/ascii-sharks): a monospace grid painted one cell at a time). The reference has no LICENSE, so no code is copied; only the ideas are borrowed and rewritten.
- Not a space flight. The camera does not move. Not as dense as a deep field.
- The background is white. The purpose is relaxation.
- No existing music is used. The chill style is broken down into music theory, and new music is built from those rules on the fly. No melody or progression of a specific song is copied.
- Vite + TypeScript, with no runtime dependencies. Published on GitHub Pages.

## Visuals
| ID | Requirement |
|---|---|
| R-01 | One main spiral galaxy, placed on a rule-of-thirds line, tilted slightly so it looks elliptical. Its disc spans 50–60% of the screen width. The faint disc between the arms is left as white paper, so the spiral reads clearly; the drawn galaxy is therefore smaller than the disc (at least 65% of its diameter) and its outline changes as the arms turn (the user chose this over filling the disc to keep the drawn size at 50–60%). On screens so wide that the galaxy would not fit, it is made smaller so its height is at most 92% of the screen height |
| R-02 | 3–5 small distant galaxies (smudges of 3–8 cells each) and a few dozen stars |
| R-03 | The galaxy turns about once every 10 minutes. The center turns faster than the outside, and the arms keep their shape |
| R-04 | Stars twinkle with periods of 5–8 seconds, out of step with each other |
| R-05 | Rare event: every few minutes, one star brightens over about 20 seconds and fades away |
| R-06 | Ink on white paper: brighter regions use denser glyphs. A few faint colour glints (blue and pink in the arms, amber in the core), changing once every 2–3 seconds |
| R-07 | The galaxy's shape reads clearly in glyphs at both desktop width (1440 px) and phone width (390 px) |
| R-08 | Under prefers-reduced-motion, show a single still frame. Stop when off-screen |

## Sound
| ID | Requirement |
|---|---|
| R-10 | Compose and play chill music on the fly. It never ends and does not sound like a repeating loop |
| R-11 | Sound starts only after the "♪" button is pressed (browser autoplay rules). This button is the only UI on screen |
| R-12 | When a star brightens (R-05), play one small chime in the current key |
| R-13 | Keep the volume gentle: no piercing highs and no sudden loud sounds (numeric limits are set in the detailed design) |

## Operations
| ID | Requirement |
|---|---|
| R-21 | Pin external Actions to commit SHAs. Receive dependency updates through Dependabot |
