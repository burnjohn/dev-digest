import type { CSSProperties } from "react";
import type { ContextDocType } from "@/lib/types";

/** `specs` blue / `docs` green / `insights` amber — mirrors the palette
    `mockups/Context Folder 2.png` renders the type badge in. Visual treatment
    is implementer latitude (SPEC-01 § Design review, "left open"); only the
    behaviour — one badge per the nearest `specs`/`docs`/`insights` ancestor —
    is binding (AC-1). */
export const TYPE_COLOR: Record<ContextDocType, string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

export const s = {
  row: (dragging: boolean, over: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    borderRadius: 7,
    border: "1px solid " + (over ? "var(--accent)" : "var(--border)"),
    background: "var(--bg-surface)",
    opacity: dragging ? 0.45 : 1,
    transition: "border-color .12s, opacity .12s",
    // Otherwise a press-and-move over the filename starts a text selection
    // instead of the drag.
    userSelect: "none",
  }),
  grip: (dragging: boolean): CSSProperties => ({
    display: "inline-grid",
    placeItems: "center",
    width: 20,
    height: 22,
    padding: 0,
    border: "none",
    borderRadius: 5,
    background: "transparent",
    color: "var(--text-muted)",
    cursor: dragging ? "grabbing" : "grab",
    flexShrink: 0,
  }),
  name: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    minWidth: 0,
    overflow: "hidden",
  } satisfies CSSProperties,
  filename: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  dir: {
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  spacer: { flex: 1, minWidth: 8 } satisfies CSSProperties,
  typeBadge: (color: string): CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color,
    textTransform: "lowercase",
  }),
  tokenEstimate: {
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  oversized: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    borderRadius: 4,
    padding: "1px 6px",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
} as const;
