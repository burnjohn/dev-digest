import type { CSSProperties } from "react";

/** Styles for the Conventions page and its candidate cards. */
export const s = {
  page: { padding: "28px 32px", maxWidth: 1100, margin: "0 auto" } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 6,
  } satisfies CSSProperties,
  heading: { fontSize: 26, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  repoName: { color: "var(--accent)", fontWeight: 700 } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginBottom: 18,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  toolbarSpacer: { flex: 1 } satisfies CSSProperties,
  scanSummary: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 16,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,

  // ---- candidate card ----
  card: (status: string): CSSProperties => ({
    display: "flex",
    gap: 16,
    padding: 16,
    borderRadius: 10,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    // The accent stripe reads the triage state at a glance.
    borderLeft: `3px solid ${
      status === "accepted"
        ? "var(--ok)"
        : status === "rejected"
          ? "var(--border-strong)"
          : "var(--accent)"
    }`,
    opacity: status === "rejected" ? 0.55 : 1,
  }),
  cardMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  } satisfies CSSProperties,
  rule: { fontSize: 15, fontWeight: 600, fontStyle: "italic" } satisfies CSSProperties,
  rationale: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: "0 0 12px",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  evidence: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  evidenceHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  evidenceLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "var(--accent)",
    textDecoration: "none",
  } satisfies CSSProperties,
  evidenceCode: {
    margin: 0,
    padding: "12px 14px",
    fontSize: 12.5,
    lineHeight: 1.6,
    overflowX: "auto",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  confidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 12,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  confidenceBar: { width: 140 } satisfies CSSProperties,
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: 176,
    flexShrink: 0,
  } satisfies CSSProperties,
  editRow: { display: "flex", gap: 8, marginTop: 12 } satisfies CSSProperties,

  // ---- modal ----
  modalBody: { padding: "20px 24px" } satisfies CSSProperties,
  mergedBanner: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 20,
  } satisfies CSSProperties,
  bodyHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    border: "1px solid var(--border-strong)",
    borderBottom: "none",
    borderRadius: "7px 7px 0 0",
    background: "var(--bg-surface)",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  bodyFileName: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  bodyTokens: { marginLeft: "auto", color: "var(--text-muted)" } satisfies CSSProperties,
};
