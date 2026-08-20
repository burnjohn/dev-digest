/* StatsTab — what this skill is attached to, and what is not measured yet.
   Only "used by" has data behind it today: nothing attributes a finding back to
   the skill that produced it, so the other three tiles are shown as untracked
   rather than filled with a number that would be invented. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Icon, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillAgents } from "../../../../../../lib/hooks/skills";
import { approxTokens } from "../../../../helpers";
import { s } from "../../../../styles";

/** The metrics the design calls for that have no source in the data model yet. */
const UNTRACKED = ["pullFrequency", "acceptRate", "findings30d"] as const;

export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: agents, isLoading } = useSkillAgents(skill.id);

  return (
    <div>
      <div style={s.tiles}>
        <div style={s.tile}>
          <div style={s.tileLabel}>{t("stats.usedBy")}</div>
          <div style={s.tileValue}>
            {isLoading ? "—" : (agents?.length ?? 0)}
            <span style={s.tileUnit}>{t("stats.agentsUnit")}</span>
          </div>
        </div>
        <div style={s.tile}>
          <div style={s.tileLabel}>{t("stats.promptCost")}</div>
          <div style={s.tileValue}>
            ~{approxTokens(skill.body)}
            <span style={s.tileUnit}>{t("stats.tokensUnit")}</span>
          </div>
          <div style={s.tileNote}>{t("stats.promptCostNote")}</div>
        </div>
        {UNTRACKED.map((key) => (
          <div key={key} style={s.tile}>
            <div style={s.tileLabel}>{t(`stats.${key}`)}</div>
            <div style={{ ...s.tileValue, color: "var(--text-muted)" }}>—</div>
            <div style={s.tileNote}>{t("stats.untracked")}</div>
          </div>
        ))}
      </div>

      <div style={s.panel}>
        <div style={s.panelTitle}>
          <Icon.Cpu size={13} />
          {t("stats.agentsPanel")}
        </div>
        {isLoading && <Skeleton height={44} />}
        {!isLoading && (agents?.length ?? 0) === 0 && (
          <p style={s.emptyNote}>{t("stats.noAgents")}</p>
        )}
        {agents?.map((agent) => (
          <div key={agent.id} style={s.agentRow}>
            <Icon.Cpu size={14} style={{ color: "var(--accent)" }} />
            <span style={s.agentName}>{agent.name}</span>
            <Button
              kind="ghost"
              size="sm"
              onClick={() => router.push(`/agents/${agent.id}?tab=skills`)}
            >
              {t("stats.open")}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
