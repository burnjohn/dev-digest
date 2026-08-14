import type { Container } from '../../platform/container.js';
import type {
  Skill,
  SkillImportPreview,
  SkillSource,
  SkillStats,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import { SkillsRepository } from './repository.js';
import { ratio, toSkillDto, toSkillStatsDto, toSkillVersionDto, type SkillUsage } from './helpers.js';
import { extractSkill, type ImportArtifact } from './import.js';
import {
  DEFAULT_SKILL_SOURCE,
  DEFAULT_SKILL_TYPE,
  DEFAULT_STATS_WINDOW_DAYS,
} from './constants.js';

/**
 * Skills service. A Skill = name + description + type + markdown body, owned by
 * a workspace and reusable across agents — the agent side of the relationship
 * (attach / reorder) lives in the agents module.
 *
 * The body is the part that reaches a model. It is rendered as INSTRUCTIONS in
 * the assembled prompt, not fenced as untrusted data, so `enabled` is the trust
 * boundary: see specs/01-skills.md.
 */

export interface CreateSkillInput {
  name: string;
  description?: string;
  type?: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const windowStart = daysAgo(DEFAULT_STATS_WINDOW_DAYS);
    const [rows, usedBy, runsWithSkill, runsTotal, findings] = await Promise.all([
      this.repo.list(workspaceId),
      this.repo.usedByCounts(workspaceId),
      this.repo.runsWithSkillCounts(workspaceId, windowStart),
      this.repo.runsTotalCounts(workspaceId, windowStart),
      this.repo.findingsCounts(workspaceId, windowStart),
    ]);
    return rows.map((row) =>
      toSkillDto(row, usageFor(row.id, usedBy, runsWithSkill, runsTotal, findings)),
    );
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const windowStart = daysAgo(DEFAULT_STATS_WINDOW_DAYS);
    const [row, usedBy, runsWithSkill, runsTotal, findings] = await Promise.all([
      this.repo.getById(workspaceId, id),
      this.repo.usedByCounts(workspaceId, id),
      this.repo.runsWithSkillCounts(workspaceId, windowStart, id),
      this.repo.runsTotalCounts(workspaceId, windowStart, id),
      this.repo.findingsCounts(workspaceId, windowStart, id),
    ]);
    if (!row) return undefined;
    return toSkillDto(row, usageFor(id, usedBy, runsWithSkill, runsTotal, findings));
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description ?? '',
      type: input.type ?? DEFAULT_SKILL_TYPE,
      source: input.source ?? DEFAULT_SKILL_SOURCE,
      body: input.body,
      // An imported skill is someone else's instructions. It arrives OFF
      // regardless of what the caller asked for, so the only way a downloaded
      // body reaches a prompt is a human opening it and enabling it.
      enabled: isImported(input.source) ? false : (input.enabled ?? true),
    });
    return toSkillDto(row);
  }

  async update(workspaceId: string, id: string, patch: UpdateSkillInput): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /**
   * Body history for a skill, newest version first. Workspace-scoped: undefined
   * when the skill isn't in this workspace (the route maps that to 404) so one
   * tenant's prompt text can't be read through another's.
   */
  async listVersions(workspaceId: string, skillId: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  /** Ids of the agents that currently link this skill (empty when unused). */
  async agentsUsing(workspaceId: string, skillId: string): Promise<string[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    return this.repo.agentIdsUsing(skillId);
  }

  /**
   * Extract a skill from an uploaded artefact WITHOUT persisting it. The client
   * shows the result, and saving is a separate `create` call — so "stored only
   * after confirmation" is a property of the API shape, not a promise the UI has
   * to keep.
   */
  preview(artifact: ImportArtifact): SkillImportPreview {
    return extractSkill(artifact);
  }

  /**
   * Full Stats-tab aggregates for one skill. Undefined when the skill isn't in
   * this workspace (route → 404) — same guard as `listVersions`/`agentsUsing`.
   */
  async stats(
    workspaceId: string,
    skillId: string,
    windowDays: number = DEFAULT_STATS_WINDOW_DAYS,
  ): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;

    const windowStart = daysAgo(windowDays);
    const [usedBy, runsWithSkill, runsTotal, findings, categoryTally] = await Promise.all([
      this.repo.usedByCounts(workspaceId, skillId),
      this.repo.runsWithSkillCounts(workspaceId, windowStart, skillId),
      this.repo.runsTotalCounts(workspaceId, windowStart, skillId),
      this.repo.findingsCounts(workspaceId, windowStart, skillId),
      this.repo.categoryTally(workspaceId, skillId, windowStart),
    ]);

    return toSkillStatsDto({
      skillId,
      skillName: skill.name,
      windowDays,
      usedByAgents: usedBy.get(skillId) ?? 0,
      runsWithSkill: runsWithSkill.get(skillId) ?? 0,
      runsTotal: runsTotal.get(skillId) ?? 0,
      findings: findings.get(skillId) ?? { total: 0, accepted: 0, dismissed: 0 },
      categoryTally,
    });
  }
}

/** Merge four grouped-by-skill Maps into the one skill's usage summary. */
function usageFor(
  skillId: string,
  usedBy: Map<string, number>,
  runsWithSkill: Map<string, number>,
  runsTotal: Map<string, number>,
  findings: Map<string, { total: number; accepted: number; dismissed: number }>,
): SkillUsage {
  const f = findings.get(skillId);
  return {
    usedByAgents: usedBy.get(skillId) ?? 0,
    pullRate: ratio(runsWithSkill.get(skillId) ?? 0, runsTotal.get(skillId) ?? 0),
    acceptRate: ratio(f?.accepted ?? 0, (f?.accepted ?? 0) + (f?.dismissed ?? 0)),
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Provenance that means "this text came from outside this workspace".
 *
 * A total map rather than an OR-chain: this predicate IS the trust boundary, and
 * a new `SkillSource` member added without a decision here would silently fall
 * through to enabled-on-arrival. `Record<SkillSource, …>` makes that a compile
 * error instead.
 *
 * `extracted` is deliberately trusted: those come from the conventions scanner
 * over the user's OWN repo, not from anyone else.
 */
const FOREIGN_SOURCE: Record<SkillSource, boolean> = {
  manual: false,
  extracted: false,
  imported_url: true,
  community: true,
};

function isImported(source: SkillSource | undefined): boolean {
  return source !== undefined && FOREIGN_SOURCE[source];
}
