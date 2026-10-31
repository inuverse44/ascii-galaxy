# ascii-galaxy

A calm screen: an ASCII spiral galaxy turning slowly on white paper, with chill music composed on the fly.

See it at https://inuverse44.github.io/ascii-galaxy/ (press ♪ for the music).

- Requirements: [docs/00-requirements.md](docs/00-requirements.md)
- Overview design (The Method): [docs/01-overview.md](docs/01-overview.md)
- Detailed design: [docs/02-detailed-design.md](docs/02-detailed-design.md)

```sh
npm install
npm run dev          # open the page; add ?seed=<integer> to the URL to see the same sky again
npm test             # unit tests
npm run test:e2e     # browser tests (builds first; needs Playwright's Chromium)
npm run check:workflows   # the workflow rules (R-21)
npm run screenshot -- <dir> [--seed <n>]   # PC and phone width screenshots (needs Playwright's Chromium)
```

## License

MIT
