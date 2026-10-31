// Browser tests (docs/02 "Browser boundary"). Named *.e2e.ts so that Vitest does not pick them up.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://localhost:4173", viewport: { width: 1440, height: 900 } },
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
