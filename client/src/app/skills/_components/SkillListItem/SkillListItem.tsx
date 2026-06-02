"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { SKILL_TYPE, SKILL_SOURCE } from "./constants";
import { s } from "./styles";

export function SkillListItem({
  s: skill,
  active,
  onClick,
  onToggle,
}: {
  s: Skill;
  active: boolean;
  onClick: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const ty = SKILL_TYPE[skill.type];
  const src = SKILL_SOURCE[skill.source];
  const SrcIcon = Icon[src.icon];
  return (
    <div onClick={onClick} style={s.item(active, skill.enabled)}>
      <div style={s.headerRow}>
        <span className="mono" style={s.name}>
          {skill.name}
        </span>
        <div onClick={(e) => e.stopPropagation()}>
          <Toggle on={skill.enabled} onChange={onToggle} size={13} />
        </div>
      </div>
      <div style={s.description}>{skill.description}</div>
      <div style={s.metaRow}>
        <span style={s.typeChip(ty.c)}>{t(`listItem.type.${ty.labelKey}`)}</span>
        <span style={s.source}>
          <SrcIcon size={11} />
          {t(`listItem.source.${src.labelKey}`)}
        </span>
        {!skill.enabled && skill.source !== "manual" && (
          <span style={s.vetting} title={t("listItem.vettingTitle")}>
            <Icon.Shield size={11} /> {t("listItem.needsVetting")}
          </span>
        )}
      </div>
    </div>
  );
}
