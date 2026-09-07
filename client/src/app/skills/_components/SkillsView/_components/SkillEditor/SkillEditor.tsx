/* SkillEditor — tab bar + panel routing for one selected skill. Mirrors
   AgentEditor: tab state lives in ?tab= (owned by the parent SkillsView),
   this component only renders the bar and picks the panel. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { ContextTab } from "./_components/ContextTab";
import { EvalsTab } from "./_components/EvalsTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS } from "./constants";
import type { SkillTab } from "../../constants";
import { s } from "./styles";

export function SkillEditor({
  skill,
  tab,
  onTab,
}: {
  skill: Skill;
  tab: SkillTab;
  onTab: (t: string) => void;
}) {
  const t = useTranslations("skills");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));

  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 28px" />
      </div>
      <div style={s.body}>
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "context" && <ContextTab skill={skill} />}
        {tab === "evals" && <EvalsTab skill={skill} />}
        {tab === "stats" && <StatsTab skill={skill} />}
        {tab === "versions" && <VersionsTab skill={skill} />}
        {tab === "config" && <ConfigTab skill={skill} />}
      </div>
    </div>
  );
}
