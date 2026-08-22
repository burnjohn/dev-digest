/* SkillEditor — 4-tab editor (Config | Preview | Stats | Versions). */
"use client";

import React from "react";
import { Tabs, Icon, Badge, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { resolveSkillThreat } from "@/lib/skill-threat";
import { ConfigTab } from "./_components/ConfigTab/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab/PreviewTab";
import { StatsTab } from "./_components/StatsTab/StatsTab";
import { VersionsTab } from "./_components/VersionsTab/VersionsTab";
import { TABS } from "./constants";

const VALID_TABS = TABS as readonly string[];

const TAB_DEFS = [
  { key: "config", label: "Config", icon: "Settings" as const },
  { key: "preview", label: "Preview", icon: "Eye" as const },
  { key: "stats", label: "Stats", icon: "BarChart" as const },
  { key: "versions", label: "Versions", icon: "Clock" as const },
];

export function SkillEditor({
  skill,
  tab,
  onTab,
}: {
  skill: Skill;
  tab: string;
  onTab: (t: string) => void;
}) {
  const update = useUpdateSkill();
  const activeTab = VALID_TABS.includes(tab) ? tab : "config";
  const { isDangerous, isSuspicious, isScanning, isBlocked, badge } =
    resolveSkillThreat(skill);

  const bannerConfig = isDangerous
    ? {
        icon: "🚨",
        label: "INJECTION DETECTED — DO NOT ENABLE",
        detail:
          "This skill contains prompt injection patterns. It has been automatically blocked.",
        color: "var(--crit)",
      }
    : isSuspicious
      ? {
          icon: "⚠️",
          label: "SUSPICIOUS CONTENT — REVIEW REQUIRED",
          detail:
            "Suspicious patterns detected. Review the skill body carefully before enabling.",
          color: "var(--warn)",
        }
      : isScanning
        ? {
            icon: "🔍",
            label: "SECURITY SCAN IN PROGRESS",
            detail:
              "This external skill is being analyzed. Toggle will be available once scanning completes.",
            color: "var(--text-muted)",
          }
        : null;

  const headerBadge = badge && <Badge color={badge.color}>{badge.text}</Badge>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Danger/warning banner for unvetted or flagged imported skills */}
      {bannerConfig && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 28px",
            background: `color-mix(in srgb, ${bannerConfig.color} 10%, var(--bg-surface))`,
            borderBottom: `2px solid ${bannerConfig.color}`,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 18 }}>{bannerConfig.icon}</span>
          <div>
            <span
              style={{
                fontWeight: 700,
                color: bannerConfig.color,
                fontSize: 13,
              }}
            >
              {bannerConfig.label}
            </span>
            <span
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                marginLeft: 8,
              }}
            >
              {bannerConfig.detail}
            </span>
          </div>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 28px 0",
          flexShrink: 0,
        }}
      >
        <Icon.Sparkles size={18} style={{ color: "var(--accent)" }} />
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>{skill.name}</h1>
        <Badge color="var(--text-secondary)" mono>
          v{skill.version}
        </Badge>
        {headerBadge}
        {!skill.enabled && !isBlocked && (
          <Badge color="var(--text-muted)">disabled</Badge>
        )}
        <div
          style={{
            marginLeft: "auto",
            cursor: isBlocked ? "not-allowed" : undefined,
          }}
          title={
            isDangerous
              ? "Blocked: injection detected"
              : isSuspicious
                ? "Review skill body before enabling"
                : isScanning
                  ? "Scan in progress — check back soon"
                  : undefined
          }
        >
          <Toggle
            on={skill.enabled}
            size={14}
            onChange={(enabled) => {
              if (!isBlocked)
                update.mutate({ id: skill.id, patch: { enabled } });
            }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <Tabs
          tabs={TAB_DEFS.map((tb) => ({
            key: tb.key,
            label: tb.label,
            icon: tb.icon,
          }))}
          value={activeTab}
          onChange={onTab}
          pad="0 24px"
        />
      </div>

      {/* Tab body */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {activeTab === "config" && <ConfigTab skill={skill} />}
        {activeTab === "preview" && <PreviewTab skill={skill} />}
        {activeTab === "stats" && <StatsTab skillId={skill.id} />}
        {activeTab === "versions" && <VersionsTab skill={skill} />}
      </div>
    </div>
  );
}
