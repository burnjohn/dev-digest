/* SkillCard — one skill in the list/rail: name, global enabled toggle, type +
   source badges, and how many agents link it.

   Structure note: the card is a plain container, NOT a button. The navigable
   region is a <Link> and the toggle is its SIBLING. Nesting a <button> inside a
   button or a link is invalid HTML — the browser's own parser breaks it apart —
   and it makes the toggle unreachable in the tab order for some AT. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { SkillListItem } from "@devdigest/shared";
import { EXTERNAL_SOURCES, SOURCE_ICON, TYPE_COLOR } from "./constants";
import { s } from "./styles";

export function SkillCard({
  skill,
  href,
  active,
  onToggle,
}: {
  skill: SkillListItem;
  href: string;
  active?: boolean;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const isExternal = EXTERNAL_SOURCES.includes(skill.source);

  return (
    <div style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox} aria-hidden="true">
          <Icon.Sparkles size={15} />
        </div>
        {/* The link covers the identity of the card; `translate="no"` keeps a
            skill name (an identifier) out of machine translation. */}
        <Link href={href} style={s.nameLink} translate="no">
          <span className="mono" style={s.name}>
            {skill.name}
          </span>
        </Link>
        {onToggle && (
          <Toggle
            on={skill.enabled}
            onChange={onToggle}
            size={14}
            ariaLabel={`${t("editor.enabled")} — ${skill.name}`}
          />
        )}
      </div>

      <Link href={href} style={s.bodyLink} tabIndex={-1} aria-hidden="true">
        <div style={s.description}>{skill.description || "—"}</div>
      </Link>

      <div style={s.badgeRow}>
        <Badge color={TYPE_COLOR[skill.type]}>{t(`listItem.type.${skill.type}`)}</Badge>
        <Badge color="var(--text-muted)" icon={SOURCE_ICON[skill.source]}>
          {t(`listItem.source.${skill.source}`)}
        </Badge>
        {isExternal && (
          <span title={t("listItem.vettingTitle")} style={s.unread}>
            {t("listItem.needsVetting")}
          </span>
        )}
      </div>

      {/* Deliberately only used_by. The mockup's "% pull / % accept" need
          per-skill findings attribution, which does not exist yet — a
          placeholder number here would be a claim the user cannot audit. */}
      <div style={s.metaRow}>
        <Icon.Cpu size={12} aria-hidden="true" />
        <span>{t("card.usedBy", { count: skill.used_by })}</span>
      </div>
    </div>
  );
}
