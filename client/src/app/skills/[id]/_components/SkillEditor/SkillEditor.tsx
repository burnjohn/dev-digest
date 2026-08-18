/* SkillEditor — Config / Preview / Versions over one skill. Tab state is owned
   by the page (it lives in ?tab=); this component just renders the active one. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function SkillEditor({
  skill,
  usedBy,
  tab,
  onTab,
}: {
  skill: Skill;
  usedBy: number;
  tab: string;
  onTab: (t: string) => void;
}) {
  const t = useTranslations("skills");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));

  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {/* `key` remounts on skill change, which is what resets the Config form.
            Without it every field would need an effect to re-sync — the same
            reset, written by hand and easy to get wrong.

            The VERSION is part of the key, not just the id: ConfigTab seeds
            `body` into `useState` at mount, so a restore performed on the
            Versions tab would leave the Config tab showing the PRE-restore body,
            marked dirty — one click from silently un-restoring it. */}
        {tab === "config" && (
          <ConfigTab key={`${skill.id}:${skill.version}`} skill={skill} usedBy={usedBy} />
        )}
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "versions" && <VersionsTab key={skill.id} skill={skill} />}
      </div>
    </div>
  );
}
