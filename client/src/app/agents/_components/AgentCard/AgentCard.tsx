/* AgentCard — model chip, skills count, enabled toggle. Stats are an A5 mount;
   we render the provider/model + skill count here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useDeleteAgent } from "../../../../lib/hooks/agents";
import { modelColor } from "./helpers";
import { s } from "./styles";

export function AgentCard({
  ag,
  active,
  skillCount,
  onClick,
  onToggle,
}: {
  ag: Agent;
  active?: boolean;
  skillCount?: number;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("agents");
  const del = useDeleteAgent();
  const color = modelColor(ag.model);
  return (
    /* Not a <button>: the card wraps its own controls (the enabled Toggle and
       the delete button), and interactive content inside a button is invalid
       HTML. Same role/tabIndex/onKeyDown shape as FindingsCell instead; the
       accessible name comes from the card's content. */
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        // Only when the card itself holds focus: keydown bubbles, so without
        // this, Enter on the Toggle or the delete button would also navigate.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          if (e.key === " ") e.preventDefault(); // Space scrolls the page otherwise
          onClick?.();
        }
      }}
      style={s.card(!!active, ag.enabled)}
    >
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Cpu size={15} />
        </div>
        <span style={s.name}>{ag.name}</span>
        {onToggle && (
          /* Pure event plumbing — it keeps a click on the Toggle from opening
             the agent. It contributes nothing to the a11y tree (the Toggle is
             the control), so it is marked presentational rather than given a
             role and key handlers it has no behaviour for. */
          <div role="none" onClick={(e) => e.stopPropagation()}>
            <Toggle on={ag.enabled} onChange={onToggle} size={14} />
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete agent "${ag.name}"? This cannot be undone.`)) del.mutate(ag.id);
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
    </div>
  );
}
