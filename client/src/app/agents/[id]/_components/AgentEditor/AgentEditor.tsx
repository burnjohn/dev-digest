/* AgentEditor — 5-tab editor (Config / Skills / Evals / Stats / CI). Config +
   Skills are functional (A2). Evals (A4), Stats (A5), CI (A4) are owned feature
   tab components imported by their default-export names. Tab state lives in ?tab=. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import AgentEvalsTab from "../AgentEvalsTab";
import AgentCiTab from "../AgentCiTab";
import AgentStatsTab from "../AgentStatsTab";
import { ConfigTab } from "./_components/ConfigTab";
import { SkillsTab } from "./_components/SkillsTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {tab === "config" && <ConfigTab agent={agent} />}
        {tab === "skills" && <SkillsTab agent={agent} />}
        {tab === "evals" && <AgentEvalsTab agentId={agent.id} />}
        {tab === "stats" && <AgentStatsTab agentId={agent.id} />}
        {tab === "ci" && <AgentCiTab agentId={agent.id} agentName={agent.name} />}
      </div>
    </div>
  );
}
