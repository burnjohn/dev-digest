/* helpers.ts — pure transforms for ReviewFocusCard. No I/O, no container. */

import { githubBlobUrl } from "@/lib/github-urls";

/**
 * `githubBlobUrl(repoFullName, headSha, file)` with NO line arguments — REQ-13
 * forbids a line number anywhere in the brief, and `review_focus[]` never
 * carries one on the wire (RiskBriefFocusItem). Mirrors the
 * `repoFullName && headSha ? … : undefined` guard in
 * `BlastCard.tsx:270-285` — never build a URL from a `fullName` that falls
 * back to a uuid or from a missing `headSha` (client/INSIGHTS.md 2026-08-17);
 * the caller renders plain text instead.
 */
export function reviewFocusHref(
  repoFullName: string | null | undefined,
  headSha: string | null | undefined,
  file: string,
): string | undefined {
  return repoFullName && headSha ? githubBlobUrl(repoFullName, headSha, file) : undefined;
}
