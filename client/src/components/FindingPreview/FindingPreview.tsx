/* FindingPreview — compact, read-only rendering of a single finding for the
   findings hover popovers (PR list + Agent-runs timeline). Severity badge +
   title + category, file:line, confidence, and a 2-line-clamped rationale.

   - The file:line link opens the finding's file in THIS pull request's "Files
     changed" tab (githubPrFilesUrl) when we know the PR number; otherwise it
     falls back to the standalone file blob, or renders unlinked.
   - Clicking the card body (anywhere but the file link) calls onSelect — used to
     jump to this finding in the Agent-runs review below. */
"use client";

import React from "react";
import {
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  SEV,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { Finding } from "@devdigest/shared";
import { githubBlobUrl, githubPrFilesUrl } from "@/lib/github-urls";
import { s } from "./styles";

/** "11" for a single line, else "11-15". */
function lineLabel(f: Pick<Finding, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

// Accepts the base Finding (PR list) or any superset like FindingRecord
// (timeline) — it only reads base fields.
export function FindingPreview({
  f,
  repoFullName,
  headSha,
  prNumber,
  onSelect,
}: {
  f: Finding;
  repoFullName?: string | null;
  headSha?: string | null;
  /** PR number — when set (with repoFullName), the file link opens the PR. */
  prNumber?: number | null;
  /** Clicking the card body (not the file link) selects this finding. */
  onSelect?: (findingId: string) => void;
}) {
  const sevColor = SEV[f.severity as Severity]?.c ?? "var(--text-muted)";
  // Prefer the PR's Files-changed view; fall back to the standalone file blob.
  const fileHref =
    repoFullName && prNumber != null
      ? githubPrFilesUrl(repoFullName, prNumber)
      : repoFullName && headSha
        ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
        : undefined;

  return (
    <div
      style={{ ...s.card(sevColor), cursor: onSelect ? "pointer" : "default" }}
      onClick={onSelect ? () => onSelect(f.id) : undefined}
      role={onSelect ? "button" : undefined}
    >
      <div style={s.titleRow}>
        <SeverityBadge severity={f.severity as Severity} compact />
        <span style={s.title}>{f.title}</span>
        <CategoryTag category={f.category as Category} />
      </div>
      <div style={s.metaRow}>
        <MonoLink href={fileHref}>
          {f.file}:{lineLabel(f)}
        </MonoLink>
        <ConfidenceNum value={f.confidence} />
      </div>
      {f.rationale && <div style={s.rationale}>{f.rationale}</div>}
    </div>
  );
}
