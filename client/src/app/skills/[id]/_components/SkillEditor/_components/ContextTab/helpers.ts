/**
 * Pure helpers behind `ContextTab` — the literal text of the `SERIALIZES AS`
 * preview box. No React here.
 *
 * The seed row order is NOT re-implemented here — it already exists,
 * generalized for exactly this shape, in `components/context-docs/helpers.ts`
 * (`orderForDisplay`), which mirrors
 * `AgentEditor/_components/SkillsTab/helpers.ts`'s function of the same name
 * (path-keyed here instead of id-keyed there).
 */

/** Heading `assemblePrompt` actually emits (`reviewer-core/src/prompt.ts:150`,
    AC-19). Mockup 3's `## Project specifications` is the documented outlier —
    this constant is the one and only place this string is written. */
export const PROJECT_CONTEXT_HEADING = "## Project context";

/**
 * The `SERIALIZES AS` box's content (REQ-19, AC-19, AC-21): the literal block
 * heading, then a `### <path>` line per attached document inside its
 * `<untrusted>` pair — the same shape `assemblePrompt` sends, without the
 * document bodies (this is a structural preview, not a byte-identical one;
 * the run trace's `Prompt assembly` row is where the exact text lives).
 */
export function buildSerializedPreview(attachedPaths: string[]): string {
  if (attachedPaths.length === 0) return PROJECT_CONTEXT_HEADING;
  const blocks = attachedPaths.map(
    (p) => `<untrusted source="${p}">\n### ${p}\n…\n</untrusted>`,
  );
  return [PROJECT_CONTEXT_HEADING, "", blocks.join("\n\n")].join("\n");
}
