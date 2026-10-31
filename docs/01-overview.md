# 01 Overview design: decomposition by volatility (The Method)

Requirements: [00-requirements.md](00-requirements.md). Details of each component: [02-detailed-design.md](02-detailed-design.md).

## 1. Scope
A single static page. It draws a slowly turning ASCII galaxy on a white monospace grid and, after the "♪" button is pressed, plays chill music composed on the fly. There are no settings, no accounts, and nothing is saved.

## 2. What does not change (the core)
These are fixed as rules, not treated as volatility. Each has a check in 02 Verification, "Core".

| ID | Rule | Content |
|---|---|---|
| C-1 | The cell grid | The screen is a grid of monospace cells. Each cell shows at most one glyph on a filled background |
| C-2 | Brightness → cell | What is drawn is decided only by a brightness value in [0, 1] per cell plus a colour tag. E01 returns values in [0, 1]; E02 clamps any value outside it |
| C-3 | Pitch | 12-tone equal temperament, A4 = MIDI 69 = 440 Hz. Notes are MIDI numbers |
| C-4 | Time in music | 4/4; a bar has 16 steps of a 16th note; one step lasts 60 / BPM / 4 s |

## 3. Volatility analysis
| ID | Volatility | How it may change | Axis | Encapsulated in |
|---|---|---|---|---|
| VOL-01 | What is in the sky | One spiral → several galaxies → an interacting pair. Star count, tilt, size | Time | E01 SkyEngine |
| VOL-02 | How brightness becomes glyphs | Glyph ramp, colours, white or black paper, cell size | Time | E02 RasterEngine |
| VOL-03 | Rare events | A star brightening → shooting stars, comets. Frequency | Time | E03 EventEngine |
| VOL-04 | Composition rules (style) | Chill → ambient → jazzier. Progressions, voicing, rhythm, melody rules | Time | E04 CompositionEngine (pure functions; a style's templates, form, comping patterns, and velocities are swappable data, and the other rules are E04's code, changed in E04) |
| VOL-05 | Timbre | FM electric piano → other synthesis → recorded samples | Time | E05 VoiceEngine (describes patches as data) |
| VOL-06 | Where the picture goes | Canvas 2D → WebGL → terminal → video export | Time | A01 DisplayAccess |
| VOL-07 | Where the sound goes | Real-time AudioContext → OfflineAudioContext for tests and export | Use (test vs. live) | A02 AudioAccess |
| VOL-08 | How time advances | Real time, a single still frame (reduced motion), paused off-screen, fixed time in tests | Use | U01 Clock (pure; C01 feeds it frame times and visibility) |
| VOL-09 | How picture and sound are tied | Only the chime → chords following the rotation, and so on | Time | M01 AmbienceManager |

## 4. Not treated as volatility
| Candidate | Reason |
|---|---|
| User settings (volume slider, style picker) | R-11 allows only the "♪" button. Revisit as a new Client if needed |
| Playing existing audio files | Excluded by the premises (no existing music) |
| Saving state between visits | Nothing is worth keeping; each visit starts fresh |
| Camera movement | Excluded by the premises (fixed view) |

## 5. Layers
```mermaid
flowchart TB
  subgraph Client
    C01["C01 Page<br/>canvas, ♪ button, wiring"]
    C02["C02 Test harness<br/>fixed seed and time"]
  end
  subgraph Manager
    M01["M01 AmbienceManager<br/>frame workflow, music scheduling, event routing"]
  end
  subgraph Engine
    E01["E01 SkyEngine"]
    E02["E02 RasterEngine"]
    E03["E03 EventEngine"]
    E04["E04 CompositionEngine"]
    E05["E05 VoiceEngine"]
  end
  subgraph ResourceAccess
    A01["A01 DisplayAccess"]
    A02["A02 AudioAccess"]
  end
  subgraph Resource
    R01["R01 Canvas 2D"]
    R02["R02 Web Audio"]
  end
  subgraph Utility
    U01["U01 Clock"]
    U02["U02 Random (seeded)"]
    U03["U03 Pitch (MIDI, scales, intervals)"]
  end
  C01 --> M01
  C02 --> M01
  M01 --> E01 & E02 & E03 & E04 & E05
  M01 --> A01 & A02
  A01 --> R01
  A02 --> R02
```

- Engines never call each other. M01 passes the output of one Engine to the next.
- Engines are pure: they take state, time, and a random source, and return data (a brightness field, cells, events, notes, patches).
- Browser APIs are used only by C01 (DOM, the "♪" button, requestAnimationFrame, IntersectionObserver, matchMedia) and by A01 and A02 (Canvas 2D, Web Audio). M01, the Engines, and the Utilities never touch them. C02 can therefore test M01, every Engine, and every Utility without a browser. Tests that go through C01, A01, or A02 need one: the R-11 test (UC-02: C01, A02), the R-08 test (UC-04: C01, A01), and the sound renders (UC-05: A02).
- Utilities may be used from any layer.

