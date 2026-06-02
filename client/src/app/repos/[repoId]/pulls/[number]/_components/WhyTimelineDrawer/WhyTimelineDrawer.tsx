/* WhyTimelineDrawer — git-why drawer (A3, L04).
   Default-exported so the orchestrator can mount it in the PR-detail page,
   opened by keyboard `w` / clicking a code location (?why=file:line).

   Shows the WhyTimeline from GET /pulls/:id/why?file&line: the commit (and PR)
   that last shaped a line, plus the commit history that built it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Drawer, Badge, Skeleton } from "@devdigest/ui";
import type { WhyEvent } from "@devdigest/shared/contracts/why";
import { usePrWhy } from "../../../../../../../lib/hooks/brief";
import { DRAWER_WIDTH } from "./constants";
import { hasNoHistory, nonBlameEvents } from "./helpers";
import { s } from "./styles";

function EventRow({ ev, head }: { ev: WhyEvent; head?: boolean }) {
  const t = useTranslations("brief");
  return (
    <div style={s.eventRow}>
      <div style={s.eventRail}>
        <Icon.GitCommit size={15} style={s.eventIcon(!!head)} />
      </div>
      <div style={s.eventBody}>
        <div style={s.eventSummary}>
          {ev.summary}
          {ev.pr_number != null && (
            <Badge mono icon="GitPullRequest" color="var(--accent-text)" bg="var(--accent-bg)">
              #{ev.pr_number}
            </Badge>
          )}
          {head && (
            <Badge color="var(--accent-text)" bg="var(--accent-bg)">
              {t("why.blame")}
            </Badge>
          )}
        </div>
        <div style={s.eventMeta}>
          <span className="mono">{ev.sha.slice(0, 8)}</span>
          <span>{ev.author}</span>
          <span>{ev.date}</span>
        </div>
      </div>
    </div>
  );
}

export interface WhyTimelineDrawerProps {
  prId: string;
  /** The code location to explain; when null the drawer is closed. */
  location: { file: string; line: number } | null;
  onClose: () => void;
}

/** git-why drawer — commit/PR timeline that shaped a file:line. */
export function WhyTimelineDrawer({ prId, location, onClose }: WhyTimelineDrawerProps) {
  const t = useTranslations("brief");
  const { data, isLoading, isError, error } = usePrWhy(prId, location);
  if (!location) return null;

  return (
    <Drawer
      title={
        <span style={s.title}>
          <Icon.History size={16} style={s.titleIcon} />
          {t("why.title")}
        </span>
      }
      subtitle={
        <span className="mono">
          {location.file}:{location.line}
        </span>
      }
      width={DRAWER_WIDTH}
      onClose={onClose}
    >
      {isLoading ? (
        <div style={s.loadingStack}>
          <Skeleton height={18} width={300} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : isError || !data ? (
        <div style={s.errorState}>{(error as Error | undefined)?.message ?? t("why.noHistory")}</div>
      ) : (
        <div>
          <p style={s.summary}>{data.summary}</p>
          {data.blame && <EventRow ev={data.blame} head />}
          {nonBlameEvents(data).map((e, i) => (
            <EventRow key={`${e.sha}-${i}`} ev={e} />
          ))}
          {hasNoHistory(data) && <div style={s.emptyState}>{t("why.noCommits")}</div>}
        </div>
      )}
    </Drawer>
  );
}

export default WhyTimelineDrawer;
