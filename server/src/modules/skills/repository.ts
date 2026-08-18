import { and, asc, count, countDistinct, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';
import { isBodyChange } from './helpers.js';

/**
 * Skills data-access. Owns `skills` and `skill_versions`. The `agent_skills`
 * link table is owned by the AGENTS module (link/reorder for one agent) — the
 * only thing read from it here is the reverse direction: which agents a skill is
 * attached to, needed to answer "is this skill in use" without importing the
 * agents repository.
 *
 * Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled: boolean;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(asc(t.skills.name));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /**
   * Delete a skill. `agent_skills` rows cascade, so any agent that linked it
   * silently loses it from its prompt — see the open question in
   * specs/01-skills.md. Returns false when no such skill existed here.
   */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Insert a skill AND record version 1 in skill_versions (immutable snapshot). */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled,
        version: INITIAL_SKILL_VERSION,
      })
      .returning();
    if (!row) throw new Error('insert into skills returned no row');
    await this.snapshotVersion(row.id, INITIAL_SKILL_VERSION, row.body);
    return row;
  }

  /**
   * Update a skill. A changed body bumps `version` and snapshots the NEW body
   * into `skill_versions`; renames and toggles do not.
   */
  async update(workspaceId: string, id: string, patch: UpdateSkill): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = isBodyChange(existing, patch);
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) await this.snapshotVersion(row.id, nextVersion, row.body);
    return row;
  }

  private async snapshotVersion(skillId: string, version: number, body: string): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId, version, body })
      .onConflictDoNothing();
  }

  // ---- skill_versions (immutable body snapshots) --------------------------

  /** All body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  // ---- reverse view of agent_skills (agents module owns the forward side) --

  /** Ids of the agents this skill is attached to. Empty when it is unused. */
  async agentIdsUsing(skillId: string): Promise<string[]> {
    const rows = await this.db
      .select({ agentId: t.agentSkills.agentId })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, skillId));
    return rows.map((r) => r.agentId);
  }

  // ---- stats: run_skill_links + findings, windowed --------------------------
  //
  // Every method here takes an optional `skillId`. Omitted, it returns a Map
  // keyed by every skill in the workspace — ONE grouped query for the whole
  // list, not N+1. Given, the Map has at most one entry — the Skill detail
  // Stats tab reads a single value out of the same query shape rather than a
  // hand-duplicated "for one skill" variant.

  /**
   * Agents currently linking each skill. NOT windowed — this is a config fact
   * ("is this skill attached"), not an activity metric.
   */
  async usedByCounts(workspaceId: string, skillId?: string): Promise<Map<string, number>> {
    const conditions = [eq(t.skills.workspaceId, workspaceId)];
    if (skillId) conditions.push(eq(t.agentSkills.skillId, skillId));
    const rows = await this.db
      .select({ skillId: t.agentSkills.skillId, count: count() })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .where(and(...conditions))
      .groupBy(t.agentSkills.skillId);
    return new Map(rows.map((r) => [r.skillId, Number(r.count)]));
  }

  /**
   * Runs, in the window, that had each skill enabled in the prompt — the
   * PULL_RATE numerator. Reads `run_skill_links`, which only ever contains rows
   * for a run where the skill was enabled at resolution time (a disabled skill
   * is never resolved into a prompt), so this count falls on its own the moment
   * a skill is switched off — no extra "is it enabled" filter needed here.
   */
  async runsWithSkillCounts(
    workspaceId: string,
    windowStart: Date,
    skillId?: string,
  ): Promise<Map<string, number>> {
    const conditions = [
      eq(t.agentRuns.workspaceId, workspaceId),
      gte(t.agentRuns.ranAt, windowStart),
    ];
    if (skillId) conditions.push(eq(t.runSkillLinks.skillId, skillId));
    const rows = await this.db
      .select({ skillId: t.runSkillLinks.skillId, count: countDistinct(t.runSkillLinks.runId) })
      .from(t.runSkillLinks)
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runSkillLinks.runId))
      .where(and(...conditions))
      .groupBy(t.runSkillLinks.skillId);
    return new Map(rows.map((r) => [r.skillId, Number(r.count)]));
  }

  /**
   * Runs, in the window, by agents that CURRENTLY link each skill — the
   * PULL_RATE denominator. `agent_skills` has no history (unlike `skills`,
   * which versions its body), so this is today's links, not the links at run
   * time — see the open question in specs/02-skill-detail-tabs.md. A run counts
   * toward every skill its agent links; that is deliberate, since the same
   * agent activity is the baseline each of its linked skills is measured
   * against, not a pool split between them.
   *
   * `agent_skills.skill_id` is guaranteed to be in `workspaceId` by
   * `AgentsService.assertSkillsInWorkspace` at link time, so this join needs no
   * extra `skills` table to scope by workspace — `agent_runs.workspace_id`
   * alone is sufficient.
   */
  async runsTotalCounts(
    workspaceId: string,
    windowStart: Date,
    skillId?: string,
  ): Promise<Map<string, number>> {
    const conditions = [
      eq(t.agentRuns.workspaceId, workspaceId),
      gte(t.agentRuns.ranAt, windowStart),
    ];
    if (skillId) conditions.push(eq(t.agentSkills.skillId, skillId));
    const rows = await this.db
      .select({ skillId: t.agentSkills.skillId, count: count() })
      .from(t.agentSkills)
      .innerJoin(t.agentRuns, eq(t.agentRuns.agentId, t.agentSkills.agentId))
      .where(and(...conditions))
      .groupBy(t.agentSkills.skillId);
    return new Map(rows.map((r) => [r.skillId, Number(r.count)]));
  }

  /**
   * Findings from runs that had each skill in the prompt, in the window.
   * ASSOCIATION, not attribution — no column records which skill (if any)
   * caused a given finding, so a skill sitting in the prompt beside four others
   * gets credit for all five's findings. See specs/02-skill-detail-tabs.md.
   */
  async findingsCounts(
    workspaceId: string,
    windowStart: Date,
    skillId?: string,
  ): Promise<Map<string, { total: number; accepted: number; dismissed: number }>> {
    const conditions = [
      eq(t.agentRuns.workspaceId, workspaceId),
      gte(t.agentRuns.ranAt, windowStart),
    ];
    if (skillId) conditions.push(eq(t.runSkillLinks.skillId, skillId));
    const rows = await this.db
      .select({
        skillId: t.runSkillLinks.skillId,
        total: count(t.findings.id),
        // postgres-js returns bigint aggregates as strings — `Number(...)`
        // below matches the cast every other count() in this module already
        // does (e.g. `skillCounts` in the agents module).
        accepted: sql<string>`count(*) filter (where ${t.findings.acceptedAt} is not null)`,
        dismissed: sql<string>`count(*) filter (where ${t.findings.dismissedAt} is not null)`,
      })
      .from(t.runSkillLinks)
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runSkillLinks.runId))
      .innerJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .innerJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(and(...conditions))
      .groupBy(t.runSkillLinks.skillId);
    return new Map(
      rows.map((r) => [
        r.skillId,
        { total: Number(r.total), accepted: Number(r.accepted), dismissed: Number(r.dismissed) },
      ]),
    );
  }

  /** Findings-by-category for ONE skill, in the window — the Stats tab donut. */
  async categoryTally(
    workspaceId: string,
    skillId: string,
    windowStart: Date,
  ): Promise<{ category: string; count: number }[]> {
    const rows = await this.db
      .select({ category: t.findings.category, count: count() })
      .from(t.runSkillLinks)
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runSkillLinks.runId))
      .innerJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .innerJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(
        and(
          eq(t.runSkillLinks.skillId, skillId),
          eq(t.agentRuns.workspaceId, workspaceId),
          gte(t.agentRuns.ranAt, windowStart),
        ),
      )
      .groupBy(t.findings.category);
    return rows.map((r) => ({ category: r.category, count: Number(r.count) }));
  }
}