## 6. Core use cases and call chains
| ID | Use case | Call chain |
|---|---|---|
| UC-01 | Open the page and watch: the galaxy turns, stars twinkle | C01 (requestAnimationFrame) → U01.advance(now) → M01.step(dt) → E03.update(t, rng from U02) → E01.field(t, flares) → E02.rasterize(field, t) → A01.draw(cells) → R01 |
| UC-02 | Press "♪": music starts and the layers change every 8 bars | C01 (button) → M01.startMusic() → A02.open() → R02. Each bar, ahead of time: M01 → E04.nextBar(state, rng from U02, pitches from U03) → notes → E05.patch(note, layer) → A02.schedule(patch, when) → R02 |
| UC-03 | A star brightens and a chime in the current key sounds | Within the UC-01 frame loop (C01 → U01.advance → M01.step), E03.update (rng from U02) emits a Flare → M01 → E01.field(t, flares) → E02 → A01 → R01; and, once music has started, M01 → E04.chime(key, scale from U03) → E05.patch → A02.schedule → R02 |
| UC-04 | Reduced motion shows one still frame; off-screen stops | C01 (matchMedia or IntersectionObserver) → U01 mode still or paused. Still: M01.step once at a settled time → E03 (rng from U02) → E01 → E02 → A01 → R01. Paused: M01 is not stepped |
| UC-05 | A test renders sound and checks the limits (R-13): a forced 60 s render and a natural 6-minute render | C02 → U01 mode fixed, U02 seeded, style chosen (forced test style or default) → M01.startMusic() with A02 bound to an OfflineAudioContext (R02). For the length of the render: M01 → E04 (pitches from U03) → E05 → A02.schedule → R02 render; flares come from E03 (U02) and trigger E04.chime as in UC-03 → C02 measures the rendered buffer |

Where each component appears:

| Component | Use cases |
|---|---|
| C01 | UC-01, UC-02, UC-03, UC-04 |
| C02 | UC-05 |
| M01 | UC-01–UC-05 |
| E01, E02, A01, R01 | UC-01, UC-03, UC-04 |
| E03 | UC-01, UC-03, UC-04, UC-05 |
| E04, E05, A02, R02 | UC-02, UC-03, UC-05 |
| U01 | UC-01, UC-03, UC-04, UC-05 |
| U02 | UC-01, UC-02, UC-03, UC-04, UC-05 |
| U03 | UC-02, UC-03, UC-05 |

## 7. Requirements traceability
Rule IDs and checks are in [02-detailed-design.md](02-detailed-design.md), "Verification".

| Requirement | Where it is met | How it is checked |
|---|---|---|
| R-01 | E01 (SK-4): placement, tilt, disc 50–60% of the width, drawn galaxy at least 0.65 of the disc, reduced on very wide screens | SK-4 unit test (disc at 1440 × 900 and 390 × 844; drawn galaxy at 120 times across a turn, and its outline changes; height at the corners of the RS-1 range); screenshots |
| R-02 | E01 (SK-5) | SK-5 unit test; screenshots |
| R-03 | E01 (SK-2, SK-3) | SK-2 and SK-3 unit tests at fixed times |
| R-04 | E01 (SK-6) | SK-6 unit test |
| R-05 | E03 (EV-1, EV-2), E01 (SK-7), M01 (MG-4) | EV-1, EV-2, SK-7, MG-4 unit tests |
| R-06 | E02 (RS-3, RS-4), E01 (SK-8), M01 (MG-4) | RS-3, RS-4, SK-8 unit tests; screenshots |
| R-07 | E02 (RS-1) | RS-1 unit test; screenshots at 1440 px and 390 px |
| R-08 | C01, U01 (UC-04) | Browser test: reduced motion and off-screen |
| R-10 | E04 (H, V, RH, M, F rules), E05 (T rules), A02 (MC rules), M01 (bar scheduling) | Music, timbre, and master-chain unit tests; R-10 long-run test; listening |
| R-11 | C01, A02 (UC-02; AU-1, AU-2) | Browser tests: before and after the button, suspend and resume; only one interactive element |
| R-12 | E03 (EV-3) → M01 (MG-4, MG-5) → E04 (F-3) → E05 → A02 (UC-03) | EV-3, MG-4 (each flare reaches the listener once), F-3, and MG-5 (each flare gives exactly one chime, in the key in force) unit tests |
| R-13 | E05 (L-1), A02 (L-2–L-4) | L-1 unit test; the fade-in probe; forced and natural renders |
| R-21 | Outside the runtime layers: `.github/workflows/`, `.github/dependabot.yml` | CI step "Check workflows" (`scripts/check-workflows.mjs`) on pushes to main, PRs, and manual runs. It reads the workflows with a YAML parser (a file that does not parse fails): every external `uses:` that GitHub runs (a job's or a step's, and the steps of the local actions they call) pinned to a 40-hex SHA (Docker images to a digest), while a `uses` key elsewhere (an env variable, an input) is data; workflow-wide permissions `contents: read` only; no `pull_request_target` in any form of `on:`. Its tests break each rule in each YAML form (flow mappings, quoted keys, lists), and pass equivalent forms of a passing workflow. Dependabot's configuration covers npm and Actions |

## 8. Open questions
- OQ-01 Whether to show the page on the homepage's list of works.
