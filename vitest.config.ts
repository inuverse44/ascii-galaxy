// Unit tests. The sky and music checks sample many points and minutes (the longest, MG-4's 30-minute runs, take
// about 60 s alone), and Vitest runs the files in parallel: a test that takes 3 s alone took over 6 s in the full
// suite, and the MG-4 runs took 376 s on a machine busy with other work. One generous timeout for all tests, here,
// instead of per-test timeouts that each assume a load (review of #13).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 600_000,
  },
});
