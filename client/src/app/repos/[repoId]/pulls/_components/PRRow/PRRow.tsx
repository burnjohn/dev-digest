/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore, SeverityBadge, SEV } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { RunCostBadge } from "../RunCostBadge/RunCostBadge";
import { HoverCard } from "../HoverCard/HoverCard";
import { ListFindingsPreview } from "../FindingsPreview/FindingsPreview";
import { s } from "../../styles";

export function PRRow({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed
  const fc = pr.findings_counts;
  const hasFindings = !!fc && fc.CRITICAL + fc.WARNING + fc.SUGGESTION > 0;
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
      <div style={s.findingsCell} onClick={(e) => e.stopPropagation()}>
        {hasFindings ? (
          <HoverCard
            trigger={<FindingsCounts counts={fc} repoId={repoId} number={pr.number} />}
          >
            <ListFindingsPreview prId={pr.id} />
          </HoverCard>
        ) : (
          <FindingsCounts counts={fc} repoId={repoId} number={pr.number} />
        )}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div>
        <RunCostBadge cost={pr.cost_usd} />
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}

const SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;

/** Per-severity findings tally in the list. Each level is a button that opens the
 *  PR's findings tab pre-filtered to that severity. Empty/no findings → "—". */
function FindingsCounts({
  counts,
  repoId,
  number,
}: {
  counts?: { CRITICAL: number; WARNING: number; SUGGESTION: number } | null;
  repoId: string;
  number: number;
}) {
  const router = useRouter();
  const active = counts ? SEVERITIES.filter((sev) => counts[sev] > 0) : [];
  if (active.length === 0) return <span style={s.muted}>—</span>;
  return (
    <>
      {active.map((sev) => (
        <button
          key={sev}
          type="button"
          aria-label={`${SEV[sev].label} ${counts![sev]}`}
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/repos/${repoId}/pulls/${number}?tab=findings&severity=${sev}`);
          }}
          style={s.findingsBtn}
        >
          <SeverityBadge severity={sev} count={counts![sev]} compact />
        </button>
      ))}
    </>
  );
}
