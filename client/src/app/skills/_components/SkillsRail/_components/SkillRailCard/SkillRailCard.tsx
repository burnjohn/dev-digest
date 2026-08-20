/* SkillRailCard — one skill in the left rail: name, global toggle, description,
   type + source, and how many agents attach it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Toggle } from "@devdigest/ui";
import type { SkillSummary } from "@devdigest/shared";
import { SOURCE_ICONS, TYPE_COLORS } from "../../../../constants";
import { isThirdParty } from "../../../../helpers";
import { s } from "../../../../styles";

export function SkillRailCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: SkillSummary;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const SourceIcon = Icon[SOURCE_ICONS[skill.source]];
  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)} data-testid={`skill-card-${skill.name}`}>
      <div style={s.cardHeader}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={13} />
        </div>
        <span className="mono" style={s.cardName}>
          {skill.name}
        </span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
      </div>

      <div style={s.cardDescription}>{skill.description}</div>

      <div style={s.cardMeta}>
        <span className="mono" style={s.typeChip(TYPE_COLORS[skill.type])}>
          {t(`listItem.type.${skill.type}`)}
        </span>
        <span
          style={s.sourceChip}
          title={isThirdParty(skill) ? t("listItem.vettingTitle") : undefined}
        >
          <SourceIcon size={11} />
          {t(`listItem.source.${skill.source}`)}
        </span>
      </div>

      <div style={s.cardFooter}>
        <span>{t("card.usedBy", { count: skill.used_by })}</span>
      </div>
    </div>
  );
}
