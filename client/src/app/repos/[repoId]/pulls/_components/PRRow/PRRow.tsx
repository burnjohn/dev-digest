/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import { RunCostBadge } from "@/components/RunCostBadge/RunCostBadge";
import { SeverityChip } from "@/components/SeverityChip/SeverityChip";
import { usePrReviews } from "@/lib/hooks/reviews";
import { FINDINGS_FIELDS, SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";
import { FindingsPopover } from "../FindingsPopover/FindingsPopover";

export function PRRow({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const [anchorRect, setAnchorRect] = React.useState<DOMRect | null>(null);
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed
  const totalFindings =
    (pr.findings_critical ?? 0) + (pr.findings_warning ?? 0) + (pr.findings_suggestion ?? 0);

  const { data: reviewsData, isLoading: reviewsLoading } = usePrReviews(
    anchorRect && totalFindings > 0 ? pr.id : undefined,
  );
  const latestReview = reviewsData?.find((r) => r.kind === "review");

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
      <div
        style={s.findingsCell}
        onMouseEnter={(e) => {
          e.stopPropagation();
          setAnchorRect(e.currentTarget.getBoundingClientRect());
        }}
        onMouseLeave={(e) => {
          e.stopPropagation();
          setAnchorRect(null);
        }}
      >
        {!reviewed || totalFindings === 0 ? (
          <span style={s.muted}>—</span>
        ) : (
          FINDINGS_FIELDS.map(({ sev, field }) => {
            const n = pr[field] ?? 0;
            if (!n) return null;
            return <SeverityChip key={sev} sev={sev} count={n} />;
          })
        )}
        {anchorRect && totalFindings > 0 && (
          <FindingsPopover
            review={latestReview}
            isLoading={reviewsLoading}
            anchorRect={anchorRect}
          />
        )}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div style={s.costCell}>
        <RunCostBadge cost={pr.last_run_cost_usd} />
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
