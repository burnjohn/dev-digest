import type { CSSProperties } from "react";

/** Co-located styles for the Conventions page and its candidate cards. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 900, margin: "0 auto" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 20,
  } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repoName: { color: "var(--accent)" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4, maxWidth: 620 } satisfies CSSProperties,

  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 4px",
    marginBottom: 12,
  } satisfies CSSProperties,
  toolbarCount: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  toolbarSpacer: { flex: 1 } satisfies CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  loadingList: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,

  card: (accepted: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${accepted ? "var(--ok)" : "var(--border-strong)"}`,
    background: "var(--bg-surface)",
  }),
  headerRow: { display: "flex", alignItems: "flex-start", gap: 10 } satisfies CSSProperties,
  titleBlock: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  rule: { fontSize: 14, fontWeight: 650, color: "var(--text-primary)", fontStyle: "italic" } satisfies CSSProperties,
  editFields: { flex: 1, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,

  evidenceBox: {
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  evidencePath: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    padding: "6px 10px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  snippet: {
    margin: 0,
    padding: "10px 12px",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-primary)",
    overflowX: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,

  confidenceRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  confidenceLabel: { fontSize: 12, color: "var(--text-muted)", width: 76, flexShrink: 0 } satisfies CSSProperties,
  confidenceBar: { flex: 1 } satisfies CSSProperties,
  confidencePct: { fontSize: 12, color: "var(--text-secondary)", width: 36, textAlign: "right" } satisfies CSSProperties,

  actionsRow: { display: "flex", gap: 8 } satisfies CSSProperties,

  modalBody: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  modalBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 7,
    background: "var(--bg-hover)",
    color: "var(--text-secondary)",
    fontSize: 13,
    marginBottom: 16,
  } satisfies CSSProperties,
  modalRow: { display: "flex", gap: 16 } satisfies CSSProperties,
  modalCol: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  enabledRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 8 } satisfies CSSProperties,
} as const;
