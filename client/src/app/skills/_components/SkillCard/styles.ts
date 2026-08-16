import type { CSSProperties } from "react";

/** Co-located styles for SkillCard. Mirrors AgentCard so the two rails match. */
export const s = {
  card: (active: boolean, enabled: boolean): CSSProperties => ({
    padding: 14,
    borderRadius: 8,
    border: "1px solid " + (active ? "var(--border-strong)" : "var(--border)"),
    background: active ? "var(--bg-hover)" : "var(--bg-elevated)",
    // Dim a globally disabled skill: it is linked but skipped at review time.
    opacity: enabled ? 1 : 0.6,
    marginBottom: 10,
  }),
  nameLink: {
    flex: 1,
    minWidth: 0,
    color: "inherit",
    textDecoration: "none",
  } satisfies CSSProperties,
  // The description repeats the link's target, so it is a convenience hit area
  // only: aria-hidden + tabIndex -1 keep it out of the tab order and off the
  // accessibility tree rather than announcing the same destination twice.
  bodyLink: { display: "block", color: "inherit", textDecoration: "none" } satisfies CSSProperties,
  unread: { fontSize: 11, color: "var(--warn)" } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  iconBox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: {
    display: "block",
    fontSize: 14,
    fontWeight: 600,
    // min-width:0 on the flex child + these three is what makes a long,
    // unbreakable identifier truncate instead of blowing out the card.
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  description: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "8px 0",
    lineHeight: 1.4,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  badgeRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
