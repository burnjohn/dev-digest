import type { CSSProperties } from "react";

/** Co-located styles for the Showcase Gallery (dev-only visual verification). */
export const s = {
  group: { marginBottom: 32 } satisfies CSSProperties,
  groupRow: { display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" } satisfies CSSProperties,
  gallery: { padding: 32, background: "var(--bg-primary)", color: "var(--text-primary)" } satisfies CSSProperties,
  w200: { width: 200 } satisfies CSSProperties,
  w220: { width: 220 } satisfies CSSProperties,
  w240: { width: 240 } satisfies CSSProperties,
  w280: { width: 280 } satisfies CSSProperties,
  w300: { width: 300 } satisfies CSSProperties,
  w320: { width: 320 } satisfies CSSProperties,
  w360: { width: 360 } satisfies CSSProperties,
  w420: { width: 420 } satisfies CSSProperties,
  w460: { width: 460 } satisfies CSSProperties,
  cardTitle: { fontWeight: 600 } satisfies CSSProperties,
  cardBody: { color: "var(--text-secondary)", fontSize: 14, marginTop: 5 } satisfies CSSProperties,
  skeletonStack: { width: 200, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  drawerBody: { color: "var(--text-secondary)" } satisfies CSSProperties,
  modalBody: { padding: 24 } satisfies CSSProperties,
} as const;
