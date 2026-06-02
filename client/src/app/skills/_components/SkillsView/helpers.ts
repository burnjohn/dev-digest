import type { Skill } from "@devdigest/shared";

/** Filter skills by a free-text query over name + description (case-insensitive). */
export function filterSkills(skills: Skill[], search: string): Skill[] {
  const q = search.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q));
}
