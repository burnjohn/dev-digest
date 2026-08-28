/**
 * Terminal styling — one module owns the escape codes so nothing else hardcodes them.
 */

export const RED = "\x1b[31m";
export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const DIM = "\x1b[2m";
export const RESET = "\x1b[0m";

/** Wrap `text` in a color and reset. */
export const color = (c: string, text: string | number): string => `${c}${text}${RESET}`;

/** Pass-rate → color: 100% green, 0% red, anything between yellow. */
export const rateColor = (rate: number): string => (rate >= 1 ? GREEN : rate <= 0 ? RED : YELLOW);
