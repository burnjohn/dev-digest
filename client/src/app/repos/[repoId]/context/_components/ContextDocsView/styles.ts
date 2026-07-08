import type { CSSProperties } from "react";

export const s = {
  page: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "32px 24px 44px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 20,
  } satisfies CSSProperties,

  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  } satisfies CSSProperties,

  title: {
    fontSize: 22,
    fontWeight: 600,
    margin: 0,
    color: "var(--text-primary)",
    lineHeight: 1.3,
  } satisfies CSSProperties,

  subtitle: {
    margin: "6px 0 0",
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  // ---- two-panel master-detail (AC-22) ----
  twoPanel: {
    display: "grid",
    gridTemplateColumns: "360px 1fr",
    gap: 16,
    alignItems: "stretch",
    minHeight: 420,
  } satisfies CSSProperties,

  // ---- left panel: toolbar + filter + list ----
  leftPanel: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  } satisfies CSSProperties,

  toolbarRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  toolbarSpacer: {
    flex: 1,
  } satisfies CSSProperties,

  filterRow: {
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  listScroll: {
    flex: 1,
    overflowY: "auto" as const,
  } satisfies CSSProperties,

  listRow: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    cursor: "pointer",
    background: "transparent",
    borderLeft: "2px solid transparent",
    width: "100%",
    textAlign: "left" as const,
  } satisfies CSSProperties,

  listRowActive: {
    background: "var(--bg-hover)",
    borderLeft: "2px solid var(--accent)",
  } satisfies CSSProperties,

  listRowTop: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,

  listPath: {
    flex: 1,
    minWidth: 0,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12.5,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  listRowMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  skeletonList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
    padding: 16,
  } satisfies CSSProperties,

  // ---- right panel: detail ----
  detailPanel: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
  } satisfies CSSProperties,

  detailHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 18px",
    borderBottom: "1px solid var(--border)",
    flexWrap: "wrap" as const,
  } satisfies CSSProperties,

  detailPathCol: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  } satisfies CSSProperties,

  detailPath: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  detailMetaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  coverageWrap: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 2,
  } satisfies CSSProperties,

  coverageLabel: {
    fontSize: 10,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  modeToggle: {
    display: "inline-flex",
    borderRadius: 7,
    border: "1px solid var(--border)",
    overflow: "hidden",
  } satisfies CSSProperties,

  modeBtn: {
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  modeBtnActive: {
    background: "var(--accent)",
    color: "#fff",
  } satisfies CSSProperties,

  detailBody: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "18px 20px",
  } satisfies CSSProperties,

  detailFooter: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 18px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  detailFooterSpacer: {
    flex: 1,
  } satisfies CSSProperties,

  pathInputRow: {
    marginBottom: 12,
  } satisfies CSSProperties,

  validationMsg: {
    fontSize: 12,
    color: "var(--crit)",
    marginTop: 6,
  } satisfies CSSProperties,

  detailEmpty: {
    display: "grid",
    placeItems: "center",
    height: "100%",
    minHeight: 300,
    fontSize: 13,
    color: "var(--text-muted)",
    padding: 24,
    textAlign: "center" as const,
  } satisfies CSSProperties,

  // ---- root-folder config (unchanged from v1) ----
  foldersSection: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  } satisfies CSSProperties,

  foldersHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  foldersChipRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
    alignItems: "center",
  } satisfies CSSProperties,

  folderChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 10px",
    borderRadius: 6,
    fontSize: 12.5,
    fontWeight: 500,
    fontFamily: "var(--font-mono, monospace)",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  folderChipRemove: {
    display: "inline-flex",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  addFolderRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,

  addFolderInput: {
    width: 180,
  } satisfies CSSProperties,
} as const;

/** category badge color mapping (spec §9 presentation notes) — derived
    deterministically from `category`, never stored. */
export function categoryBadgeColor(category: string): { color: string; bg: string } {
  switch (category) {
    case "specs":
      return { color: "#60a5fa", bg: "rgba(59,130,246,0.12)" };
    case "docs":
      return { color: "var(--success)", bg: "rgba(34,197,94,0.12)" };
    case "insights":
      return { color: "var(--warn)", bg: "rgba(245,158,11,0.12)" };
    default:
      return { color: "var(--text-secondary)", bg: "var(--bg-hover)" };
  }
}
