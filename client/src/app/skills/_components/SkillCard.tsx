"use client";

import React from "react";
import { Badge, Toggle, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useUpdateSkill, useSkillStats, useDeleteSkill } from "../../../lib/hooks/skills";
import { ConfirmModal } from "@/components/confirm-modal";

const TYPE_COLOR: Record<string, string> = {
  rubric: "var(--accent)",
  convention: "var(--ok)",
  security: "var(--crit)",
  custom: "var(--info)",
};

type SourceMeta = { icon: keyof typeof Icon; label: string; warn?: true };
const SOURCE_META: Record<string, SourceMeta> = {
  manual:        { icon: "Edit",   label: "Manual" },
  extracted:     { icon: "Zap",    label: "Extracted" },
  community:     { icon: "Globe",  label: "Community", warn: true },
  imported_url:  { icon: "Link",   label: "Imported",  warn: true },
  imported_file: { icon: "Upload", label: "Imported",  warn: true },
};

interface SkillCardProps {
  skill: Skill;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
}

export function SkillCard({ skill, active, onClick, onDelete }: SkillCardProps) {
  const update = useUpdateSkill();
  const del = useDeleteSkill();
  const { data: stats } = useSkillStats(skill.id);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    update.mutate({ id: skill.id, patch: { enabled: !skill.enabled } });
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmOpen(true);
  };

  const handleConfirmDelete = () => {
    setConfirmOpen(false);
    del.mutate(skill.id, { onSuccess: () => onDelete?.() });
  };

  const srcMeta: SourceMeta = SOURCE_META[skill.source] ?? { icon: "File", label: skill.source };
  const SrcIcon = Icon[srcMeta.icon];
  const typeColor = TYPE_COLOR[skill.type] ?? "var(--text-muted)";

  return (
    <>
      {confirmOpen && (
        <ConfirmModal
          title="Delete skill"
          body={`Delete "${skill.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
      <div
        onClick={onClick}
        style={{
          padding: "12px 14px",
          borderRadius: 8,
          marginBottom: 4,
          cursor: "pointer",
          background: active ? "var(--bg-hover)" : "transparent",
          border: active ? "1px solid var(--accent)" : "1px solid transparent",
          transition: "background 120ms",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          {/* Colored icon chip */}
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: typeColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              marginTop: 1,
              opacity: skill.enabled ? 1 : 0.4,
            }}
          >
            <Icon.Puzzle size={14} color="#fff" />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 13,
                marginBottom: 3,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {skill.name}
            </div>

            {skill.description && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  marginBottom: 8,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {skill.description}
              </div>
            )}

            {/* Type badge + source */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Badge color={typeColor}>{skill.type}</Badge>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  fontSize: 11,
                  color: "var(--text-muted)",
                }}
              >
                {srcMeta.warn && (
                  <Icon.AlertTriangle size={10} style={{ color: "var(--warn)" }} />
                )}
                <SrcIcon size={11} />
                {srcMeta.label}
              </span>
            </div>

            {/* Stats line */}
            {stats && (
              <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
                {stats.used_by} agent{stats.used_by !== 1 ? "s" : ""}
                {stats.pull_frequency_pct > 0 && <> &middot; {stats.pull_frequency_pct}% pull</>}
                {stats.accept_rate_pct > 0 && (
                  <>
                    {" "}&middot;{" "}
                    <span style={{ color: "var(--ok)", fontWeight: 600 }}>
                      {stats.accept_rate_pct}% accept
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 1, flexShrink: 0 }}>
            <button
              onClick={handleDeleteClick}
              disabled={del.isPending}
              title="Delete skill"
              aria-label="Delete skill"
              style={{
                background: "none",
                border: "none",
                cursor: del.isPending ? "not-allowed" : "pointer",
                color: "var(--text-muted)",
                display: "inline-flex",
                padding: 4,
                borderRadius: 4,
              }}
            >
              <Icon.Trash
                size={13}
                style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined}
              />
            </button>
            <div onClick={handleToggle}>
              <Toggle on={skill.enabled} onChange={() => {}} size={16} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
