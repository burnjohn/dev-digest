import type { SkillListItem } from "@devdigest/shared";

/**
 * Case-insensitive search over the fields the user can actually see on a card.
 *
 * Body is deliberately EXCLUDED: matching on it would surface cards whose
 * highlighted reason is invisible, which reads as a broken filter. Pure, so it
 * is tested without rendering.
 */
export function filterSkills(skills: SkillListItem[], query: string): SkillListItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.type.toLowerCase().includes(q),
  );
}
