import type { CSSProperties } from "react";

/** Co-located styles for SettingsIntegrations + its IntegrationCard. */
export const s = {
  wrap: { maxWidth: 660 } satisfies CSSProperties,
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 20,
    marginBottom: 16,
  } satisfies CSSProperties,
  cardHeader: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12 } satisfies CSSProperties,
  cardIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    background: "var(--bg-surface)",
    display: "grid",
    placeItems: "center",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  cardTitleWrap: { flex: 1 } satisfies CSSProperties,
  cardTitle: { fontSize: 15, fontWeight: 600 } satisfies CSSProperties,
  cardDesc: { fontSize: 13, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  cardNote: { fontSize: 12, color: "var(--text-muted)", marginTop: 12 } satisfies CSSProperties,
} as const;
