"use client";

/* EvalsLandingView — cross-agent Eval Dashboard landing page (`/evals`).
   Fetches the agent-overview grid + cross-agent recent-batches feed, and
   exposes a "Run all agents" action. Reuses AppShell for the page chrome,
   matching every other top-level route in the app. */

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useEvalOverview, useEvalRecentAcrossAgents, useRunAllAgents } from "@/lib/hooks/eval";
import { AgentCard, type AgentCardPassInfo } from "../AgentCard/AgentCard";
import { RecentRunsFeed } from "../RecentRunsFeed/RecentRunsFeed";
import { s } from "./styles";

export function EvalsLandingView() {
  const t = useTranslations("evals");
  const { data: overview, isLoading: loadingOverview, isError: overviewError, refetch } = useEvalOverview();
  const { data: recent, isLoading: loadingRecent } = useEvalRecentAcrossAgents();
  const runAll = useRunAllAgents();

  const crumb = [{ label: t("landing.breadcrumb") }];
  const isLoading = loadingOverview || loadingRecent;

  // Per-batch pass/total for the agent cards' "N/M pass" meta line — the
  // `/evals/overview` payload carries no pass counts, but the recent-runs feed
  // does, so join them client-side by batch id (the agent's latest batch is
  // almost always within the recent feed's 25-row cap).
  const passByBatchId = React.useMemo(() => {
    const map = new Map<string, AgentCardPassInfo>();
    for (const row of recent ?? []) map.set(row.batch.id, { pass: row.pass_count, total: row.total_count });
    return map;
  }, [recent]);

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <div style={s.list}>
            <Skeleton height={72} />
            <Skeleton height={72} />
            <Skeleton height={72} />
          </div>
        </div>
      </AppShell>
    );
  }

  if (overviewError) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <ErrorState body={t("landing.loadError")} onRetry={() => refetch()} />
        </div>
      </AppShell>
    );
  }

  const agents = overview ?? [];

  if (agents.length === 0) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <EmptyState icon="FlaskConical" title={t("landing.empty.title")} body={t("landing.empty.body")} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("landing.title")}</h1>
            <p style={s.subtitle}>{t("landing.subtitle")}</p>
          </div>
          <Button kind="primary" size="sm" icon="Play" onClick={() => runAll.mutate()} disabled={runAll.isPending} loading={runAll.isPending}>
            {t("landing.runAllAgents")}
          </Button>
        </div>

        <div style={s.sectionLabel}>
          <Icon.Cpu size={13} />
          {t("landing.agentsSection")}
        </div>
        <div style={s.list}>
          {agents.map((summary) => (
            <AgentCard
              key={summary.agent_id}
              summary={summary}
              passInfo={summary.latest_batch ? passByBatchId.get(summary.latest_batch.id) ?? null : null}
            />
          ))}
        </div>

        <div style={s.feedSection}>
          <RecentRunsFeed rows={recent ?? []} />
        </div>
      </div>
    </AppShell>
  );
}
