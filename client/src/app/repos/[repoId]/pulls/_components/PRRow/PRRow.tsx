/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { sizeOf } from "../../helpers";
import { relativeTime } from "@/lib/format";
import { formatCost } from "@/lib/format";
import { usePrReviews } from "@/lib/hooks/reviews";
import { FindingsIndicator, findingKey } from "@/components/findings-indicator";
import { s } from "../../styles";

export function PRRow({
  pr,
  repoId,
  repoFullName,
}: {
  pr: PrMeta;
  repoId: string;
  repoFullName?: string | null;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed

  // Per-severity counts come from the list response (deduped server-side). The
  // popup's finding list is lazy: fetch reviews only once the cell is hovered,
  // then apply the SAME rule as the server (non-dismissed, deduped by findingKey)
  // so the counts and the popup always agree.
  const fbs = pr.findings_by_severity;
  const counts = {
    CRITICAL: fbs?.critical ?? 0,
    WARNING: fbs?.warning ?? 0,
    SUGGESTION: fbs?.suggestion ?? 0,
  };
  const hasFindings = counts.CRITICAL + counts.WARNING + counts.SUGGESTION > 0;

  const [hovered, setHovered] = React.useState(false);
  const { data: reviews, isLoading } = usePrReviews(hovered ? (pr.id ?? null) : null);
  const seen = new Set<string>();
  const findings = (reviews ?? [])
    .flatMap((r) => r.findings)
    .filter((f) => !f.dismissed_at)
    .filter((f) => {
      const k = findingKey(f);
      return seen.has(k) ? false : (seen.add(k), true);
    });
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>{pr.title}</div>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div style={s.findingsCell} onMouseEnter={() => setHovered(true)}>
        {hasFindings ? (
          <FindingsIndicator
            variant="pr"
            counts={counts}
            findings={findings}
            loading={isLoading}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
          />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div style={s.costCell}>
        {pr.cost_usd != null ? (
          formatCost(pr.cost_usd)
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
