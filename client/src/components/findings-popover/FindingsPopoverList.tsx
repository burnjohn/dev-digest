"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { liveFindings, sortForPopover } from "./helpers";

// Truncated as plain text, not `<Markdown>` — cutting markdown mid-token
// (an unterminated `**`, a half link) renders broken syntax in a small popover.
const RATIONALE_TRUNCATE = 140;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}

function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

/** Click-popover body for a PR/run's live findings — severity badge, category,
 * file:line (deep-linked to GitHub when possible), confidence, and a
 * truncated rationale snippet. Scrollable, no hard cap on findings shown. */
export function FindingsPopoverList({
  findings,
  loading,
  repoFullName,
  headSha,
}: {
  findings: FindingRecord[] | undefined;
  loading?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const sorted = sortForPopover(liveFindings(findings ?? []));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.05em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          padding: "4px 6px 8px",
        }}
      >
        {t("findingsPopover.header")}
      </div>
      <div style={{ maxHeight: 320, overflow: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {loading ? (
          <div style={{ padding: "10px 6px", fontSize: 13, color: "var(--text-muted)" }}>
            {t("findingsPopover.loading")}
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: "10px 6px", fontSize: 13, color: "var(--text-muted)" }}>
            {t("findingsPopover.empty")}
          </div>
        ) : (
          sorted.map((f) => {
            const fileHref =
              repoFullName && headSha
                ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
                : undefined;
            return (
              <div
                key={f.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "8px 6px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <SeverityBadge severity={f.severity as Severity} compact />
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {f.title}
                  </span>
                  <CategoryTag category={f.category as Category} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <MonoLink href={fileHref}>
                    {f.file}:{lineLabel(f)}
                  </MonoLink>
                  <ConfidenceNum value={f.confidence} />
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  {truncate(f.rationale, RATIONALE_TRUNCATE)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
