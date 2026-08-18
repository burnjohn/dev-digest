/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import { RunCostBadge } from "@/components/run-cost-badge";
import { useActiveRepo } from "@/lib/repo-context";
import { DEFAULT_STATUS_META, SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";
import { FindingsCell } from "../FindingsCell";

export function PRRow({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  // Read from context rather than prop-drilling through the page — the findings
  // popup needs owner/repo to deep-link a finding to GitHub.
  const { activeRepo } = useActiveRepo();
  const [h, setH] = React.useState(false);
  const st = STATUS_META[pr.status] ?? DEFAULT_STATUS_META;
  const { size, lines } = sizeOf(pr);
  const open = () => router.push(`/repos/${repoId}/pulls/${pr.number}`);
  return (
    /* Not a <button>: the row contains its own interactive children (the
       FINDINGS trigger and the links inside its popup), and interactive content
       inside a button is invalid HTML. Same role/tabIndex/onKeyDown shape as
       FindingsCell instead. Accessible name comes from the row's content. */
    <div
      role="button"
      tabIndex={0}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={open}
      onKeyDown={(e) => {
        // Only when the row itself holds focus: keydown bubbles, so without
        // this, Enter on the FINDINGS trigger inside would navigate away too.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          if (e.key === " ") e.preventDefault(); // Space scrolls the page otherwise
          open();
        }
      }}
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
          style={s.sizeBadgeBorder(SIZE_COLOR[size])}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {/* null score ⇒ PR has never been reviewed. Testing `pr.score` here
            rather than a precomputed boolean is what narrows it to a number. */}
        {pr.score != null ? (
          <CircularScore score={pr.score} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div style={s.findingsCell}>
        <FindingsCell pr={pr} repoFullName={activeRepo?.full_name} />
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div style={s.costCell}>
        <RunCostBadge cost={pr.cost_usd} />
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
