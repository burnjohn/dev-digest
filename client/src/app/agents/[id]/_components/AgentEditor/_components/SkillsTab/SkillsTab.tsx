/* SkillsTab — attach/detach and reorder skills for an agent. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Skeleton, ErrorState, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkills } from "@/lib/hooks/skills";
import { useAgentSkills, useSetAgentSkills } from "@/lib/hooks/skills";
import { resolveSkillThreat } from "@/lib/skill-threat";

const TYPE_COLOR: Record<string, string> = {
  rubric: "var(--accent)",
  convention: "var(--ok)",
  security: "var(--crit)",
  custom: "var(--warn)",
};

export function SkillsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const tSkills = useTranslations("skills");

  const {
    data: allSkills,
    isLoading: skillsLoading,
    isError: skillsError,
  } = useSkills();
  const {
    data: links,
    isLoading: linksLoading,
    isError: linksError,
    refetch,
  } = useAgentSkills(agentId);
  const setSkills = useSetAgentSkills();

  const [search, setSearch] = React.useState("");
  const [dragOver, setDragOver] = React.useState<string | null>(null);

  // Ordered list of linked skill_ids
  const linkedIds: string[] = React.useMemo(() => {
    if (!links) return [];
    return [...links].sort((a, b) => a.order - b.order).map((l) => l.skill_id);
  }, [links]);

  const isLinked = (skillId: string) => linkedIds.includes(skillId);

  const handleToggle = (skillId: string, checked: boolean) => {
    let newIds: string[];
    if (checked) {
      newIds = [...linkedIds, skillId];
    } else {
      newIds = linkedIds.filter((id) => id !== skillId);
    }
    setSkills.mutate({ agentId, skill_ids: newIds });
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData("skillId");
    if (!draggedId || draggedId === targetId) return;

    const from = linkedIds.indexOf(draggedId);
    const to = linkedIds.indexOf(targetId);
    if (from < 0 || to < 0) return;

    const next = [...linkedIds];
    next.splice(from, 1);
    next.splice(to, 0, draggedId);
    setSkills.mutate({ agentId, skill_ids: next });
    setDragOver(null);
  };

  const isLoading = skillsLoading || linksLoading;
  const isError = skillsError || linksError;

  if (isLoading) {
    return (
      <div
        style={{
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <Skeleton height={48} />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState body="Could not load skills." onRetry={() => refetch()} />
    );
  }

  const all = allSkills ?? [];
  const filtered = all.filter(
    (s) => !search || s.name.toLowerCase().includes(search.toLowerCase()),
  );

  // Sort: linked (in order) first, then unlinked alphabetically
  const sorted = [
    ...(linkedIds
      .map((id) => all.find((s) => s.id === id))
      .filter(Boolean) as Skill[]),
    ...all
      .filter((s) => !isLinked(s.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ].filter(
    (s) => !search || s.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ padding: 28, maxWidth: 720 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>
          {t("skills.title")}
        </h2>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("skills.enabledCount", {
            linked: linkedIds.length,
            total: all.length,
          })}
        </span>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        {t("skills.orderHint")}
      </p>

      {/* Search */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("skills.filterPlaceholder")}
        style={{
          width: "100%",
          padding: "6px 10px",
          marginBottom: 14,
          border: "1px solid var(--border)",
          borderRadius: 7,
          background: "var(--bg-elevated)",
          fontSize: 13,
          color: "var(--text-primary)",
          boxSizing: "border-box",
        }}
      />

      {/* Skill rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {sorted.map((skill) => {
          const linked = isLinked(skill.id);
          const { isDangerous, isSuspicious, isScanning, isBlocked, badge } =
            resolveSkillThreat(skill);
          const canLink = !isBlocked;

          const borderColor = isDangerous
            ? "var(--crit)"
            : isSuspicious
              ? "var(--warn)"
              : dragOver === skill.id
                ? "var(--accent)"
                : "var(--border)";

          const bgColor = isDangerous
            ? "color-mix(in srgb, var(--crit) 6%, var(--bg-elevated))"
            : isSuspicious
              ? "color-mix(in srgb, var(--warn) 6%, var(--bg-elevated))"
              : dragOver === skill.id
                ? "var(--accent-bg)"
                : "var(--bg-elevated)";
          return (
            <div
              key={skill.id}
              draggable={linked && canLink}
              onDragStart={(e) => e.dataTransfer.setData("skillId", skill.id)}
              onDragOver={(e) => {
                if (linked && canLink) {
                  e.preventDefault();
                  setDragOver(skill.id);
                }
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => handleDrop(e, skill.id)}
              title={
                isBlocked
                  ? "Vet and enable this skill before attaching it to an agent"
                  : undefined
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${borderColor}`,
                background: bgColor,
                opacity: linked ? 1 : 0.6,
              }}
            >
              {/* Drag handle */}
              <span
                style={{
                  cursor: linked && canLink ? "grab" : "default",
                  color:
                    linked && canLink ? "var(--text-muted)" : "transparent",
                  fontSize: 16,
                  userSelect: "none",
                  flexShrink: 0,
                }}
              >
                ≡
              </span>

              {/* Toggle — blocked for unvetted skills */}
              <div
                title={
                  isDangerous
                    ? "Blocked: injection detected"
                    : isSuspicious
                      ? "Review skill body before enabling"
                      : isScanning
                        ? "Scan in progress"
                        : undefined
                }
                style={{
                  flexShrink: 0,
                  cursor: isBlocked ? "not-allowed" : "pointer",
                }}
                onClick={(e) => {
                  if (isBlocked) e.stopPropagation();
                }}
              >
                <Toggle
                  on={linked && canLink}
                  size={13}
                  onChange={(checked) => {
                    if (canLink) handleToggle(skill.id, checked);
                  }}
                />
              </div>

              {/* Name + type */}
              <span
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {skill.name}
              </span>
              <Badge color={TYPE_COLOR[skill.type] ?? "var(--text-muted)"}>
                {tSkills(`listItem.type.${skill.type}`)}
              </Badge>

              {/* Threat badge */}
              {badge && (
                <span
                  title={badge.title}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: badge.color,
                    background: badge.bg,
                    border: `1px solid ${badge.border}`,
                    padding: "2px 6px",
                    borderRadius: 4,
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  {badge.text}
                </span>
              )}

              {/* Order badge for linked */}
              {linked && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "monospace",
                    color: "var(--text-muted)",
                    flexShrink: 0,
                  }}
                >
                  #{linkedIds.indexOf(skill.id) + 1}
                </span>
              )}
            </div>
          );
        })}
        {sorted.length === 0 && (
          <p
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              textAlign: "center",
              padding: 24,
            }}
          >
            No skills match.
          </p>
        )}
      </div>
    </div>
  );
}
