/* Multi-Agent Review — /repos/:repoId/multi-agent (A5, L07). Runs the selected
   PR through every enabled agent in PARALLEL (+ the built-in Lethal-Trifecta
   detector) and shows N columns / per-agent tabs + a "where agents disagree"
   conflict view. Ported from screen_multiagent.jsx.

   Deep-linkable state: ?pr=<prId>, ?view=columns|tabs, ?agent=<idx>, ?conflicts=1.
   "View trace" opens the A5 Run Trace + Live Log drawer (?trace=<runId>). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../../../components/app-shell";
import { useActiveRepo } from "../../../../../../lib/repo-context";
import { usePulls } from "../../../../../../lib/hooks";
import { useMultiAgentRun, useRunMultiAgent } from "../../../../../../lib/hooks/multiagent";
import { useAgents } from "../../../../../../lib/hooks/agents";
import type { AgentColumn } from "@devdigest/shared/contracts/observability";
import MultiAgentView from "../MultiAgentView";
import RunTraceDrawer from "../../../pulls/[number]/_components/RunTraceDrawer";
import { CONFLICTS_ON, PARAM, VIEWS } from "./constants";
import { formatCost, formatSeconds, parseAgentIndex, parseView } from "./helpers";
import { s } from "./styles";

export function MultiAgentPage() {
  const t = useTranslations("runs");
  const params = useParams<{ repoId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId } = params;
  const { activeRepo } = useActiveRepo();

  const { data: pulls } = usePulls(repoId);
  const { data: agents } = useAgents();
  const enabledCount = (agents ?? []).filter((a) => a.enabled).length;

  // ?pr selects the PR; default to the first PR with an id.
  const prFromQuery = search.get(PARAM.pr);
  const defaultPr = (pulls ?? []).find((p) => p.id)?.id ?? null;
  const prId = prFromQuery ?? defaultPr;
  const selectedPull = (pulls ?? []).find((p) => p.id === prId) ?? null;

  const view = parseView(search.get(PARAM.view));
  const agentIdx = parseAgentIndex(search.get(PARAM.agent));
  const onlyConflicts = search.get(PARAM.conflicts) === CONFLICTS_ON;
  const traceRunId = search.get(PARAM.trace);

  const { data: run, isLoading } = useMultiAgentRun(prId);
  const runMutation = useRunMultiAgent();

  const setParam = (k: string, v: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (v == null) sp.delete(k);
    else sp.set(k, v);
    router.replace(`/repos/${repoId}/multi-agent?${sp.toString()}`);
  };

  const repoName = activeRepo?.full_name ?? repoId;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("page.crumb") },
    ...(selectedPull ? [{ label: `#${selectedPull.number}`, mono: true }] : []),
  ];

  const traceColumn: AgentColumn | undefined = run?.columns.find((c) => c.run_id === traceRunId);

  if (enabledCount === 0 && !run) {
    return (
      <AppShell crumb={crumb}>
        <EmptyState
          icon="Cpu"
          title={t("page.noAgents.title")}
          body={t("page.noAgents.body")}
          cta={t("page.noAgents.cta")}
          onCta={() => router.push("/agents")}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.h1}>{t("page.title")}</h1>
        <span style={s.subtitle}>{t("page.subtitle")}</span>
        <div style={s.headerActions}>
          {/* PR picker */}
          <Dropdown
            width={280}
            align="right"
            trigger={
              <Button kind="secondary" size="sm" icon="GitPullRequest">
                {selectedPull ? `#${selectedPull.number}` : t("page.selectPr")}
              </Button>
            }
            items={(pulls ?? [])
              .filter((p) => p.id)
              .map((p) => ({
                label: t("page.prItem", { number: p.number, title: p.title }),
                onClick: () => setParam(PARAM.pr, p.id!),
              }))}
          />
          {/* View switch */}
          <div style={s.viewSwitch}>
            {VIEWS.map((k) => (
              <button key={k} onClick={() => setParam(PARAM.view, k)} style={s.viewBtn(view === k)}>
                {t(`page.view.${k}`)}
              </button>
            ))}
          </div>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            disabled={!prId || runMutation.isPending}
            onClick={() => prId && runMutation.mutate({ prId })}
          >
            {runMutation.isPending ? t("page.running") : t("page.runAll")}
          </Button>
        </div>
      </div>

      {/* Meta row */}
      {run && (
        <div style={s.metaRow}>
          {selectedPull && (
            <>
              <span className="mono" style={s.metaPr}>
                #{selectedPull.number}
              </span>
              <span style={s.metaTitle}>{selectedPull.title}</span>
            </>
          )}
          <span style={s.metaAside}>
            <Icon.Cpu size={14} style={s.metaIcon} />
            {t("page.meta", {
              count: run.agent_count,
              duration: formatSeconds(run.total_duration_ms),
              cost: formatCost(run.total_cost_usd),
            })}
          </span>
        </div>
      )}

      {/* Body */}
      {isLoading ? (
        <div style={s.loadingPad}>
          <Skeleton height={28} width={320} />
          <Skeleton height={220} />
        </div>
      ) : !run ? (
        <div style={s.emptyPad}>
          <EmptyState
            icon="Cpu"
            title={t("page.noRun.title")}
            body={prId ? t("page.noRun.bodyReady") : t("page.noRun.bodySelect")}
            {...(prId ? { cta: t("page.noRun.cta"), onCta: () => runMutation.mutate({ prId }) } : {})}
          />
        </div>
      ) : (
        <MultiAgentView
          run={run}
          view={view}
          selectedAgent={agentIdx}
          onSelectAgent={(i) => setParam(PARAM.agent, String(i))}
          onlyConflicts={onlyConflicts}
          onToggleOnlyConflicts={(v) => setParam(PARAM.conflicts, v ? CONFLICTS_ON : null)}
          onViewTrace={(col) => setParam(PARAM.trace, col.run_id)}
        />
      )}

      {/* Run trace drawer */}
      {traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          agentName={traceColumn?.agent_name ?? null}
          prNumber={run?.pr_number ?? null}
          onClose={() => setParam(PARAM.trace, null)}
        />
      )}
    </AppShell>
  );
}

export default MultiAgentPage;
