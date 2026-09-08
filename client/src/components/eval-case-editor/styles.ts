import type { CSSProperties } from "react";

/** Co-located styles for the promoted eval-case-editor tree (`CaseList` /
 *  `CaseRow` / `CaseEditorPanel`) — a subset of the agent Evals tab's
 *  original `styles.ts`, copied here for the shared location
 *  (specs/15-skill-eval-cases.md plan §11 — the agent tab keeps its own
 *  `styles.ts` for the pieces that stayed behind: tiles, run-history table). */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowMain: { display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 } satisfies CSSProperties,
  rowTitleLine: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  rowName: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,
  rowMetaLine: { display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  outcome: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12.5,
    fontWeight: 600,
    color,
  }),
  rowActions: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  form: { display: "flex", flexDirection: "column", gap: 16, padding: "20px 24px" } satisfies CSSProperties,
  formRow: { display: "flex", gap: 12 } satisfies CSSProperties,
  formField: { display: "flex", flexDirection: "column", gap: 6, flex: 1 } satisfies CSSProperties,
  label: { fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
} as const;
