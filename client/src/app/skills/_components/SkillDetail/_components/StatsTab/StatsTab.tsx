/* StatsTab — usage aggregates. Every tile here is either a plain fact
   (USED BY) or association, never attribution (PULL FREQUENCY, ACCEPT RATE,
   FINDINGS): no column records which skill (if any) caused a given finding,
   so a skill sitting in the prompt beside others gets credit for their
   findings too. See specs/02-skill-detail-tabs.md. */
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CircularScore, EmptyState, ErrorState, Icon, MetricCard, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useAgents } from "../../../../../../lib/hooks/agents";
import { useSkillAgentIds, useSkillStats } from "../../../../../../lib/hooks/skills";
import { EMPTY } from "../../../../../../lib/format";
import { toPercent } from "../../../SkillsListView/helpers";
import { CategoryDonut } from "./CategoryDonut";
import { s } from "./styles";

export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skill.id);
  const { data: agentIds } = useSkillAgentIds(skill.id);
  const { data: allAgents } = useAgents();

  if (isLoading) {
    return (
      <div style={s.tiles}>
        <Skeleton height={90} />
        <Skeleton height={90} />
        <Skeleton height={90} />
        <Skeleton height={90} />
      </div>
    );
  }
  if (isError || !stats) {
    return <ErrorState body={t("statsTab.loadError")} onRetry={() => refetch()} />;
  }

  const agents = (agentIds?.agent_ids ?? [])
    .map((id) => allAgents?.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => !!a);

  return (
    <div>
      <div style={s.tiles}>
        <MetricCard
          label={t("statsTab.usedBy")}
          value={stats.used_by_agents}
          suffix={` ${t("statsTab.usedBySuffix", { count: stats.used_by_agents })}`}
        />
        <MetricCard
          label={t("statsTab.pullFrequency")}
          value={stats.pull_rate != null ? toPercent(stats.pull_rate) : EMPTY}
          suffix={stats.pull_rate != null ? "%" : undefined}
        />
        <div style={s.tile} title={t("statsTab.acceptRateHint")}>
          <span style={s.tileLabel}>{t("statsTab.acceptRate")}</span>
          <div style={s.tileRingRow}>
            {stats.accept_rate != null ? (
              <CircularScore score={toPercent(stats.accept_rate)} size={48} />
            ) : (
              <span style={s.tileEmpty}>{EMPTY}</span>
            )}
          </div>
        </div>
        <MetricCard label={t("statsTab.findings", { days: stats.window_days })} value={stats.findings_total} />
      </div>

      <div style={s.sections}>
        <div style={s.section}>
          <div style={s.sectionTitle}>{t("statsTab.agentsUsingTitle")}</div>
          {agents.length === 0 ? (
            <EmptyState icon="Cpu" title={t("preview.usedBy", { count: 0 })} />
          ) : (
            agents.map((agent) => (
              <div key={agent.id} style={s.agentRow}>
                <Icon.Cpu size={13} style={{ color: "var(--text-muted)" }} />
                <span className="mono" style={s.agentName}>
                  {agent.name}
                </span>
                <Link href={`/agents/${agent.id}?tab=config`}>{t("statsTab.openAgent")}</Link>
              </div>
            ))
          )}
        </div>

        <div style={s.section}>
          <div style={s.sectionTitle}>{t("statsTab.categoryTitle")}</div>
          {stats.findings_by_category.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {t("statsTab.categoryEmpty")}
            </p>
          ) : (
            <CategoryDonut tally={stats.findings_by_category} />
          )}
        </div>
      </div>
    </div>
  );
}
