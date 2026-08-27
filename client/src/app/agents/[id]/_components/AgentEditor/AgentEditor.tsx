/* AgentEditor — basic agent config editor (model + system prompt). Later
   lessons add Skills/Evals/Stats/CI tabs; the Part-0 starter ships Config only.
   Tab state still lives in ?tab= for forward-compatibility. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { ContextTab } from "./_components/ContextTab";
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
        {/* `key` makes switching agents remount the form, which is what resets it.
            Without it ConfigTab has to mirror all nine agent fields into state and
            re-sync them in an effect — the same reset, done by hand. */}
        {tab === "skills" ? (
          <SkillsTab key={agent.id} agent={agent} />
        ) : tab === "context" ? (
          <ContextTab key={agent.id} agent={agent} />
        ) : (
          <ConfigTab key={agent.id} agent={agent} />
        )}
      </div>
    </div>
  );
}
