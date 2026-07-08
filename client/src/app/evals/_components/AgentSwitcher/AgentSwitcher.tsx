"use client";

/* AgentSwitcher (Agent Eval Dashboard detail page, AC-16) — a Dropdown-based
   selector letting the user jump between eval-configured agents without
   returning to the `/evals` landing page. Populated from `useEvalOverview()`'s
   agent list, which already applies the same "≥1 eval case" filter as the
   landing page's grid (AC-3) — no extra filtering needed here.

   Selecting an agent does a client-side `router.push` to that agent's own
   detail route, swapping the page's content in place (no full reload). */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Dropdown, Icon, type DropdownItemDef } from "@devdigest/ui";
import type { EvalAgentSummary } from "@devdigest/shared";

export function AgentSwitcher({
  agentId,
  agents,
}: {
  agentId: string;
  agents: EvalAgentSummary[];
}) {
  const t = useTranslations("evals");
  const router = useRouter();

  const active = agents.find((a) => a.agent_id === agentId);

  const items: DropdownItemDef[] = agents.map((a) => ({
    label: a.agent_name,
    icon: "Cpu",
    muted: a.agent_id === agentId,
    onClick: () => {
      if (a.agent_id !== agentId) router.push(`/evals/${a.agent_id}`);
    },
  }));

  return (
    <Dropdown
      align="left"
      width={240}
      items={items}
      trigger={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <Icon.Cpu size={14} style={{ color: "var(--text-muted)" }} />
          <span>{active?.agent_name ?? t("detail.switcher.placeholder")}</span>
          <Icon.ChevronsUpDown size={14} style={{ color: "var(--text-muted)" }} />
        </div>
      }
    />
  );
}
