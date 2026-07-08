/* AgentCard — model chip, skills count, enabled toggle, and a usage-stats
   footer (runs · accept% · avg cost) fed by GET /agents/stats. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Agent, AgentCardStats } from "@devdigest/shared";
import { useDeleteAgent } from "../../../../lib/hooks/agents";
import { ConfirmModal } from "@/components/confirm-modal";
import { modelColor, acceptColor, formatCost } from "./helpers";
import { s } from "./styles";

export function AgentCard({
  ag,
  active,
  skillCount,
  stats,
  onClick,
  onToggle,
}: {
  ag: Agent;
  active?: boolean;
  skillCount?: number;
  stats?: AgentCardStats;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("agents");
  const del = useDeleteAgent();
  const color = modelColor(ag.model);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  return (
    <>
      {confirmOpen && (
        <ConfirmModal
          title="Delete agent"
          body={`Delete agent "${ag.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => { setConfirmOpen(false); del.mutate(ag.id); }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
      <div onClick={onClick} style={s.card(!!active, ag.enabled)}>
        <div style={s.headerRow}>
          <div style={s.iconBox}>
            <Icon.Cpu size={15} />
          </div>
          <span style={s.name}>{ag.name}</span>
          {onToggle && (
            <div onClick={(e) => e.stopPropagation()}>
              <Toggle on={ag.enabled} onChange={onToggle} size={14} />
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmOpen(true);
            }}
            disabled={del.isPending}
            title="Delete agent"
            aria-label="Delete agent"
            style={{
              background: "none",
              border: "none",
              cursor: del.isPending ? "not-allowed" : "pointer",
              color: "var(--text-muted)",
              display: "inline-flex",
              padding: 4,
            }}
          >
            <Icon.Trash size={14} style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined} />
          </button>
        </div>
        <div style={s.description}>{ag.description || t("card.noDescription")}</div>
        <div style={s.metaRow}>
          <span className="mono" style={s.modelChip(color)}>
            {ag.model}
          </span>
          {skillCount != null && (
            <Badge color="var(--text-secondary)" icon="Sparkles">
              {t("card.skillCount", { count: skillCount })}
            </Badge>
          )}
        </div>
        {stats &&
          (stats.runs > 0 ? (
            <div style={s.statRow}>
              <span>{t("card.runs", { count: stats.runs })}</span>
              {stats.accept_pct != null && (
                <>
                  <span style={s.statSep}>·</span>
                  <span style={s.statAccept(acceptColor(stats.accept_pct))}>
                    {t("card.accept", { pct: stats.accept_pct })}
                  </span>
                </>
              )}
              {stats.avg_cost_usd != null && (
                <>
                  <span style={s.statSep}>·</span>
                  <span>{t("card.avg", { cost: formatCost(stats.avg_cost_usd) })}</span>
                </>
              )}
            </div>
          ) : (
            <div style={s.statEmpty}>{t("card.noRuns")}</div>
          ))}
      </div>
    </>
  );
}
