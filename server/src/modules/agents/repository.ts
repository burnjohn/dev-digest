import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { DEFAULT_AGENT_DESCRIPTION, INITIAL_AGENT_VERSION } from './constants.js';
import { isConfigChange } from './helpers.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
export type { AgentRow, AgentVersionRow };

export interface InsertAgent {
  workspaceId: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

/** A skill linked to an agent (with its order), joined from agent_skills. */
export interface LinkedSkillRow {
  skill: typeof t.skills.$inferSelect;
  order: number;
}

export class AgentsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
  }

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /** Delete an agent (scoped to workspace). Versions/skill-links cascade;
   *  agent_runs keep their history with agent_id set null. Returns false if
   *  no such agent existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning({ id: t.agents.id });
    return rows.length > 0;
  }

  /** Insert an agent AND record version 1 in agent_versions (immutable snapshot). */
  async insert(values: InsertAgent): Promise<AgentRow> {
    const [row] = await this.db
      .insert(t.agents)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
        provider: values.provider,
        model: values.model,
        systemPrompt: values.systemPrompt,
        outputSchema: (values.outputSchema as object | undefined) ?? null,
        ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
        ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
        ...(values.repoIntel !== undefined ? { repoIntel: values.repoIntel } : {}),
        enabled: values.enabled ?? true,
        version: INITIAL_AGENT_VERSION,
        createdBy: values.createdBy ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_AGENT_VERSION);
    return row!;
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval). The optional
   * `promote` argument marks the resulting version snapshot's provenance
   * (Agent Eval Dashboard promote-from-batch flow); omitted for every ordinary
   * caller (agent creation, normal config edits), which defaults to 'manual'.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
    promote?: { sourceBatchId: string },
  ): Promise<AgentRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    // A config-affecting change (anything except just toggling enabled) bumps version.
    const configChanged = isConfigChange(existing, patch);
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.agents)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
        ...(patch.outputSchema !== undefined
          ? { outputSchema: patch.outputSchema as object }
          : {}),
        ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
        ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
        ...(patch.repoIntel !== undefined ? { repoIntel: patch.repoIntel } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning();

    if (configChanged && row) {
      await this.snapshotVersion(
        row,
        nextVersion,
        promote ? { source: 'eval_promote', sourceBatchId: promote.sourceBatchId } : undefined,
      );
    }
    return row;
  }

  private async snapshotVersion(
    row: AgentRow,
    version: number,
    provenance?: { source: 'eval_promote'; sourceBatchId: string },
  ): Promise<void> {
    const skills = await this.skillIdsForAgent(row.id);
    await this.db
      .insert(t.agentVersions)
      .values({
        agentId: row.id,
        version,
        configJson: {
          provider: row.provider,
          model: row.model,
          system_prompt: row.systemPrompt,
          output_schema: row.outputSchema,
          strategy: row.strategy,
          ci_fail_on: row.ciFailOn,
          repo_intel: row.repoIntel,
          skills,
        },
        source: provenance?.source ?? 'manual',
        sourceBatchId: provenance?.sourceBatchId ?? null,
      })
      .onConflictDoNothing();
  }

  /**
   * Promote an eval batch's frozen system-prompt snapshot onto this agent
   * (Agent Eval Dashboard). A system-prompt change always qualifies as a
   * config change (`isConfigChange`), so this reuses the existing `update()`
   * version-bump/snapshot path unchanged — only the version row's provenance
   * differs (`source: 'eval_promote'`, `source_batch_id: sourceBatchId`).
   */
  async promoteSystemPrompt(
    workspaceId: string,
    agentId: string,
    newSystemPrompt: string,
    sourceBatchId: string,
  ): Promise<AgentRow | undefined> {
    return this.update(workspaceId, agentId, { systemPrompt: newSystemPrompt }, { sourceBatchId });
  }

  // ---- agent_versions (immutable config snapshots) ------------------------

  /** All config snapshots for an agent, newest version first. */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    return this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
  }

  /** A single config snapshot, or undefined if that version was never recorded. */
  async getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    return row;
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Skills linked to an agent, in `order` ascending. */
  async linkedSkills(agentId: string): Promise<LinkedSkillRow[]> {
    const rows = await this.db
      .select({ skill: t.skills, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => ({ skill: r.skill, order: r.order }));
  }

  async skillIdsForAgent(agentId: string): Promise<string[]> {
    const links = await this.linkedSkills(agentId);
    return links.map((l) => l.skill.id);
  }

  /** Link a skill to an agent at a given order (idempotent: upserts order). */
  async linkSkill(agentId: string, skillId: string, order: number): Promise<void> {
    await this.db
      .insert(t.agentSkills)
      .values({ agentId, skillId, order })
      .onConflictDoUpdate({
        target: [t.agentSkills.agentId, t.agentSkills.skillId],
        set: { order },
      });
  }

  async unlinkSkill(agentId: string, skillId: string): Promise<void> {
    await this.db
      .delete(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId)));
  }

  /**
   * Replace the full set of linked skills for an agent with `skillIds`, assigning
   * order = index. Used by the "Skills" editor tab (attach/reorder). Skills not in
   * the list are unlinked.
   */
  async setSkills(agentId: string, skillIds: string[]): Promise<void> {
    await this.db.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
    if (skillIds.length === 0) return;
    await this.db
      .insert(t.agentSkills)
      .values(skillIds.map((skillId, i) => ({ agentId, skillId, order: i })));
  }

  // ---- usage stats (Agents list card footer) -----------------------------

  /** Run count + avg cost per agent, from `agent_runs` (workspace-scoped).
   *  avgCostUsd is null when no run in the group reported a cost. */
  async runStatsByAgent(
    workspaceId: string,
  ): Promise<Map<string, { runs: number; avgCostUsd: number | null }>> {
    const rows = await this.db
      .select({
        agentId: t.agentRuns.agentId,
        runs: sql<number>`count(*)::int`,
        avgCostUsd: sql<number | null>`avg(${t.agentRuns.costUsd})`,
      })
      .from(t.agentRuns)
      .where(eq(t.agentRuns.workspaceId, workspaceId))
      .groupBy(t.agentRuns.agentId);
    const map = new Map<string, { runs: number; avgCostUsd: number | null }>();
    for (const r of rows) {
      if (!r.agentId) continue; // runs whose agent was deleted (agent_id set null)
      map.set(r.agentId, {
        runs: r.runs,
        avgCostUsd: r.avgCostUsd == null ? null : Number(r.avgCostUsd),
      });
    }
    return map;
  }

  /** Accepted / dismissed finding counts per agent, joined findings → reviews
   *  (workspace-scoped via reviews). Drives the accept-rate on the card. */
  async acceptanceByAgent(
    workspaceId: string,
  ): Promise<Map<string, { accepted: number; dismissed: number }>> {
    const rows = await this.db
      .select({
        agentId: t.reviews.agentId,
        accepted: sql<number>`count(*) filter (where ${t.findings.acceptedAt} is not null)::int`,
        dismissed: sql<number>`count(*) filter (where ${t.findings.dismissedAt} is not null)::int`,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(eq(t.reviews.workspaceId, workspaceId))
      .groupBy(t.reviews.agentId);
    const map = new Map<string, { accepted: number; dismissed: number }>();
    for (const r of rows) {
      if (!r.agentId) continue;
      map.set(r.agentId, { accepted: r.accepted, dismissed: r.dismissed });
    }
    return map;
  }

  /** Linked-skill count per agent for this workspace (agent_skills grouped). */
  async skillCountByAgent(workspaceId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({
        agentId: t.agentSkills.agentId,
        count: sql<number>`count(*)::int`,
      })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .groupBy(t.agentSkills.agentId);
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.agentId, r.count);
    return map;
  }
}
