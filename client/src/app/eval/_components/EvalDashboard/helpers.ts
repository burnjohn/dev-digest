/** Pure helpers for the Eval Dashboard. */

/** Map a 0..1 metric ratio to a whole-number percentage. */
export function toPct(value: number | null | undefined): number {
  return Math.round((value ?? 0) * 100);
}
