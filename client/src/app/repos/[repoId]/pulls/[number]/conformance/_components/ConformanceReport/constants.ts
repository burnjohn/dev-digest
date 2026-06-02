import type { ConformanceItem } from "@devdigest/shared";

/** Conformance item status values surfaced as the three columns. */
export const STATUS_IMPLEMENTED = "implemented";
export const STATUS_MISSING = "missing";
export const STATUS_OUT_OF_SCOPE = "out_of_scope";

/** Column colours (literal hex, mirrors the source palette). */
export const COLUMN_COLORS = {
  implemented: "#10b981",
  missing: "#f59e0b",
  scopeCreep: "#999999",
} as const;

/** Column icon names. */
export const COLUMN_ICONS = {
  implemented: "CheckCircle",
  missing: "AlertTriangle",
  scopeCreep: "Plus",
} as const satisfies Record<string, "CheckCircle" | "AlertTriangle" | "Plus">;

export type ConfStatus = ConformanceItem["status"];
