/* SkillDetail — the tabbed panel to the right of the skills list: Config,
   Preview, Evals (placeholder), Stats and Versions. Tab state is owned by the
   parent (SkillsListView), which keeps it in the URL, the same way the agent
   editor's tab lives in `?tab=`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { TYPE_COLOR, TYPE_ICON } from "../SkillsListView/constants";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { EvalsTab } from "./_components/EvalsTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function SkillDetail({
  skill,
  tab,
  onTab,
  onDeleted,
}: {
  skill: Skill;
  tab: string;
  onTab: (t: string) => void;
  onDeleted?: () => void;
}) {
  const t = useTranslations("skills");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  const color = TYPE_COLOR[skill.type];
  const TypeIcon = Icon[TYPE_ICON[skill.type]];

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <TypeIcon size={16} style={{ color }} />
        <span style={s.name}>{skill.name}</span>
        <Badge color={color}>{t(`listItem.type.${skill.type}`)}</Badge>
        <Badge color="var(--text-muted)" mono>
          {t("preview.version", { version: skill.version })}
        </Badge>
        {!skill.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>}
      </div>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 20px" />
      </div>
      <div style={s.body}>
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "evals" && <EvalsTab />}
        {tab === "stats" && <StatsTab skill={skill} />}
        {tab === "versions" && <VersionsTab skill={skill} />}
        {tab !== "preview" && tab !== "evals" && tab !== "stats" && tab !== "versions" && (
          <ConfigTab skill={skill} onDeleted={onDeleted} />
        )}
      </div>
    </div>
  );
}
