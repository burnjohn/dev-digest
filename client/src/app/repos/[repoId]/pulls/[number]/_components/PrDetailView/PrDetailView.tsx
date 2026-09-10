/* PR Detail screen — /repos/:repoId/pulls/:number.
     - Findings panel (VerdictBanner + FindingCards)
     - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
     - File-by-file diff viewer in the Files tab
   Tab and trace state live in query (?tab, ?trace).

   Extracted from the route file so page.tsx stays a thin Server Component.
   Behaviour is unchanged from the original page — this was a structural move. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { usePullDetail, usePulls } from "@/lib/hooks";
import {
  usePrReviews,
  useCancelRun,
  usePrActiveRuns,
  usePrRuns,
  useDeleteRun,
} from "@/lib/hooks/reviews";
import { useMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { githubPrUrl } from "@/lib/github-urls";
import type { FindingRecord } from "@devdigest/shared";
import { PrDetailHeader } from "../PrDetailHeader";
import { OverviewTab } from "../OverviewTab";
import { FindingsTab } from "../FindingsTab";
import { DiffTab } from "../DiffTab";
import RunTraceDrawer from "@/components/run-trace-drawer/RunTraceDrawer";
import { s } from "./styles";

export function PrDetailView() {
  const { repoId, number } = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);

  const isLoading = pullsLoading || (prId != null && detailLoading);
  const { data: reviews, refetch: refetchReviews } = usePrReviews(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const qc = useQueryClient();
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  // AC-68 — a direct affordance to the multi-agent results surface, shown
  // only when this PR already has a multi-agent run. Navigation only; never
  // starts a run (a 404, the common case, just means "none yet").
  const { data: multiAgentRun } = useMultiAgentRun(prId);
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

  const tab = search.get("tab") ?? "overview";
  const traceRunId = search.get("trace");
  const setParam = (key: string, val: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (val == null) sp.delete(key);
    else sp.set(key, val);
    router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };
  const setTab = (t: string) => setParam("tab", t);

  // Smart Diff → Findings navigation: clicking a file's findings badge on the
  // Diff tab switches to Findings and expands/highlights that finding's card
  // there. Cross-tab (not URL state, unlike `tab`/`trace`) so a repeat click
  // on the same finding still re-triggers the scroll via the nonce, same
  // pattern as FindingsTab's own Timeline → Review-runs `target`.
  const [findingTarget, setFindingTarget] = React.useState<{ id: string; n: number } | null>(null);
  const handleSelectFinding = React.useCallback(
    (findingId: string) => {
      setTab("findings");
      setFindingTarget((prev) => ({ id: findingId, n: (prev?.n ?? 0) + 1 }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // PR Brief → Files navigation (specs/11-why-risk-brief.md AC-39, Q7): a
  // review-focus click switches to the Diff tab and opens/scrolls that file
  // (and line, when one survived) — line-for-line analogue of
  // `handleSelectFinding` above, in the same component that already holds
  // both the tab state and every other cross-tab target.
  const [focusTarget, setFocusTarget] = React.useState<{ file: string; line: number | null; n: number } | null>(
    null,
  );
  const handleFocusFile = React.useCallback(
    (file: string, line: number | null) => {
      setTab("diff");
      setFocusTarget((prev) => ({ file, line, n: (prev?.n ?? 0) + 1 }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Reviews come newest-first; each is its own run (grouped into accordions).
  const runs = reviews ?? [];
  const allFindings: FindingRecord[] = React.useMemo(
    () => runs.flatMap((r) => r.findings),
    [reviews],
  );
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");

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
        <div style={s.loadingStack}>
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
        repoId={repoId}
        tab={tab}
        runsCount={prRuns?.length ?? 0}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onRunStart={() => setTab("findings")}
        onRunsStarted={() => invalidateActiveRuns()}
        hasMultiAgentRun={!!multiAgentRun}
        onOpenMultiAgent={() => router.push(`/repos/${repoId}/multi-agent/${prId}`)}
      />

      <div style={s.body}>
        {tab === "overview" && (
          <OverviewTab
            prId={prId}
            prBody={pr.body}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            onFocusFile={handleFocusFile}
          />
        )}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            lethalTrifecta={lethalTrifecta}
            runs={runs}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            cancelMutation={cancel}
            targetFindingId={findingTarget?.id ?? null}
            targetFindingNonce={findingTarget?.n ?? 0}
            onOpenTrace={(id) => setParam("trace", id)}
            onDelete={(id) => {
              if (window.confirm("Delete this run from history? (its logs are removed too)"))
                deleteRun.mutate(id);
            }}
            onRunDone={() => {
              invalidateActiveRuns();
              invalidateRunHistory();
              refetchReviews();
            }}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            canComment={pr.status === "open"}
            findings={allFindings}
            onSelectFinding={handleSelectFinding}
            focusTarget={focusTarget}
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

export default PrDetailView;
