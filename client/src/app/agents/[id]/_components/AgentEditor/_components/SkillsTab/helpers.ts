import type { AgentSkillLink, Skill } from "@devdigest/shared";

/**
 * Pure ordering logic for the Skills tab.
 *
 * Kept out of the component on purpose: drag interactions are close to
 * untestable under jsdom, so the ARRANGEMENT is what gets unit-tested and the
 * drag wiring stays a thin shell over these functions.
 */

/**
 * The visual order of the tab: attached skills first, in the order the agent
 * has them, then the rest alphabetically.
 *
 * Only attached skills have a persisted position — `agent_skills` stores a row
 * per link and nothing for the others — so an unattached skill's place in the
 * list is presentational and resets on reload. That is deliberate: the order
 * that matters is the order of the blocks in the prompt, and an unattached
 * skill has no block.
 */
export function arrangeSkills(skills: Skill[], links: AgentSkillLink[]): Skill[] {
  const position = new Map(links.map((l) => [l.skill_id, l.order]));
  const attached = skills
    .filter((s) => position.has(s.id))
    .sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  const rest = skills
    .filter((s) => !position.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...attached, ...rest];
}

/** Move the item at `from` to `to`, returning a new array. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(to, 0, item);
  return next;
}

/**
 * The payload for `POST /agents/:id/skills` — the attached ids in visual order.
 * The server rewrites `order` from the array index, so dropping the unattached
 * ones here is the whole persistence step.
 */
export function attachedIdsInOrder(ordered: Skill[], attached: ReadonlySet<string>): string[] {
  return ordered.filter((s) => attached.has(s.id)).map((s) => s.id);
}

/** Case-insensitive filter over a skill's name, description and type. */
export function filterSkills(skills: Skill[], search: string): Skill[] {
  const q = search.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) => `${s.name} ${s.description} ${s.type}`.toLowerCase().includes(q));
}
