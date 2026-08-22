"use client";

import React, { useCallback } from "react";
import { Icon, Badge, Button, SectionLabel, EmptyState } from "@devdigest/ui";
import { RunStatus } from "../RunStatus";
import { RunHistory } from "../RunHistory/RunHistory";
import { ReviewRunAccordion } from "../ReviewRunAccordion";
import { TargetFindingContext } from "../target-finding-context";
import { findingKey } from "@/components/findings-indicator";
import { s } from "./styles";
import type { FindingRecord, ReviewRecord, RunSummary, PrCommit } from "@devdigest/shared";
import type { UseMutationResult } from "@tanstack/react-query";

interface FindingsTabProps {
  prId: string | null;
  liveRunIds: string[];
  reviewRunning: boolean;
  lethalTrifecta: FindingRecord[];
  runs: ReviewRecord[];
  prRuns: RunSummary[] | undefined;
  prCommits: PrCommit[];
  cancelMutation: UseMutationResult<any, any, string, any>;
  /** owner/repo + head sha — used to deep-link a finding's file:line to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
  onOpenTrace: (id: string) => void;
  onDelete: (id: string) => void;
  onRunDone: () => void;
  /**
   * REQ-18/26: a finding id to land on — e.g. from a Smart Diff chip's
   * `?tab=findings&finding=<id>` navigation. Optional so this task typechecks
   * ahead of T9, which reads it off the URL and wires it in.
   */
  targetFindingId?: string | null;
  /**
   * Reports what this task actually resolved `targetFindingId` to: the SAME
   * id when it was already current, a DIFFERENT id when REQ-26's key-upgrade
   * fired, or `null` when unresolvable (REQ-19). T9 owns the URL from here —
   * this component never rewrites or clears the `finding` param itself.
   */
  onTargetResolved?: (resolvedId: string | null) => void;
}

/** One finding plus the review that owns it — resolution needs both. */
interface OwnedFinding {
  finding: FindingRecord;
  review: ReviewRecord;
}

function allFindingsWithReview(runs: ReviewRecord[]): OwnedFinding[] {
  const out: OwnedFinding[] = [];
  for (const review of runs) {
    for (const finding of review.findings) out.push({ finding, review });
  }
  return out;
}

/**
 * REQ-26's two-step resolution (§5.7): step 1 finds the exact id; step 2
 * re-resolves through `findingKey` to the NEWEST NON-DISMISSED finding
 * sharing that key — the same winner the server's dedup already picked for
 * the Smart Diff badge, so the two sides agree by construction. "Newest" is
 * the OWNING REVIEW's `created_at`, never the finding's own — using a
 * different clock would make the two sides disagree (T8 red flags).
 * Returns `null` when unresolvable: no id match at all (REQ-19), or every
 * finding sharing the key is dismissed (REQ-25).
 */
function resolveTargetFinding(runs: ReviewRecord[], targetId: string): OwnedFinding | null {
  const all = allFindingsWithReview(runs);
  const exact = all.find((o) => o.finding.id === targetId);
  if (!exact) return null;

  const key = findingKey(exact.finding);
  const candidates = all.filter((o) => !o.finding.dismissed_at && findingKey(o.finding) === key);
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const byReviewDate = b.review.created_at.localeCompare(a.review.created_at);
    return byReviewDate !== 0 ? byReviewDate : a.finding.id.localeCompare(b.finding.id);
  });
  return candidates[0]!;
}

