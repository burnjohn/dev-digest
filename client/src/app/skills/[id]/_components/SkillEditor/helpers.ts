/** Average characters per token for English prose + markdown. */
const CHARS_PER_TOKEN = 4;

/**
 * Rough token count for the editor's counter.
 *
 * An ESTIMATE on purpose. The real number depends on the model's tokenizer, and
 * the server one (`@devdigest/api`'s tokenizer adapter) is not worth shipping to
 * the browser for a number whose job is to tell you "this skill is big" — the
 * exact figure is in the run trace. Do not use this for billing or truncation.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

/**
 * Line numbers for the gutter. Derived from the text rather than tracked in
 * state so it can never drift from what the textarea shows.
 */
export function lineNumbers(text: string): number[] {
  const count = text.split("\n").length;
  return Array.from({ length: count }, (_, i) => i + 1);
}

/** The filename shown in the editor's header strip, e.g. `no-then-chains.md`. */
export function skillFileName(name: string): string {
  return `${name || "untitled"}.md`;
}
