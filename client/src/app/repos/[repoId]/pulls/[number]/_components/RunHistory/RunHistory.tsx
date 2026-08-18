"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, CircularScore, SeverityBadge, type IconName } from "@devdigest/ui";
import type { RunSummary, PrCommit, FindingRecord } from "@devdigest/shared";
import { RunCostBadge } from "@/components/run-cost-badge";
import { FindingsHoverCard } from "@/components/findings-hover-card";

/**
 * PR timeline — every agent run interleaved with the PR's commits, newest-first
 * and DB-backed so it survives reload. Showing commits between runs makes it
 * clear which commit each review ran against. Failed runs show their error
 * inline; clicking a run row opens its trace.
 *
 * The badge reflects the review OUTCOME, not just the run lifecycle: a finished
 * run that found blockers reads "rejected" (red), never a green "done". Outcome
 * is derived from the denormalized blocker/finding counts on the run row, so it
 * matches the CI gate (deterministic) rather than the model's verdict.
 */

type Outcome = { key: string; color: string; bg: string; icon: IconName };

function outcomeOf(run: RunSummary): Outcome {
  const status = run.status ?? "";
  if (status === "running")
    return { key: "running", color: "var(--accent)", bg: "var(--accent-bg)", icon: "RefreshCw" };
  if (status === "failed")
    return { key: "error", color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" };
  if (status === "cancelled")
    return { key: "cancelled", color: "var(--text-muted)", bg: "var(--bg-hover)", icon: "X" };
  // Settled ("done"): color by the deterministic outcome.
  if ((run.blockers ?? 0) > 0)
    return { key: "rejected", color: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" };
  if ((run.findings_count ?? 0) > 0)
    return { key: "reviewed", color: "var(--warn)", bg: "var(--warn-bg)", icon: "MessageSquare" };
  return { key: "approved", color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" };
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  textAlign: "left",
};

const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 4,
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--bg-surface)",
  color: "var(--text-muted)",
  cursor: "pointer",
  flexShrink: 0,
};

// The delete affordance is a real <button> (it sits in a plain row, so nothing
// interactive encloses it); the resets keep it looking like the bare icon it
// was as a <span>.
const deleteBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  padding: 3,
  borderRadius: 5,
  border: 0,
  background: "none",
  font: "inherit",
  color: "var(--text-muted)",
  flexShrink: 0,
  cursor: "pointer",
};

// Commits are markers, not actions — lighter (dashed, transparent) so they read
// as separators between the runs they sit chronologically between.
const commitRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px dashed var(--border)",
  background: "transparent",
};

type TimelineItem =
  | { kind: "run"; ts: number; run: RunSummary }
  | { kind: "commit"; ts: number; commit: PrCommit };

/** Epoch ms for sorting; unparseable / missing timestamps sort last. */
function tsOf(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Date.parse(s);
  return Number.isNaN(n) ? 0 : n;
}

/** Hover open/close delay (ms) — long enough to survive a mouse pass-through,
 *  short enough to feel responsive. */
const HOVER_DELAY_MS = 150;

/**
 * The per-severity chip row for a settled run. When that run's full findings
 * are available (threaded down from the already-loaded review data — no
 * extra fetch), hovering or focusing the row previews all of them, combined
 * across severities, in a `FindingsHoverCard`.
 */
function SeverityFindings({
  run,
  findings,
  repoFullName,
  headSha,
  onGoToReview,
  blockersLabel,
}: {
  run: RunSummary;
  findings: FindingRecord[] | undefined;
  repoFullName?: string | null;
  headSha?: string | null;
  onGoToReview?: (runId: string) => void;
  blockersLabel: string | null;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // One narrowed binding for both the count and the card: `hasFindings` is a
  // boolean the compiler cannot carry back to `findings`, which is what the
  // non-null assertions below used to bridge.
  const list = findings ?? [];
  const hasFindings = list.length > 0;

  const show = () => {
    if (!hasFindings) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  };
  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
  };
  React.useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <div
      style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}
      {...(hasFindings
        ? {
            tabIndex: 0,
            role: "button",
            "aria-expanded": open,
            "aria-label": t("timeline.findingsHoverTitle", { count: list.length }),
            onMouseEnter: show,
            onMouseLeave: hide,
            onFocus: show,
            onBlur: hide,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Escape") hide();
            },
          }
        : {})}
    >
      {(["CRITICAL", "WARNING", "SUGGESTION"] as const).map((sev) => {
        const n = sev === "CRITICAL" ? run.critical_count : sev === "WARNING" ? run.warning_count : run.suggestion_count;
        return n ? <SeverityBadge key={sev} severity={sev} count={n} compact /> : null;
      })}
      {blockersLabel && <span>{blockersLabel}</span>}
      {hasFindings && open && (
        <FindingsHoverCard
          findings={list}
          repoFullName={repoFullName}
          headSha={headSha}
          onSelect={() => {
            onGoToReview?.(run.run_id);
            hide();
          }}
        />
      )}
    </div>
  );
}

