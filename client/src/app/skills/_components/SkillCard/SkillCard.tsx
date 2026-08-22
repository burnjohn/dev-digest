/* SkillCard — single row in the skills list. Shows name, type badge,
   description, enabled toggle, and stats line. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle, Button, Modal } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useUpdateSkill, useDeleteSkill } from "@/lib/hooks/skills";
import { resolveSkillThreat } from "@/lib/skill-threat";

const TYPE_COLOR: Record<string, string> = {
  rubric: "var(--accent)",
  convention: "var(--ok)",
  security: "var(--crit)",
  custom: "var(--warn)",
};

export function SkillCard({
  skill,
  active,
  onClick,
  onDeleted,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onDeleted?: () => void;
}) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();
  const del = useDeleteSkill();
  const [confirming, setConfirming] = React.useState(false);

  const color = TYPE_COLOR[skill.type] ?? "var(--text-muted)";
  const { isDangerous, isSuspicious, isScanning, isBlocked, badge } =
    resolveSkillThreat(skill);

  const borderColor = isDangerous
    ? "var(--crit)"
    : isSuspicious
      ? "var(--warn)"
      : active
        ? "var(--accent)"
        : "var(--border)";

  const bgColor = isDangerous
    ? "color-mix(in srgb, var(--crit) 6%, var(--bg-surface))"
    : isSuspicious
      ? "color-mix(in srgb, var(--warn) 6%, var(--bg-surface))"
      : active
        ? "var(--accent-bg)"
        : "var(--bg-surface)";

  return (
    <div
      onClick={onClick}
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        background: bgColor,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        opacity: skill.enabled ? 1 : 0.65,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
        {badge ? (
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
              maxWidth: 120,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {badge.text}
          </span>
        ) : (
          <Badge color={color}>{t(`listItem.type.${skill.type}`)}</Badge>
        )}
        <div
          onClick={(e) => e.stopPropagation()}
          title={
            isBlocked ? "Blocked: vet this skill before enabling" : undefined
          }
          style={{
            cursor: isBlocked ? "not-allowed" : undefined,
            flexShrink: 0,
          }}
        >
          <Toggle
            on={skill.enabled}
            size={13}
            onChange={(enabled) => {
              if (!isBlocked)
                update.mutate({ id: skill.id, patch: { enabled } });
            }}
          />
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
          disabled={del.isPending}
          title="Delete skill"
          aria-label="Delete skill"
          style={{
            background: "none",
            border: "none",
            cursor: del.isPending ? "not-allowed" : "pointer",
            color: "var(--text-muted)",
            padding: 4,
            display: "inline-flex",
          }}
        >
          <Icon.Trash
            size={14}
            style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined}
          />
        </button>
      </div>

      {confirming && (
        // Stop click from bubbling to SkillCard's onClick (which would navigate to the skill)
        <div onClick={(e) => e.stopPropagation()}>
        <Modal
          width={380}
          title="Delete skill"
          subtitle={`"${skill.name}" will be permanently removed. This cannot be undone.`}
          onClose={() => setConfirming(false)}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button kind="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button
                kind="danger"
                size="sm"
                onClick={() => {
                  setConfirming(false);
                  del.mutate(skill.id, { onSuccess: () => onDeleted?.() });
                }}
              >
                Delete
              </Button>
            </div>
          }
        />
        </div>
      )}
      {skill.description && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {skill.description}
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {t(`listItem.source.${skill.source}`)} · v{skill.version}
        {!skill.enabled && !isBlocked && (
          <>
            {" "}
            ·{" "}
            <span style={{ color: "var(--warn)" }}>
              {t("preview.disabled")}
            </span>
          </>
        )}
        {isBlocked && (
          <>
            {" "}
            ·{" "}
            <span
              style={{
                color: isDangerous ? "var(--crit)" : "var(--warn)",
                fontWeight: 600,
              }}
            >
              {isDangerous
                ? "blocked — injection detected"
                : "disabled — suspicious content"}
            </span>
          </>
        )}
        {isScanning && (
          <>
            {" "}
            ·{" "}
            <span style={{ color: "var(--text-muted)" }}>
              pending security scan
            </span>
          </>
        )}
      </div>
    </div>
  );
}
