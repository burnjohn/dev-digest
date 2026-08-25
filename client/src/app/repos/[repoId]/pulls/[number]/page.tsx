/* PR Detail — /repos/:repoId/pulls/:number. F2 shell extended by A2 with:
   - Findings panel (VerdictBanner + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - Basic file-by-file diff viewer in the Files tab
   Tab state lives in query (?tab). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "../../../../../components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { PrDetailHeader } from "./_components/PrDetailHeader";
import { OverviewTab } from "./_components/OverviewTab";
import { FindingsTab } from "./_components/FindingsTab";
import { DiffTab } from "./_components/DiffTab";
import RunTraceDrawer from "./_components/RunTraceDrawer";
import { usePullDetail, usePulls } from "../../../../../lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { usePrReviews, useCancelRun, usePrActiveRuns, usePrRuns, useDeleteRun } from "../../../../../lib/hooks/reviews";
import { useActiveRepo, useRepoNotFound } from "../../../../../lib/repo-context";
import { ApiError } from "../../../../../lib/api";
import { githubPrUrl } from "../../../../../lib/github-urls";
import { useTabScrollMemory } from "./_lib/use-tab-scroll-memory";
import type { FindingRecord } from "@devdigest/shared";

export default function PRDetailPage() {
  const params = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);

  const isLoading = pullsLoading || (prId != null && detailLoading);
  // REQ-35: `isSuccess`, never `isLoading` — a query that is retrying after a
  // failure is neither loading nor successful, and that failed-retry case is
  // the deterministic half of the cold-cache deep-link bug (§12 T16).
  const { data: reviews, isSuccess: reviewsLoaded, refetch: refetchReviews } = usePrReviews(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const qc = useQueryClient();
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id);
  const reviewRunning = liveRunIds.length > 0;
  const cancel = useCancelRun();
  const invalidateActiveRuns = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
  };
  // When a run settles (done OR failed) refresh the full run history too, so a
  // just-failed run shows up in "Run history" immediately — no page reload.
  const invalidateRunHistory = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
  };
  // REQ-21/REQ-25: a run that just settled can flip a Smart Diff badge's id
  // (a re-run's dedup winner) or add a fresh one — `useRunReview` already
  // invalidates on START, but only a SETTLED run has findings to show.
  const invalidateSmartDiff = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["smart-diff", prId] });
  };

  const tab = search.get("tab") ?? "overview";
  const traceRunId = search.get("trace");
  // Smart Diff mode (REQ-13) and the deep-linked finding (REQ-18/19/26) both
  // live in the URL, alongside `tab` and `trace` — no local state duplicates them.
  const order = search.get("order") === "smart" ? "smart" : null;
  const findingParam = search.get("finding");
  // Called on every render regardless of loading/error state below (hooks
  // rules), and it must be — a scroll offset can be recorded before the PR
  // finishes loading. REQ-24: restores the Files-changed scroll position
  // across a tab switch; see docs/plans/04-smart-diff.md §5.6.
  const tabScrollSentinelRef = useTabScrollMemory(tab);
  // Sets any number of params in ONE `router.replace` — REQ-17 needs `tab`
  // and `finding` to land together, or the second call reads a stale
  // `search` (built off the pre-navigation URL) and drops the first.
  const setParams = (updates: Record<string, string | null>) => {
    const sp = new URLSearchParams(search.toString());
    for (const [key, val] of Object.entries(updates)) {
      if (val == null) sp.delete(key);
      else sp.set(key, val);
    }
    router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`, {
      scroll: false,
    });
  };
  const setParam = (key: string, val: string | null) => setParams({ [key]: val });
  const setTab = (t: string) => setParam("tab", t);
  // REQ-17: a Smart Diff chip click is one navigation to both params at once.
  const openFinding = (id: string) => setParams({ tab: "findings", finding: id });
  // REQ-18/19/26: FindingsTab reports what it actually resolved `?finding=`
  // to. `null` clears the param (REQ-19). The SAME id is a no-op — writing
  // it back would re-trigger FindingsTab's resolution effect and loop
  // (§9 risk 9). A DIFFERENT id is REQ-26's key-upgrade rewrite.
  const onTargetResolved = (resolvedId: string | null) => {
    if (resolvedId == null) {
      setParam("finding", null);
    } else if (resolvedId !== findingParam) {
      setParam("finding", resolvedId);
    }
  };

  // Reviews come newest-first; each is its own run (grouped into accordions).
  const runs = reviews ?? [];
  // Not memoized: flattening a handful of runs is cheaper than the comparison,
  // and the memo it replaced listed `[reviews]` while its body read `runs` —
  // the exact mismatch exhaustive-deps exists to catch.
  const allFindings: FindingRecord[] = runs.flatMap((r) => r.findings);
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");
  const findingsCount = allFindings.length;

  const repoName = activeRepo?.full_name ?? repoId;
  // The real "owner/repo" (null until the repo is loaded) — used to build
  // github.com deep-links for the header and finding file references.
  const repoFullName = activeRepo?.full_name ?? null;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Pull Requests", href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto" }}>
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !pr) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this pull request"
          body={error instanceof ApiError ? error.message : `PR #${number} could not be loaded.`}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findingsCount}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onRunStart={() => setTab("findings")}
        onRunsStarted={() => invalidateActiveRuns()}
      />

      <div
        ref={tabScrollSentinelRef}
        style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1080, margin: "0 auto" }}
      >
        {tab === "overview" && (
          <OverviewTab
            prId={prId}
            prBody={pr.body}
            headSha={pr.head_sha}
            prCommits={pr.commits}
            repoFullName={repoFullName}
          />
        )}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            lethalTrifecta={lethalTrifecta}
            runs={runs}
            runsLoaded={reviewsLoaded}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            cancelMutation={cancel}
            onOpenTrace={(id) => setParam("trace", id)}
            onDelete={(id) => {
              if (window.confirm("Delete this run from history? (its logs are removed too)"))
                deleteRun.mutate(id);
            }}
            onRunDone={() => {
              invalidateActiveRuns();
              invalidateRunHistory();
              invalidateSmartDiff();
              refetchReviews();
            }}
            targetFindingId={findingParam}
            onTargetResolved={onTargetResolved}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            canComment={pr.status === "open"}
            diffSource={pr.diff_source}
            diffReason={pr.diff_source_reason}
            // usePullDetail has no refetchInterval, so a stale diff would sit there
            // until a hard reload — give the user the retry themselves.
            onRetry={() => refetch()}
            order={order}
            onOrderChange={(o) => setParam("order", o)}
            onOpenFinding={openFinding}
          />
        )}
      </div>

      {prId && traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={pr.number}
          findings={runs.find((r) => r.run_id === traceRunId)?.findings ?? []}
          agentName={runs.find((r) => r.run_id === traceRunId)?.agent_name ?? null}
          onClose={() => setParam("trace", null)}
        />
      )}
    </AppShell>
  );
}
