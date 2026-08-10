import type { FindingRecord } from "@devdigest/shared";

export { FindingsIndicator } from "./FindingsIndicator";

/**
 * Dedup key for the PR-list summary: collapses the same finding re-emitted
 * across multiple runs into one. MUST stay identical to the server's key
 * (`server/src/modules/pulls/routes.ts`) so the list counts and the popup agree.
 */
export function findingKey(
  f: Pick<FindingRecord, "severity" | "file" | "start_line" | "end_line" | "title">,
): string {
  return `${f.severity}|${f.file}|${f.start_line}|${f.end_line}|${f.title.trim().toLowerCase()}`;
}
