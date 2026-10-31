// C01 helper: the sky's seed from the page URL. ?seed=<integer> reproduces a sky (screenshots, bug reports).

/** The seed given in the query string: any safe integer, zero and negatives included. Null when absent or not one. */
export function seedFromQuery(search: string): number | null {
  const raw = new URLSearchParams(search).get("seed");
  if (raw === null || !/^-?\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
