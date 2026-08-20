import type { AgentSkillDetail, SkillSummary } from "@devdigest/shared";

/**
 * One row of the Skills tab. Every skill in the workspace gets a row; `linked`
 * says whether this agent has it attached at all, `enabled` whether the attached
 * skill is actually injected into the prompt.
 *
 * The two flags are deliberately distinct: unchecking a skill keeps the link (and
 * therefore its position in the order), so re-enabling it later restores exactly
 * the prompt that existed before — that is what makes the skills-on / skills-off
 * comparison reproducible.
 */
export interface SkillRowState {
  id: string;
  name: string;
  description: string;
  type: SkillSummary["type"];
  source: SkillSummary["source"];
  /** The skill's own global switch — false means it cannot apply to any agent. */
  globallyEnabled: boolean;
  linked: boolean;
  enabled: boolean;
}

/**
 * Build the rows: linked skills first in their prompt order, then the rest of the
 * workspace's skills alphabetically. Skills the agent links are the ones the user
 * has arranged; everything else is offered below, ready to attach.
 */
export function buildRows(
  all: SkillSummary[],
  linked: AgentSkillDetail[],
): SkillRowState[] {
  const linkedById = new Map(linked.map((l) => [l.id, l]));
  const inOrder = [...linked].sort((a, b) => a.order - b.order);

  const linkedRows: SkillRowState[] = inOrder
    // A link whose skill vanished from the list (deleted in another tab) is
    // dropped rather than rendered from stale link data.
    .filter((l) => all.some((s) => s.id === l.id))
    .map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      type: l.type,
      source: l.source,
      globallyEnabled: l.enabled,
      linked: true,
      enabled: l.link_enabled,
    }));

  const rest: SkillRowState[] = all
    .filter((s) => !linkedById.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      type: s.type,
      source: s.source,
      globallyEnabled: s.enabled,
      linked: false,
      enabled: false,
    }));

  return [...linkedRows, ...rest];
}

/** Move the row at `from` to index `to`, returning a new array. */
export function moveRow(rows: SkillRowState[], from: number, to: number): SkillRowState[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return rows;
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * Check / uncheck a row. Checking attaches the skill if it wasn't attached;
 * unchecking leaves it attached but disabled (see `SkillRowState`).
 */
export function toggleRow(rows: SkillRowState[], id: string, enabled: boolean): SkillRowState[] {
  return rows.map((r) => (r.id === id ? { ...r, enabled, linked: r.linked || enabled } : r));
}

/** Detach a skill from the agent entirely (the row stays, unchecked). */
export function detachRow(rows: SkillRowState[], id: string): SkillRowState[] {
  return rows.map((r) => (r.id === id ? { ...r, linked: false, enabled: false } : r));
}

/** The POST body: only attached skills, in row order — row order IS prompt order. */
export function toPayload(rows: SkillRowState[]): Array<{ skill_id: string; enabled: boolean }> {
  return rows.filter((r) => r.linked).map((r) => ({ skill_id: r.id, enabled: r.enabled }));
}

/** How many skills actually reach the prompt: attached, on, and not globally off. */
export function countActive(rows: SkillRowState[]): number {
  return rows.filter((r) => r.linked && r.enabled && r.globallyEnabled).length;
}

/** Case-insensitive filter over name and description. */
export function filterRows(rows: SkillRowState[], query: string): SkillRowState[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) => r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
  );
}