export function RunHistory({
  runs,
  commits = [],
  findingsByRun,
  repoFullName,
  headSha,
  onOpenTrace,
  onGoToReview,
  onDelete,
}: {
  runs: RunSummary[];
  commits?: PrCommit[];
  /** run_id → that run's full findings, already loaded via the reviews query
   *  (no per-hover fetch). Omitted / no entry → the chips render without the
   *  hover preview. */
  findingsByRun?: Map<string, FindingRecord[]>;
  /** owner/repo + head sha — used to deep-link a previewed finding to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
  /** Open the trace + log drawer for a run (the logs icon). */
  onOpenTrace: (runId: string) => void;
  /** Jump to this run's inline review accordion below (clicking the agent name). */
  onGoToReview?: (runId: string) => void;
  onDelete?: (runId: string) => void;
}) {
  const t = useTranslations("prReview");
  if (runs.length === 0 && commits.length === 0) return null;

  const items: TimelineItem[] = [
    ...runs.map((run) => ({ kind: "run" as const, ts: tsOf(run.ran_at), run })),
    ...commits.map((commit) => ({
      kind: "commit" as const,
      ts: tsOf(commit.committed_at),
      commit,
    })),
  ].sort((a, b) => b.ts - a.ts);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item) => {
        if (item.kind === "commit") {
          const c = item.commit;
          return (
            <div key={`commit:${c.sha}`} style={commitRowStyle}>
              <Icon.GitCommit size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 }}>
                {c.sha.slice(0, 7)}
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  color: "var(--text-secondary)",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={c.message}
              >
                {c.message.split("\n")[0]}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{c.author}</span>
              {c.committed_at && (
                <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
                  {new Date(c.committed_at).toLocaleTimeString()}
                </span>
              )}
            </div>
          );
        }

        const r = item.run;
        const o = outcomeOf(r);
        const settled = r.status === "done";
        return (
          <div key={`run:${r.run_id}`} style={rowStyle}>
            <Badge color={o.color} bg={o.bg} icon={o.icon}>
              {t(`runStatus.${o.key}`)}
            </Badge>
            {settled && r.score != null && <CircularScore score={r.score} size={30} stroke={3} />}
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                <button
                  type="button"
                  onClick={() => onGoToReview?.(r.run_id)}
                  title={t("timeline.goToReview")}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    font: "inherit",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    cursor: onGoToReview ? "pointer" : "default",
                    textDecoration: onGoToReview ? "underline" : "none",
                    textDecorationStyle: "dotted",
                    textUnderlineOffset: 3,
                  }}
                >
                  {r.agent_name ?? "Agent"}
                </button>{" "}
                <span className="mono" style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>
                  {r.provider}/{r.model}
                </span>
              </div>
              {r.status === "failed" && r.error && (
                <div
                  style={{ fontSize: 12, color: "var(--crit)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={r.error}
                >
                  {r.error}
                </div>
              )}
              {settled && (
                <SeverityFindings
                  run={r}
                  findings={findingsByRun?.get(r.run_id)}
                  repoFullName={repoFullName}
                  headSha={headSha}
                  onGoToReview={onGoToReview}
                  blockersLabel={(r.blockers ?? 0) > 0 ? t("runStatus.blockers", { count: r.blockers ?? 0 }) : null}
                />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
              {r.ran_at && <span>{new Date(r.ran_at).toLocaleTimeString()}</span>}
              {settled && (
                <RunCostBadge
                  variant="withTokens"
                  tokens={(r.tokens_in ?? 0) + (r.tokens_out ?? 0)}
                  cost={r.cost_usd}
                />
              )}
            </div>
            <button
              type="button"
              title={t("timeline.openTrace")}
              aria-label={t("timeline.openTrace")}
              onClick={() => onOpenTrace(r.run_id)}
              style={iconBtnStyle}
            >
              <Icon.FileText size={13} />
            </button>
            {onDelete && r.status !== "running" && (
              <button
                type="button"
                aria-label={t("timeline.deleteRun")}
                title={t("timeline.deleteRun")}
                onClick={() => onDelete(r.run_id)}
                style={deleteBtnStyle}
              >
                <Icon.Trash size={13} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
