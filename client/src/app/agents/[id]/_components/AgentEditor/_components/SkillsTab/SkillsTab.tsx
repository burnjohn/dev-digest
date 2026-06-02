"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/agents";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import { filterSkills, nextSkillOrder, skillTypeColor } from "./helpers";
import { s } from "./styles";

/** Skills tab — attach/reorder the skills linked to an agent. */
export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { data: allSkills } = useSkills();
  const { data: links } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills();
  const [filter, setFilter] = React.useState("");

  const linkedIds = React.useMemo(() => new Set((links ?? []).map((l) => l.skill_id)), [links]);
  const skills = filterSkills(allSkills ?? [], filter);

  const toggle = (skillId: string) => {
    const ordered = nextSkillOrder(links ?? [], skillId);
    setSkills.mutate({ agentId: agent.id, skillIds: ordered });
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent-text)" bg="var(--accent-bg)">
          {t("skills.enabledCount", { linked: linkedIds.size, total: (allSkills ?? []).length })}
        </Badge>
        <div style={s.search}>
          <Icon.Search size={13} style={s.searchIcon} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>
      <div style={s.list}>
        {skills.map((sk) => {
          const on = linkedIds.has(sk.id);
          const color = skillTypeColor(sk.type);
          return (
            <div key={sk.id} onClick={() => toggle(sk.id)} style={s.row(on)}>
              <Icon.Menu size={14} style={s.grip} />
              <span style={s.checkbox(on)}>
                {on && <Icon.Check size={11} style={s.checkIcon} />}
              </span>
              <span className="mono" style={s.skillName}>
                {sk.name}
              </span>
              <span style={s.typeChip(color)}>{sk.type}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
