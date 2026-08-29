import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Transaction } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { DEFAULT_AGENT_DESCRIPTION, INITIAL_AGENT_VERSION } from './constants.js';
import { AgentVersionConfig } from '@devdigest/shared';
import { isConfigChange, isRestoreChange } from './helpers.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow, SkillRow } from '../../db/rows.js';
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
  skill: SkillRow;
  order: number;
}

export class AgentsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }

  /**
   * Agents with their linked-skill counts, for the list screen's cards.
   *
   * A LEFT join + `groupBy` rather than N calls to `/agents/:id/skills` — the
   * cards render the number, they don't need the links. Counting
   * `agentSkills.skillId` (not `*`) keeps a skill-less agent at 0, not 1.
   */
  async listWithSkillCounts(workspaceId: string): Promise<{ agent: AgentRow; skillCount: number }[]> {
    const rows = await this.db
      .select({ agent: t.agents, skillCount: count(t.agentSkills.skillId) })
      .from(t.agents)
      .leftJoin(t.agentSkills, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .groupBy(t.agents.id);
    return rows.map((r) => ({ agent: r.agent, skillCount: Number(r.skillCount) }));
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

  /**
   * Delete an agent (scoped to workspace) AND every `eval_cases` / `eval_run_batches`
   * row owned by it (REQ-41), in ONE transaction — a failure leaves neither half
   * applied. `agent_versions` / `agent_skills` cascade via FK; `agent_runs` keep
   * their history with `agent_id` set null.
   *
   * Lives here, not in `modules/evals/repository.ts`: R2 (`AgentsService`) may
   * not import another module's anything, so the eval side of this delete has to
   * be R3 code that already has `db/**` on its import allowlist — this repository.
   * `eval_cases` goes first (its `eval_runs` cascade with it), then
   * `eval_run_batches` — the forward order needs no FK rescue, unlike the reverse.
   *
   * Both eval tables are scoped by `workspaceId` AND `ownerId`, exactly like the
   * agent delete below, so a cross-workspace id matches zero rows in all three
   * deletes and nothing is touched — the transaction still returns `deleted: false`.
   *
   * Returns `deletedCases` (the count for the response's optional field) and
   * `deleted` (false if no such agent existed in the workspace).
   */
  async deleteById(
    workspaceId: string,
    id: string,
  ): Promise<{ deleted: boolean; deletedCases: number }> {
    return this.db.transaction(async (tx) => {
      const deletedCases = await tx
        .delete(t.evalCases)
        .where(
          and(
            eq(t.evalCases.workspaceId, workspaceId),
            eq(t.evalCases.ownerKind, 'agent'),
            eq(t.evalCases.ownerId, id),
          ),
        )
        .returning({ id: t.evalCases.id });

      await tx
        .delete(t.evalRunBatches)
        .where(
          and(
            eq(t.evalRunBatches.workspaceId, workspaceId),
            eq(t.evalRunBatches.ownerKind, 'agent'),
            eq(t.evalRunBatches.ownerId, id),
          ),
        );

      const rows = await tx
        .delete(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
        .returning({ id: t.agents.id });

      return { deleted: rows.length > 0, deletedCases: deletedCases.length };
    });
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
   * config into agent_versions (reproducibility for eval).
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
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

    if (configChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  /**
   * Write the immutable config snapshot for `version`.
   *
   * This used to end in `.onConflictDoNothing()`, which turned a genuine
   * "version already snapshotted" collision into a silent no-op — losing a
   * snapshot while reporting success, and defeating the reproducibility that
   * `agent_versions` exists for. It now surfaces. Callers hold a row lock (see
   * `setSkills`) or compute the version from a row they just wrote, so a
   * collision here means a real bug, not contention.
   */
  private async snapshotVersion(
    row: AgentRow,
    version: number,
    tx: Db | Transaction = this.db,
  ): Promise<void> {
    const skills = await this.skillIdsForAgent(row.id, tx);
    await tx.insert(t.agentVersions).values({
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
    });
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
  async linkedSkills(agentId: string, tx: Db | Transaction = this.db): Promise<LinkedSkillRow[]> {
    const rows = await tx
      .select({ skill: t.skills, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => ({ skill: r.skill, order: r.order }));
  }

  async skillIdsForAgent(agentId: string, tx: Db | Transaction = this.db): Promise<string[]> {
    const links = await this.linkedSkills(agentId, tx);
    return links.map((l) => l.skill.id);
  }

  /**
   * Of `skillIds`, the ones that exist in `workspaceId`.
   *
   * The tenancy gate for linking. `agent_skills.skill_id` has an FK to `skills`
   * but no workspace column, so without this check a caller could post another
   * tenant's skill id and have its body injected verbatim into this workspace's
   * review prompts. Reading the `skills` table from here is fine — the onion rule
   * forbids importing another MODULE, not reading its table.
   */
  async skillIdsInWorkspace(
    workspaceId: string,
    skillIds: string[],
    tx: Db | Transaction = this.db,
  ): Promise<string[]> {
    if (skillIds.length === 0) return [];
    const rows = await tx
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.id, skillIds)));
    return rows.map((r) => r.id);
  }

  /**
   * Next free order for an agent's list: `max(order) + 1`.
   *
   * NOT `links.length`: link 3 skills (0,1,2), unlink the middle one, and the
   * length is 2 — colliding with the surviving order 2. Duplicate orders make
   * `orderBy(asc(order))` nondeterministic, silently reshuffling the prompt
   * between runs and destroying review reproducibility. `coalesce(…, -1)` handles
   * the no-links case, where `max` is NULL and would otherwise write NULL into a
   * NOT NULL column.
   */
  async nextLinkOrder(agentId: string, tx: Db | Transaction = this.db): Promise<number> {
    const [row] = await tx
      .select({ maxOrder: sql<number>`coalesce(max(${t.agentSkills.order}), -1)` })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agentId));
    return Number(row?.maxOrder ?? -1) + 1;
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
   * Replace the full set of linked skills for an agent with `skillIds`, in that
   * order, and snapshot a new agent version.
   *
   * ONE transaction, for two independent reasons:
   *  1. It was a bare delete-then-insert. A single bad uuid failed the insert on
   *     the FK *after* the delete had committed, leaving the agent with NO links —
   *     silent data loss on a validation error.
   *  2. The link set is part of `agent_versions.config_json.skills`, so changing
   *     it changes the agent's effective prompt. Bumping the version here is what
   *     keeps `agent_versions` an honest record of "what this agent was" — without
   *     it, the prompt could change with no new version at all.
   *
   * Returns the new version, or undefined if the agent vanished mid-flight.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<number | undefined> {
    return this.db.transaction(async (tx) => {
      // Lock the agent row first: the version bump below is a read-modify-write,
      // and two concurrent saves would otherwise compute the same next version.
      const [agent] = await tx
        .select()
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
        .for('update');
      if (!agent) return undefined;

      await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
      if (skillIds.length > 0) {
        await tx
          .insert(t.agentSkills)
          .values(skillIds.map((skillId, i) => ({ agentId, skillId, order: i })));
      }

      const nextVersion = agent.version + 1;
      const [updated] = await tx
        .update(t.agents)
        .set({ version: nextVersion })
        .where(eq(t.agents.id, agentId))
        .returning();
      if (updated) await this.snapshotVersion(updated, nextVersion, tx);
      return nextVersion;
    });
  }

  /**
   * Write an OLD version's config forward as a NEW version, under the same row
   * lock a save takes. Backs `POST /agents/:id/restore` (the compare modal's
   * `Promote vN`).
   *
   * The snapshot is read server-side, INSIDE the transaction, from the immutable
   * `(agent_id, version)` row — never taken from the caller. That is the whole
   * point of the endpoint: a client that posted a config it had cached could
   * write forward a prompt the user never saw if someone saved in between.
   *
   * The agent row is locked FIRST because the version bump is a read-modify-write
   * — the same reason `setSkills` locks it. `agent_skills` is replaced from
   * `config_json.skills` BEFORE `snapshotVersion` runs, because that method
   * re-reads the links to build the new snapshot; snapshotting first would record
   * the outgoing link set against the incoming config.
   *
   * `isRestoreChange` (NOT `isConfigChange` — see its doc) makes restoring the
   * config the agent already has a no-op: no bump, no snapshot, no link churn.
   * That keeps "every snapshot differs from its predecessor" true.
   *
   * Skill ids come from a snapshot this workspace wrote, so they were already
   * gated by `AgentsService.assertSkillsInWorkspace` when first linked; a skill
   * deleted since then fails the FK and rolls the whole restore back rather than
   * half-applying it.
   */
  async restoreVersion(
    workspaceId: string,
    id: string,
    targetVersion: number,
  ): Promise<
    { ok: true; row: AgentRow } | { ok: false; reason: 'agent_not_found' | 'version_not_found' }
  > {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
        .for('update');
      // A foreign id fails HERE, before any version is read, so cross-tenant
      // probing can never tell "wrong workspace" from "no such agent".
      if (!existing) return { ok: false as const, reason: 'agent_not_found' as const };

      const [snapshotRow] = await tx
        .select()
        .from(t.agentVersions)
        .where(and(eq(t.agentVersions.agentId, id), eq(t.agentVersions.version, targetVersion)));
      if (!snapshotRow) return { ok: false as const, reason: 'version_not_found' as const };

      const snapshot = AgentVersionConfig.parse(snapshotRow.configJson);
      const currentSkillIds = await this.skillIdsForAgent(id, tx);
      if (!isRestoreChange(existing, snapshot, currentSkillIds)) {
        return { ok: true as const, row: existing };
      }

      await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, id));
      if (snapshot.skills.length > 0) {
        await tx
          .insert(t.agentSkills)
          .values(snapshot.skills.map((skillId, i) => ({ agentId: id, skillId, order: i })));
      }

      const nextVersion = existing.version + 1;
      const [row] = await tx
        .update(t.agents)
        .set({
          provider: snapshot.provider,
          model: snapshot.model,
          systemPrompt: snapshot.system_prompt,
          outputSchema: (snapshot.output_schema ?? null) as object | null,
          strategy: snapshot.strategy,
          ciFailOn: snapshot.ci_fail_on,
          repoIntel: snapshot.repo_intel,
          version: nextVersion,
        })
        .where(eq(t.agents.id, id))
        .returning();
      await this.snapshotVersion(row!, nextVersion, tx);
      return { ok: true as const, row: row! };
    });
  }
}
