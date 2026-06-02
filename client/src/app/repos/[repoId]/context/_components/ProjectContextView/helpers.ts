import type { IndexStatus } from "@devdigest/shared";
import { BYTES_PER_KB, INDEXING_STATUSES, SPECS_PREFIX } from "./constants";

/** True when the index status reflects an in-flight reindex run. */
export function isIndexing(status?: string | null): boolean {
  return INDEXING_STATUSES.includes(status as (typeof INDEXING_STATUSES)[number]);
}

/** Strip the `.devdigest/specs/` prefix for compact display. */
export function shortSpecPath(path: string): string {
  return path.replace(SPECS_PREFIX, "");
}

/** Format a byte size as a rounded KB count (e.g. 2048 → 2). */
export function kb(size: number): number {
  return Math.round(size / BYTES_PER_KB);
}

/** Progress-bar colour: crit on error, accent otherwise. */
export function progressColor(status: IndexStatus["status"]): string {
  return status === "error" ? "var(--crit)" : "var(--accent)";
}
