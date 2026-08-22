"use client";
import React from "react";
import { Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { VersionsTab } from "./_components/VersionsTab";
import { StatsTab } from "./_components/StatsTab";

const TABS = [
  { key: "config", label: "Config", icon: "Settings" as const },
  { key: "preview", label: "Preview", icon: "Eye" as const },
  { key: "versions", label: "Versions", icon: "GitBranch" as const },
  { key: "stats", label: "Stats", icon: "BarChart" as const },
];

export function SkillEditor({ skill, tab, onTab }: { skill: Skill; tab: string; onTab: (t: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <Tabs tabs={TABS} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "24px 28px" }}>
        {tab === "config" && <ConfigTab skill={skill} />}
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "versions" && <VersionsTab skillId={skill.id} />}
        {tab === "stats" && <StatsTab skillId={skill.id} />}
      </div>
    </div>
  );
}
