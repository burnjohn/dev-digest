import type { CSSProperties } from "react";

const MONO_FONT = "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

/* SKILL-ARM ONLY. The agent arm's equivalents are `actualOutputPre` /
   `actualOutputEmpty` in `../../styles.ts` and are untouched.

   The output box caps at 300 (owner call — the original 160 was too short for
   an ablation object) and scrolls inside. `empty` is also now the SAME box as
   `pre` (solid border, same padding and radius) instead of a dashed one — the
   panel used to change shape between "never run" and a run.

   The per-arm and lift-row styles went with the with/without split the panel
   no longer renders as two panels. */
export const s = {
  empty: {
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    margin: 0,
    color: "var(--text-muted)",
    fontSize: 13,
  } satisfies CSSProperties,

  pre: {
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    margin: "6px 0 0",
    color: "var(--text-primary)",
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 1.5,
    maxHeight: 300,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } satisfies CSSProperties,

  wrap: { display: "flex", flexDirection: "column" } satisfies CSSProperties,
  // The one-line summary above the output block.
  metrics: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
