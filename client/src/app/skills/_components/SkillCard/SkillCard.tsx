/* SkillCard — one row in the narrow skills list column: type icon, name,
   enabled toggle, description, type/source badges, and a usage footer once the
   skill has been used by at least one agent. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { TYPE_COLOR, TYPE_ICON } from "../SkillsListView/constants";
import { isUntrusted, toPercent } from "../SkillsListView/helpers";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const color = TYPE_COLOR[skill.type];
  const TypeIcon = Icon[TYPE_ICON[skill.type]];
  const untrusted = isUntrusted(skill);

  // Omitted fields (list responses without a usage join, e.g. in tests that
  // stub the hook) render no footer at all rather than a misleading "0 agents".
  const usedBy = skill.used_by_agents ?? null;
  const footer =
    usedBy != null && usedBy > 0
      ? [
          t("card.usedBy", { count: usedBy }),
          skill.pull_rate != null ? t("card.pull", { pct: toPercent(skill.pull_rate) }) : null,
          skill.accept_rate != null ? t("card.accept", { pct: toPercent(skill.accept_rate) }) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    /* Not a <button>: the row wraps the enabled Toggle, and interactive content
       inside a button is invalid HTML. Same shape as AgentCard. */
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        // keydown bubbles — without this, Enter on the Toggle would also select.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          if (e.key === " ") e.preventDefault();
          onClick?.();
        }
      }}
      style={s.card(!!active, skill.enabled)}
    >
      <div style={s.headerRow}>
        <span style={s.iconBox(color)}>
          <TypeIcon size={13} />
        </span>
        <span style={s.name}>{skill.name}</span>
        {onToggle && (
          /* Pure event plumbing so a click on the Toggle does not select the
             row. Contributes nothing to the a11y tree — the Toggle is the
             control — so it is marked presentational. */
          <div role="none" onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={13} />
          </div>
        )}
      </div>

      <div style={s.description}>{skill.description}</div>

      <div style={s.metaRow}>
        <Badge color={color}>{t(`listItem.type.${skill.type}`)}</Badge>
        <Badge color="var(--text-muted)">{t(`listItem.source.${skill.source}`)}</Badge>
        {untrusted && (
          <span title={t("listItem.vettingTitle")}>
            <Badge color="var(--warn)" icon="AlertTriangle">
              {t("listItem.needsVetting")}
            </Badge>
          </span>
        )}
      </div>

      {footer && <div style={s.statsRow}>{footer}</div>}
    </div>
  );
}
