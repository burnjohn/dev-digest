import type { CSSProperties } from "react";

export const s: Record<string, CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "60px 28px",
    gap: 8,
  },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    color: "var(--danger-text, var(--text-muted))",
    marginBottom: 8,
  },
  title: { fontSize: 15, fontWeight: 600, color: "var(--text-primary)" },
  body: {
    fontSize: 14,
    color: "var(--text-secondary)",
    maxWidth: 340,
    lineHeight: 1.5,
  },
  detail: {
    fontSize: 12,
    color: "var(--text-muted)",
    maxWidth: 460,
    marginTop: 4,
    // A thrown error's message is arbitrary text — let it wrap rather than
    // stretch the layout, and keep long unbroken tokens (stack frames, URLs) in.
    overflowWrap: "anywhere",
  },
  cta: { marginTop: 12 },
};
