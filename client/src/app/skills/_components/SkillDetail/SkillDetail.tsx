"use client";

import React, { useRef, useState } from "react";
import { Tabs, Button, Badge, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfigTab } from "./ConfigTab";
import { ContextTab } from "./ContextTab";
import { PreviewTab } from "./PreviewTab";
import { EvalsTab, type EvalsTabHandle } from "./EvalsTab";
import { StatsTab } from "./StatsTab";
import { VersionsTab } from "./VersionsTab";

const TYPE_COLOR: Record<string, string> = {
  rubric: "var(--accent)",
  convention: "var(--ok)",
  security: "var(--crit)",
  custom: "var(--info)",
};

const TABS = [
  { key: "config", label: "Config", icon: "Settings" as const },
  { key: "context", label: "Context", icon: "FileText" as const },
  { key: "preview", label: "Preview", icon: "Eye" as const },
  { key: "evals", label: "Evals", icon: "FlaskConical" as const },
  { key: "stats", label: "Stats", icon: "BarChart" as const },
  { key: "versions", label: "Versions", icon: "History" as const },
];

interface SkillDetailProps {
  skill: Skill;
}

export function SkillDetail({ skill }: SkillDetailProps) {
  const [tab, setTab] = useState("config");
  const evalsRef = useRef<EvalsTabHandle>(null);
  // Reactive run-state reported up by EvalsTab, driving the header "Run on
  // evals" button's disabled/loading appearance while on the Evals tab.
  const [evalRunState, setEvalRunState] = useState({ canRunAll: false, running: false });
  const onEvalsTab = tab === "evals";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          padding: "16px 28px 0",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <Icon.Puzzle size={18} style={{ color: TYPE_COLOR[skill.type] ?? "var(--text-muted)" }} />
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>{skill.name}</h1>
          <Badge color={TYPE_COLOR[skill.type] ?? "var(--info)"}>{skill.type}</Badge>
          <Badge color="var(--text-muted)" mono>
            v{skill.version}
          </Badge>
          <div style={{ marginLeft: "auto" }}>
            {/* Single run trigger: on the Evals tab it fires a full run (via the
                EvalsTab handle); elsewhere it navigates to the Evals tab. */}
            <Button
              kind="secondary"
              size="sm"
              icon="Play"
              disabled={onEvalsTab && !evalRunState.canRunAll}
              loading={onEvalsTab && evalRunState.running}
              onClick={() => {
                if (!onEvalsTab) {
                  setTab("evals");
                  return;
                }
                evalsRef.current?.runAll();
              }}
            >
              Run on evals
            </Button>
          </div>
        </div>
        <Tabs tabs={TABS} value={tab} onChange={setTab} pad="0" />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {tab === "config" && <ConfigTab skill={skill} />}
        {tab === "context" && <ContextTab skill={skill} />}
        {tab === "preview" && <PreviewTab skill={skill} />}
        {tab === "evals" && (
          <EvalsTab skill={skill} ref={evalsRef} onRunStateChange={setEvalRunState} />
        )}
        {tab === "stats" && <StatsTab skill={skill} />}
        {tab === "versions" && <VersionsTab skill={skill} onRestore={() => setTab("config")} />}
      </div>
    </div>
  );
}
