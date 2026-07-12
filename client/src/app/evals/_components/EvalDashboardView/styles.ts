import type React from "react";

/** Co-located styles for EvalDashboardView + CompareModal. */
export const s = {
  // ---- page shell ----
  page: {
    maxWidth: 1000,
    padding: "32px 24px",
  } satisfies React.CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    marginBottom: 8,
  } satisfies React.CSSProperties,

  h1: {
    margin: 0,
    fontSize: 20,
    fontWeight: 700,
  } satisfies React.CSSProperties,

  runAllBtn: {
    marginLeft: "auto",
  } satisfies React.CSSProperties,

  hint: {
    color: "var(--text-muted)",
    fontSize: 13,
    margin: "0 0 28px",
  } satisfies React.CSSProperties,

  // ---- agent card ----
  cardList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
  } satisfies React.CSSProperties,

  card: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies React.CSSProperties,

  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 18px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies React.CSSProperties,

  agentName: {
    fontSize: 14,
    fontWeight: 650,
    flex: 1,
    minWidth: 0,
  } satisfies React.CSSProperties,

  // ---- metric trio ----
  metricRow: {
    display: "flex",
    gap: 0,
    padding: "14px 18px",
    borderBottom: "1px solid var(--border)",
  } satisfies React.CSSProperties,

  metric: {
    flex: 1,
    textAlign: "center" as const,
  } satisfies React.CSSProperties,

  metricLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    marginBottom: 4,
  } satisfies React.CSSProperties,

  metricValue: {
    fontSize: 22,
    fontWeight: 700,
  } satisfies React.CSSProperties,

  metricDelta: (positive: boolean, zero: boolean) =>
    ({
      display: "inline-flex",
      alignItems: "center",
      gap: 2,
      fontSize: 11,
      fontWeight: 600,
      color: zero
        ? "var(--text-muted)"
        : positive
          ? "var(--ok)"
          : "var(--crit)",
    }) satisfies React.CSSProperties,

  // ---- recent runs table ----
  runsSection: {
    padding: "12px 18px",
  } satisfies React.CSSProperties,

  runsSectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between" as const,
  } satisfies React.CSSProperties,

  runsTable: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 12,
  } satisfies React.CSSProperties,

  th: {
    textAlign: "left" as const,
    padding: "4px 8px",
    color: "var(--text-muted)",
    fontWeight: 600,
    borderBottom: "1px solid var(--border)",
  } satisfies React.CSSProperties,

  td: {
    padding: "5px 8px",
    borderBottom: "1px solid var(--border-subtle, rgba(0,0,0,.06))",
    verticalAlign: "middle" as const,
  } satisfies React.CSSProperties,

  // ---- pass/fail badge (not color-only — a11y) ----
  passBadge: (pass: boolean | null) =>
    ({
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
      fontSize: 11,
      fontWeight: 600,
      color:
        pass === null
          ? "var(--text-muted)"
          : pass
            ? "var(--ok)"
            : "var(--crit)",
      background:
        pass === null
          ? "transparent"
          : pass
            ? "var(--ok-bg, #e8f7ee)"
            : "var(--crit-bg, #fde8e8)",
      borderRadius: 4,
      padding: "1px 6px",
    }) satisfies React.CSSProperties,

  // ---- Compare modal ----
  compareGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    marginBottom: 16,
  } satisfies React.CSSProperties,

  compareLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: 6,
  } satisfies React.CSSProperties,

  comparePre: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "10px 12px",
    fontSize: 12,
    fontFamily: "monospace",
    overflow: "auto",
    maxHeight: 260,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    margin: 0,
    outline: "none",
  } satisfies React.CSSProperties,

  deltaTable: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
    marginBottom: 16,
  } satisfies React.CSSProperties,

  deltaRow: {
    borderBottom: "1px solid var(--border)",
  } satisfies React.CSSProperties,

  deltaCell: {
    padding: "7px 10px",
  } satisfies React.CSSProperties,

  modalFooter: {
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
  } satisfies React.CSSProperties,

  runGroupSelect: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies React.CSSProperties,

  selectRow: {
    display: "flex",
    gap: 12,
    alignItems: "flex-end",
    marginBottom: 16,
  } satisfies React.CSSProperties,

  selectGroup: {
    flex: 1,
  } satisfies React.CSSProperties,

  selectLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: 4,
  } satisfies React.CSSProperties,

  diffSection: {
    marginBottom: 16,
  } satisfies React.CSSProperties,

  diffLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: 6,
  } satisfies React.CSSProperties,

  emptyRuns: {
    color: "var(--text-muted)",
    fontSize: 13,
    padding: "10px 0",
    fontStyle: "italic",
  } satisfies React.CSSProperties,

  // ---- version unavailable state ----
  versionUnavailable: {
    color: "var(--text-muted)",
    fontStyle: "italic",
    fontSize: 12,
  } satisfies React.CSSProperties,
};
