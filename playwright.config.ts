// Browser tests (docs/02 "Browser boundary" and "Sound output"). Named *.e2e.ts so that Vitest does not pick them
// up. The page under test is the production build (preview, port 4173); the sound renders run on a harness page
// that only the Vite dev server serves (port 5174), so it is never built or published.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://localhost:4173", viewport: { width: 1440, height: 900 } },
  webServer: [
    {
      command: "npm run build && npm run preview -- --port 4173 --strictPort",
      url: "http://localhost:4173",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npx vite --port 5174 --strictPort",
      url: "http://localhost:5174/e2e/harness/sound.html",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
