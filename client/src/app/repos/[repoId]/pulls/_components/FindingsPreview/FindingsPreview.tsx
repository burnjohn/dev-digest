/* FindingsPreview — the content of a findings hover popover (shared by the PR
   list FINDINGS column and the agent-runs timeline). One compact row per finding:
   severity + title + category, file:line + confidence, and a clamped rationale. */
"use client";

import React from "react";
import {
  Card,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { usePrReviews } from "@/lib/hooks/reviews";
import { lineLabel } from "@/app/repos/[repoId]/pulls/[number]/_components/FindingCard/helpers";
import { s } from "./styles";

export function FindingsPreview({
  findings,
  inThisRun,
}: {
  findings: FindingRecord[];
  inThisRun?: boolean;
}) {
  return (
    <Card style={s.card}>
      <div style={s.title}>
        {findings.length} FINDINGS{inThisRun ? " IN THIS RUN" : ""}
      </div>
      {findings.length === 0 ? (
        <div style={s.empty}>No findings.</div>
      ) : (
        findings.map((f) => (
          <div key={f.id} style={s.row}>
            <div style={s.rowHead}>
              <SeverityBadge severity={f.severity as Severity} compact />
              <span style={s.rowTitle}>{f.title}</span>
              <CategoryTag category={f.category as Category} />
            </div>
            <div style={s.rowMeta}>
              <MonoLink>
                {f.file}:{lineLabel(f)}
              </MonoLink>
              <ConfidenceNum value={f.confidence} />
            </div>
            <div style={s.rationale}>{f.rationale}</div>
          </div>
        ))
      )}
    </Card>
  );
}

/** List-column variant: lazily loads the PR's reviews (mounted only while the
 *  hover card is open) and flattens their findings into the preview. */
export function ListFindingsPreview({ prId }: { prId?: string | null }) {
  const { data: reviews, isLoading } = usePrReviews(prId);
  if (isLoading || !reviews) {
    return (
      <Card style={s.card}>
        <div style={s.empty}>Loading findings…</div>
      </Card>
    );
  }
  return <FindingsPreview findings={reviews.flatMap((r) => r.findings)} />;
}
