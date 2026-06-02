import { SKILL_TYPE_COLOR, SKILL_TYPE_COLOR_FALLBACK } from "./constants";

/** A minimal skill-link shape (the skill id + its order). */
export interface SkillLinkLike {
  skill_id: string;
}

/** A minimal skill shape used for filtering. */
export interface SkillLike {
  name: string;
  description: string;
}

/** Resolve a skill type to its chip colour (unknown → fallback grey). */
export function skillTypeColor(type: string): string {
  return SKILL_TYPE_COLOR[type] ?? SKILL_TYPE_COLOR_FALLBACK;
}

/** Case-insensitive filter over a skill's name + description. */
export function filterSkills<T extends SkillLike>(skills: T[], filter: string): T[] {
  const q = filter.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q));
}

/**
 * Toggle `skillId` in the current link set, preserving existing order and
 * appending newly-linked skills. Returns the next ordered list of skill ids.
 */
export function nextSkillOrder(links: SkillLinkLike[], skillId: string): string[] {
  const next = new Set(links.map((l) => l.skill_id));
  if (next.has(skillId)) next.delete(skillId);
  else next.add(skillId);
  return [
    ...links.map((l) => l.skill_id).filter((id) => next.has(id)),
    ...[...next].filter((id) => !links.some((l) => l.skill_id === id)),
  ];
}
