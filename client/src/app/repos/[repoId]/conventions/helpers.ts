/** Pure helpers for the Conventions page. No hooks, no fetch. */

import type { ConventionCandidate } from "@devdigest/shared";
import {
  CONFIDENCE_OK,
  CONFIDENCE_WARN,
  FILTER_STATUSES,
  type ConventionFilter,
} from "./constants";

/** Candidates in the given triage state, highest confidence first. */
export function filterCandidates(
  candidates: ConventionCandidate[],
  filter: ConventionFilter,
): ConventionCandidate[] {
  const allowed = FILTER_STATUSES[filter];
  const list = allowed ? candidates.filter((c) => allowed.includes(c.status)) : candidates.slice();
  return list.sort((a, b) => b.confidence - a.confidence);
}

export function countByStatus(candidates: ConventionCandidate[]) {
  return {
    pending: candidates.filter((c) => c.status === "pending").length,
    accepted: candidates.filter((c) => c.status === "accepted").length,
    rejected: candidates.filter((c) => c.status === "rejected").length,
    all: candidates.length,
  };
}

/** Bar colour for a confidence score — same bands as the ConfidenceNum dot. */
export function confidenceColor(confidence: number): string {
  if (confidence >= CONFIDENCE_OK) return "var(--ok)";
  if (confidence >= CONFIDENCE_WARN) return "var(--warn)";
  return "var(--text-muted)";
}

/** `src/api/users.ts` + line 23 → `src/api/users.ts:23` (line is optional). */
export function evidenceLabel(path: string, line?: number | null): string {
  return line ? `${path}:${line}` : path;
}

/**
 * Deep link to the evidence on GitHub: `…/blob/<branch>/<path>#L<line>`.
 *
 * The branch — not a sha — because the extractor samples the working tree at
 * whatever the clone is synced to, and `repos` persists no scan sha. That means
 * a link can drift if the file moves after the scan; the alternative (no link
 * at all) is worse, and the snippet on the card is the authoritative evidence.
 *
 * Returns null when the repo is unknown or the path is empty, so the caller
 * renders plain text rather than a dead link.
 */
export function githubEvidenceUrl(
  fullName: string | undefined,
  branch: string | undefined,
  path: string,
  line?: number | null,
): string | null {
  if (!fullName || !path) return null;
  const ref = branch || "HEAD";
  const segments = path.split("/").map(encodeURIComponent).join("/");
  const anchor = line ? `#L${line}` : "";
  return `https://github.com/${fullName}/blob/${encodeURIComponent(ref)}/${segments}${anchor}`;
}
