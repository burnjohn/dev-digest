/* EvalDashboardView — /evals list. One row per enabled agent (REQ-29), never a
   skill-owned row — `EvalOwnerDashboard` is a per-owner shape shared with
   skill batches (SPEC-03), so this view filters to `owner_kind === "agent"`
   defensively even though `useEvalDashboard`'s own endpoint already means to
   serve agents only.

   Mockup (docs/mockups/Eval Pipeline 2.png) is now followed for the page body
   — subtitle, `Run all agents`, per-row sparkline, and the cross-agent runs
   feed — but NOT for two things. There is no `GLOBAL` sidebar group and no
   `Onboarding Tour` (out of this route's scope), and the runs table has no
   CASE column: `EvalBatchRecord` carries no case id or name, because a batch
   is "run every case for this owner" and its case dimension is the PASS ratio
   (see RecentRunsTable.tsx). Every number below still comes off the live
   `EvalOwnerDashboard`/`Agent` payloads — nothing is seeded. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  SectionLabel,
  Skeleton,
  Sparkline,
} from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { useAgents } from "@/lib/hooks/agents";
import { useEvalDashboard, useStartEvalBatch } from "@/lib/hooks/evals";
import type { Agent, EvalOwnerDashboard } from "@devdigest/shared";
import { formatPassRatio, formatPercent } from "../../_lib/format";
import { RECENT_RUNS_LIMIT, RecentRunsTable, flattenRecentRuns } from "../RecentRunsTable";
import { sparkPointsFor } from "../../_lib/spark";
import { s } from "./styles";

function AgentRow({ row, agent, t, tSkills }: { row: EvalOwnerDashboard; agent: Agent; t: ReturnType<typeof useTranslations>; tSkills: ReturnType<typeof useTranslations> }) {
  const latest = row.latest_batch;
  const spark = sparkPointsFor(row.trend, "recall");
  return (
    <Link href={`/evals/${row.owner_id}`} style={s.row}>
      <Icon.Cpu size={18} style={{ color: "var(--accent)", flexShrink: 0 }} />
      <div style={s.rowMain}>
        <div style={s.rowTitle}>
          <span style={s.agentName}>{agent.name}</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {agent.provider}/{agent.model}
          </span>
        </div>
        <span style={s.rowMeta}>
          {latest
            ? `${tSkills("preview.version", { version: latest.owner_version })} · ${formatPassRatio(
                latest.cases_passed,
                latest.cases_total,
              )} ${t("dashboard.pass")}`
            : t("dashboard.noRuns")}
        </span>
      </div>
      {/* Decorative: the three metric columns beside it already state the
          numbers in text, and `sparkPointsFor` returns null rather than
          draw a line it cannot support. */}
      {spark && (
        <div style={s.sparkCell} aria-hidden>
          <Sparkline data={spark} />
        </div>
      )}
      {latest && (
        <div style={s.metrics}>
          <div style={s.metric}>
            <span style={s.metricLabel}>{t("dashboard.metrics.recall")}</span>
            <span className="tnum" style={s.metricValue}>
              {formatPercent(latest.recall)}
            </span>
          </div>
          <div style={s.metric}>
            <span style={s.metricLabel}>{t("dashboard.metrics.precision")}</span>
            <span className="tnum" style={s.metricValue}>
              {formatPercent(latest.precision)}
            </span>
          </div>
          <div style={s.metric}>
            <span style={s.metricLabel}>{t("dashboard.metrics.citationAccuracy")}</span>
            <span className="tnum" style={s.metricValue}>
              {formatPercent(latest.citation_accuracy)}
            </span>
          </div>
        </div>
      )}
      <Icon.ChevronRight size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
    </Link>
  );
}

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const tCommon = useTranslations("common");
  const tSkills = useTranslations("skills");
  const tAgents = useTranslations("agents");
  const router = useRouter();

  const { data: rows, isLoading: dashLoading, isError: dashError, refetch } = useEvalDashboard();
  const { data: agents, isLoading: agentsLoading, isError: agentsError } = useAgents();
  const startBatch = useStartEvalBatch();

  /* Local state, NOT `startBatch.isPending`: one `useMutation` observer tracks
     only its LATEST call, so `isPending` re-points on each iteration of the
     loop below and goes false the moment the last agent's POST settles
     (client/INSIGHTS.md 2026-08-29). This flag spans the whole sweep. */
  const [runningAll, setRunningAll] = React.useState(false);

  const isLoading = dashLoading || agentsLoading;
  const isError = dashError || agentsError;

  const agentsById = new Map((agents ?? []).map((a) => [a.id, a]));
  const agentRows = (rows ?? [])
    .filter((row) => row.owner_kind === "agent")
    .map((row) => ({ row, agent: agentsById.get(row.owner_id) }))
    .filter((x): x is { row: EvalOwnerDashboard; agent: Agent } => x.agent !== undefined);

  /* Sequential, not `Promise.all`: each POST starts a real batch of LLM calls
     server-side, so firing N at once would put every enabled agent's whole
     gold set in flight at the same moment. The mutation's own `onSuccess`
     invalidates ["evals","dashboard"], so the list refreshes itself.

     Each agent is caught INDIVIDUALLY. `POST /evals/batches` 400s for an agent
     with no eval cases, and this workspace's first row is exactly that — an
     uncaught rejection aborted the whole sweep at agent one and the other four
     never ran, which is not what a button called "run ALL agents" may do. The
     failure is still surfaced: `lib/providers.tsx`'s `MutationCache.onError`
     toasts every rejection globally, whether or not the caller catches it. */
  const runAllAgents = async () => {
    setRunningAll(true);
    try {
      for (const { row } of agentRows) {
        try {
          await startBatch.mutateAsync({ owner_kind: "agent", owner_id: row.owner_id });
        } catch {
          // Already toasted globally; keep going so one bad agent cannot
          // silently cancel the rest of the sweep.
        }
      }
    } finally {
      setRunningAll(false);
    }
  };

  const runAllLabel = runningAll ? t("dashboard.runningAllAgents") : t("dashboard.runAllAgents");
  const runAllReason = agentRows.length === 0 ? t("dashboard.noAgentsToRun") : null;

  const errorFallback = (reset: () => void) => (
    <ErrorState body={tCommon("states.error")} onRetry={reset} />
  );

  return (
    <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerMain}>
            <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
            <p style={s.subtitle}>{t("dashboard.subtitle")}</p>
          </div>
          {!isLoading && !isError && (
            <Button
              kind="primary"
              icon="Play"
              loading={runningAll}
              disabled={runAllReason !== null}
              /* The disabled reason is announced rather than hover-only, which
                 RENAMES the button — tests must match it by prefix
                 (client/INSIGHTS.md 2026-08-29). */
              aria-label={runAllReason ? `${runAllLabel} — ${runAllReason}` : undefined}
              title={runAllReason ?? undefined}
              onClick={runAllAgents}
            >
              {runAllLabel}
            </Button>
          )}
        </div>

        {isLoading && (
          <div style={s.list}>
            <Skeleton height={72} />
            <Skeleton height={72} />
            <Skeleton height={72} />
          </div>
        )}

        {!isLoading && isError && (
          <ErrorState body={tCommon("states.error")} onRetry={() => refetch()} />
        )}

        {!isLoading && !isError && agentRows.length === 0 && (
          <EmptyState
            icon="Cpu"
            title={tAgents("list.emptyTitle")}
            cta={tAgents("list.title")}
            onCta={() => router.push("/agents")}
          />
        )}

        {!isLoading && !isError && agentRows.length > 0 && (
          <>
            <ErrorBoundary fallback={errorFallback} resetKeys={[agentRows.length]}>
              <div style={s.section}>
                <SectionLabel icon="Cpu">{t("dashboard.agentsSection")}</SectionLabel>
                <div style={s.list}>
                  {agentRows.map(({ row, agent }) => (
                    <AgentRow key={row.owner_id} row={row} agent={agent} t={t} tSkills={tSkills} />
                  ))}
                </div>
              </div>
            </ErrorBoundary>

            <ErrorBoundary fallback={errorFallback} resetKeys={[agentRows.length]}>
              <div style={s.section}>
                <SectionLabel icon="History">{t("dashboard.allAgentRuns")}</SectionLabel>
                <RecentRunsTable rows={flattenRecentRuns(agentRows, RECENT_RUNS_LIMIT)} />
              </div>
            </ErrorBoundary>
          </>
        )}
      </div>
    </AppShell>
  );
}
