import type { Skill } from "@devdigest/shared";

/**
 * A skill is "untrusted" (and shows the vetting notice) when it did not come
 * from a first-party source (manual authoring or local extraction).
 */
export function isUntrusted(source: Skill["source"]): boolean {
  return source !== "manual" && source !== "extracted";
}
