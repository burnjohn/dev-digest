/**
 * Deterministic scorer — no model. Fraction of expected substrings present in the output.
 * Use as a cheap first tier: don't pay the judge for what a substring settles.
 */

export function patternMatch(output: string, expected: string[]): number {
  if (expected.length === 0) return 1;
  const low = output.toLowerCase();
  return expected.filter((e) => low.includes(e.toLowerCase())).length / expected.length;
}