export function FindingsTab({
  prId,
  liveRunIds,
  reviewRunning,
  lethalTrifecta,
  runs,
  prRuns,
  prCommits,
  cancelMutation,
  repoFullName,
  headSha,
  onOpenTrace,
  onDelete,
  onRunDone,
  targetFindingId = null,
  onTargetResolved,
}: FindingsTabProps) {
  const handleCancelAll = useCallback(() => {
    liveRunIds.forEach((id) => cancelMutation.mutate(id));
  }, [liveRunIds, cancelMutation]);

  const handleOpenFirstTrace = useCallback(() => {
    if (liveRunIds[0]) onOpenTrace(liveRunIds[0]);
  }, [liveRunIds, onOpenTrace]);

  const handleOpenTrace = useCallback(
    (id: string) => {
      onOpenTrace(id);
    },
    [onOpenTrace],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
    },
    [onDelete],
  );

  // Timeline → Review-runs navigation: clicking an agent name in the timeline
  // opens + scrolls to that run's accordion below. The nonce re-triggers the
  // scroll even when the same run is clicked twice. `scrollOnTarget` tells
  // ReviewRunAccordion whether IT owns the scroll (Timeline jump — true) or
  // whether a FindingCard inside it owns the scroll instead (a finding deep
  // link resolving into this run — false, T15/REQ-34: two competing smooth
  // scrolls race and the accordion's `block:"start"` was winning, landing the
  // viewport on the run's first finding instead of the highlighted one).
  const [target, setTarget] = React.useState<{ runId: string; n: number; scrollOnTarget: boolean } | null>(
    null,
  );
  const handleGoToReview = useCallback((runId: string) => {
    setTarget((p) => ({ runId, n: (p?.n ?? 0) + 1, scrollOnTarget: true }));
  }, []);

  // REQ-18/19/25/26 — resolve ?finding=<id> defensively (§5.7). Held per
  // (targetFindingId, runs) rather than re-derived on every render: client
  // insight 2026-08-16, "row order that outlives a state change must be
  // client-held" — the nonce only bumps when the RESOLVED outcome actually
  // changes, so an unrelated re-render never re-triggers the scroll/highlight.
  const [targetFinding, setTargetFinding] = React.useState<{ id: string; n: number } | null>(null);
  const onTargetResolvedRef = React.useRef(onTargetResolved);
  onTargetResolvedRef.current = onTargetResolved;

  React.useEffect(() => {
    if (!targetFindingId) return;
    const resolved = resolveTargetFinding(runs, targetFindingId);

    if (!resolved) {
      // REQ-19: degrade quietly — newest run open, no crash, no toast. There
      // is no target FindingCard in this branch, so the accordion keeps
      // owning its own scroll (scrollOnTarget: true) — nothing else will land
      // the viewport anywhere.
      const newestRunId = runs[0]?.run_id;
      if (newestRunId) {
        setTarget((p) =>
          p?.runId === newestRunId && p.scrollOnTarget === true
            ? p
            : { runId: newestRunId, n: (p?.n ?? 0) + 1, scrollOnTarget: true },
        );
      }
      setTargetFinding((p) => (p === null ? p : null));
      onTargetResolvedRef.current?.(null);
      return;
    }

    if (resolved.review.run_id) {
      const runId = resolved.review.run_id;
      // REQ-34: a finding deep link resolved — the target FindingCard owns
      // the scroll, so the accordion must not also scroll (that is the race
      // that parks the viewport on the run header instead of the card).
      setTarget((p) =>
        p?.runId === runId && p.scrollOnTarget === false
          ? p
          : { runId, n: (p?.n ?? 0) + 1, scrollOnTarget: false },
      );
    }
    setTargetFinding((p) => (p?.id === resolved.finding.id ? p : { id: resolved.finding.id, n: (p?.n ?? 0) + 1 }));
    onTargetResolvedRef.current?.(resolved.finding.id);
  }, [targetFindingId, runs]);

  // Per-run findings for the timeline severity indicators. Keyed by run_id
  // (ReviewRecord.run_id === RunSummary.run_id), non-dismissed. The timeline
  // shows each run's findings verbatim — no cross-run dedup (that's PR-list only).
  const findingsByRun = React.useMemo(() => {
    const m = new Map<string, FindingRecord[]>();
    for (const r of runs) {
      if (r.run_id) m.set(r.run_id, r.findings.filter((f) => !f.dismissed_at));
    }
    return m;
  }, [runs]);

  return (
    <section>
      {liveRunIds.length > 0 && (
        <div style={s.liveRunSection}>
          <SectionLabel
            icon="Sparkles"
            right={
              <div style={s.cancelActions}>
                <Button
                  kind="danger"
                  size="sm"
                  icon="X"
                  loading={cancelMutation.isPending}
                  onClick={handleCancelAll}
                >
                  Cancel
                </Button>
                <Button kind="ghost" size="sm" icon="FileText" onClick={handleOpenFirstTrace}>
                  Open run trace
                </Button>
              </div>
            }
          >
            Live review
          </SectionLabel>
          <RunStatus runIds={liveRunIds} onDone={onRunDone} />
        </div>
      )}

      {reviewRunning && (
        <div style={s.reviewInProgress}>
          <Icon.RefreshCw size={16} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span style={s.reviewInProgressText}>Review in progress…</span>
          <span style={s.reviewInProgressSub}>
            the agent is analyzing the diff — this can take a while on large PRs.
          </span>
        </div>
      )}

      {lethalTrifecta.length > 0 && (
        <div style={s.lethalTrifecta}>
          <Icon.Shield size={16} style={{ color: "var(--crit)" }} />
          <span style={s.lethalTrifectaTitle}>Lethal Trifecta detected</span>
          <Badge color="var(--crit)" bg="transparent">
            {lethalTrifecta.length} finding(s)
          </Badge>
        </div>
      )}

      {((prRuns && prRuns.length > 0) || prCommits.length > 0) && (
        <div style={s.timelineSection}>
          <SectionLabel
            icon="Activity"
            right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>runs &amp; commits · newest first</span>}
          >
            Timeline
          </SectionLabel>
          <RunHistory
            runs={prRuns ?? []}
            commits={prCommits}
            findingsByRun={findingsByRun}
            repoFullName={repoFullName}
            headSha={headSha}
            onOpenTrace={handleOpenTrace}
            onGoToReview={handleGoToReview}
            onDelete={handleDelete}
          />
        </div>
      )}

      <SectionLabel
        icon="AlertOctagon"
        right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>grouped by run · newest first</span>}
      >
        Review runs
      </SectionLabel>
      {runs.length === 0 ? (
        reviewRunning || liveRunIds.length > 0 ? null : (
          <EmptyState
            icon="Sparkles"
            title="No findings yet"
            body="Run a review to generate findings. Use Run Review ▾ above (run all enabled agents or a specific one)."
          />
        )
      ) : (
        prId && (
          // The Provider crosses ReviewRunAccordion transparently: only the
          // one FindingsPanel whose own findings contains this id reacts.
          <TargetFindingContext.Provider value={targetFinding}>
            {runs.map((review, i) => (
              <ReviewRunAccordion
                key={review.id}
                review={review}
                prId={prId}
                defaultOpen={i === 0}
                repoFullName={repoFullName}
                headSha={headSha}
                targetRunId={target?.runId ?? null}
                targetNonce={target?.n ?? 0}
                scrollOnTarget={target?.scrollOnTarget ?? true}
              />
            ))}
          </TargetFindingContext.Provider>
        )
      )}
    </section>
  );
}
