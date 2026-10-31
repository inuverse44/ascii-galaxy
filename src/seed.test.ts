import { describe, expect, it } from "vitest";
import { seedFromQuery } from "./seed";

describe("?seed=<integer>", () => {
  it("accepts every safe integer, zero and negatives included", () => {
    for (const seed of [0, 1, -1, 42, -2147483648, 2147483647, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
      expect(seedFromQuery(`?seed=${seed}`)).toBe(seed);
    }
  });

  it("returns null when the seed is absent, empty, or not a safe integer", () => {
    for (const search of ["", "?other=1", "?seed=", "?seed=%20", "?seed=1.5", "?seed=abc", "?seed=1e3", "?seed=0x10", "?seed=9007199254740993", "?seed=Infinity"]) {
      expect(seedFromQuery(search), search).toBeNull();
    }
  });
});
