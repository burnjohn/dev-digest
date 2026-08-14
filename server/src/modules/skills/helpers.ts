import type { Skill, SkillCategoryTally, SkillStats, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping and the
 * version-bump rule. No I/O.
 */

/** Read-only usage aggregates merged onto a `Skill` DTO for the list footer. */
export interface SkillUsage {
  usedByAgents: number;
  pullRate: number | null;
  acceptRate: number | null;
}

/**
 * Map a persisted skill row to the public `Skill` DTO. `usage` is passed in
 * rather than queried here: computing it is one grouped query for the whole
 * list (`SkillsRepository.usedByCounts` et al.), and doing it per row would
 * turn the skills list into an N+1. Omitted → the usage fields are absent and
 * the card footer renders nothing rather than a wrong 0.
 */
export function toSkillDto(row: SkillRow, usage?: SkillUsage): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    // No `as` on either: the Drizzle columns are declared with the same literal
    // unions, so an enum added to the table but not to the contract must fail to
    // compile here rather than surface as a DTO the contract later rejects.
    type: row.type,
    source: row.source,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
    ...(usage
      ? {
          used_by_agents: usage.usedByAgents,
          pull_rate: usage.pullRate,
          accept_rate: usage.acceptRate,
        }
      : {}),
  };
}

/** `numerator / denominator`, or `null` when the denominator is 0 — never NaN. */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * Assemble the `SkillStats` DTO from the repository's raw counts. Pure — the
 * service resolves every count first (in parallel) and hands them here so the
 * arithmetic (and its null rules) lives in one tested place.
 */
export function toSkillStatsDto(input: {
  skillId: string;
  skillName: string;
  windowDays: number;
  usedByAgents: number;
  runsWithSkill: number;
  runsTotal: number;
  findings: { total: number; accepted: number; dismissed: number };
  categoryTally: SkillCategoryTally[];
}): SkillStats {
  const { findings } = input;
  return {
    skill_id: input.skillId,
    skill_name: input.skillName,
    window_days: input.windowDays,
    used_by_agents: input.usedByAgents,
    runs_with_skill: input.runsWithSkill,
    runs_total: input.runsTotal,
    pull_rate: ratio(input.runsWithSkill, input.runsTotal),
    findings_total: findings.total,
    accepted: findings.accepted,
    dismissed: findings.dismissed,
    pending: findings.total - findings.accepted - findings.dismissed,
    accept_rate: ratio(findings.accepted, findings.accepted + findings.dismissed),
    findings_by_category: input.categoryTally,
  };
}

/** Map a persisted `skill_versions` row to the public `SkillVersion` DTO. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * True when a patch changes the skill BODY — the only field that bumps the
 * version and writes an immutable `skill_versions` row.
 *
 * Deliberately narrower than the agent rule (which versions on any config
 * field). A skill's body is the only part that reaches a model, so renaming a
 * skill or retyping it must not manufacture a version that is byte-identical to
 * the one before it. Version history here answers exactly one question: what
 * text was in the prompt at the time.
 */
export function isBodyChange(existing: Pick<SkillRow, 'body'>, patch: { body?: string }): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}
