/* PriorPrs — the mockup's bottom accordion, "Prior PRs touching these
   files [n]" (docs/plans/06-blast-radius.md T8, REQ-15).

   A2 is binding: every row links to the INTERNAL PR page
   `/repos/{repoId}/pulls/{number}` — never github.com. `repoId` comes from
   the route (this is a client component under `[repoId]/pulls/[number]`,
   so `useParams()` always has it); `number` comes from the `BlastPriorPr`
   row itself. The link can never dangle: `prior_prs` is derived from cached
   `pr_files` joined to `pull_requests`, so every row is a PR DevDigest has
   already imported.

   Structure note (client/INSIGHTS.md 2026-08-16): the header is a plain
   <button> with NO interactive descendant — just an icon, a label and a
   count/chevron. The row links live in the body, which only exists once
   expanded, so there is never a link nested inside the button. */
"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { BlastPriorPr } from "@devdigest/shared";
import { s } from "./styles";

export function PriorPrs({
  priorPrs,
  priorPrsAvailable,
}: {
  priorPrs: BlastPriorPr[];
  priorPrsAvailable: boolean;
}) {
  const t = useTranslations("blast");
  const { repoId } = useParams<{ repoId: string }>();
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div style={s.priorPrsWrap}>
      <button
        type="button"
        style={s.priorPrsHeader}
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <Icon.History size={14} style={s.priorPrsIcon} />
        <span style={s.priorPrsTitle}>{t("priorPrs.title")}</span>
        {/* REQ-8/A2 client-side: an unavailable fact must never read as a
            measured "0" — show a label instead of the count badge. */}
        {priorPrsAvailable ? (
          <span className="tnum" style={s.priorPrsCount}>
            {priorPrs.length}
          </span>
        ) : (
          <span style={s.priorPrsUnavailable}>{t("priorPrs.unavailable")}</span>
        )}
        <Icon.ChevronDown size={14} style={s.priorPrsChevron(expanded)} />
      </button>

      {expanded && (
        <div style={s.priorPrsBody}>
          {!priorPrsAvailable ? (
            <div style={s.empty}>{t("priorPrs.unavailableBody")}</div>
          ) : priorPrs.length === 0 ? (
            <div style={s.empty}>{t("priorPrs.empty")}</div>
          ) : (
            priorPrs.map((pr) => (
              <Link key={pr.number} href={`/repos/${repoId}/pulls/${pr.number}`} style={s.priorPrRow}>
                <Icon.GitPullRequest size={13} style={s.priorPrsIcon} />
                <span className="mono" style={s.priorPrNumber}>
                  #{pr.number}
                </span>
                <span style={s.priorPrTitle}>{pr.title}</span>
                <span className="tnum" style={s.priorPrOverlap}>
                  {t("priorPrs.overlapCount", { count: pr.overlap_count })}
                </span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
