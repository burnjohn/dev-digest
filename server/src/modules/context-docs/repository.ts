import { and, asc, eq, sql } from 'drizzle-orm';
import { union } from 'drizzle-orm/pg-core';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { DEFAULT_CONTEXT_FOLDERS } from './constants.js';

/**
 * ContextDocsRepository — data access for the context-docs module.
 *
 * Owns three concerns:
 *  - repo root-folder config (`repos.context_folders`, workspace-scoped)
 *  - agent/skill attachment link rows (`agent_context_docs` / `skill_context_docs`)
 *  - `used_by_agents` aggregation across both link tables
 *
 * `agent_context_docs` / `skill_context_docs` intentionally have NO direct
 * `workspace_id` column (mirrors `agent_skills`) — tenancy is enforced
 * transitively through the owning `agent_id`/`skill_id` FK, whose row IS
 * workspace-scoped. Every query here that touches those tables joins through
 * `agents`/`skills` and filters on `workspace_id`.
 */
export class ContextDocsRepository {
  constructor(private db: Db) {}

  // ---- repo root-folder config -------------------------------------------

  /**
   * Workspace-scoped repo lookup for discovery: clone path + owner/name (for
   * `RepoRef`) + the effective context folders (falls back to the default set
   * when `context_folders` is null). Returns `undefined` when the repo does
   * not exist or belongs to a different workspace (→ service throws 404).
   */
  async getRepoForDiscovery(
    workspaceId: string,
    repoId: string,
  ): Promise<
    | {
        clonePath: string | null;
        owner: string;
        name: string;
        folders: string[];
      }
    | undefined
  > {
    const rows = await this.db
      .select({
        clonePath: t.repos.clonePath,
        owner: t.repos.owner,
        name: t.repos.name,
        contextFolders: t.repos.contextFolders,
      })
      .from(t.repos)
      .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, workspaceId)))
      .limit(1);

    const row = rows[0];
    if (!row) return undefined;

    return {
      clonePath: row.clonePath,
      owner: row.owner,
      name: row.name,
      folders: row.contextFolders ?? [...DEFAULT_CONTEXT_FOLDERS],
    };
  }

  /**
   * Effective context folders for a repo (default set when unconfigured).
   * Workspace-scoped. Returns `undefined` when the repo is missing/cross-workspace.
   */
  async getContextFolders(workspaceId: string, repoId: string): Promise<string[] | undefined> {
    const rows = await this.db
      .select({ contextFolders: t.repos.contextFolders })
      .from(t.repos)
      .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, workspaceId)))
      .limit(1);

    const row = rows[0];
    if (!row) return undefined;
    return row.contextFolders ?? [...DEFAULT_CONTEXT_FOLDERS];
  }

  /**
   * Update a repo's configured root folders. Workspace-scoped; returns
   * `false` when no row matched (repo missing/cross-workspace → service
   * throws `NotFoundError`).
   */
  async setContextFolders(
    workspaceId: string,
    repoId: string,
    folders: string[],
  ): Promise<boolean> {
    const rows = await this.db
      .update(t.repos)
      .set({ contextFolders: folders })
      .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, workspaceId)))
      .returning({ id: t.repos.id });

    return rows.length > 0;
  }

  // ---- agent-side attachments ---------------------------------------------

  async agentAttachments(agentId: string): Promise<{ path: string; order: number }[]> {
    const rows = await this.db
      .select({ path: t.agentContextDocs.path, order: t.agentContextDocs.order })
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agentId))
      .orderBy(asc(t.agentContextDocs.order));
    return rows;
  }

  /**
   * Replace the full set of attached document paths for an agent, assigning
   * order = index (mirrors `AgentsRepository.setSkills`). Deduped
   * (order-preserving) before insert — a duplicate path would otherwise
   * violate the `(agent_id, path)` composite PK on the insert AFTER the
   * delete already committed, wiping the agent's attachments and 500ing.
   */
  async setAgentAttachments(agentId: string, paths: string[]): Promise<void> {
    const deduped = [...new Map(paths.map((p) => [p, p])).values()];
    await this.db.delete(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agentId));
    if (deduped.length === 0) return;
    await this.db
      .insert(t.agentContextDocs)
      .values(deduped.map((path, i) => ({ agentId, path, order: i })));
  }

  // ---- skill-side attachments ----------------------------------------------

  async skillAttachments(skillId: string): Promise<{ path: string; order: number }[]> {
    const rows = await this.db
      .select({ path: t.skillContextDocs.path, order: t.skillContextDocs.order })
      .from(t.skillContextDocs)
      .where(eq(t.skillContextDocs.skillId, skillId))
      .orderBy(asc(t.skillContextDocs.order));
    return rows;
  }

  /**
   * Replace the full set of attached document paths for a skill. Deduped
   * (order-preserving) before insert — see `setAgentAttachments` for why.
   */
  async setSkillAttachments(skillId: string, paths: string[]): Promise<void> {
    const deduped = [...new Map(paths.map((p) => [p, p])).values()];
    await this.db.delete(t.skillContextDocs).where(eq(t.skillContextDocs.skillId, skillId));
    if (deduped.length === 0) return;
    await this.db
      .insert(t.skillContextDocs)
      .values(deduped.map((path, i) => ({ skillId, path, order: i })));
  }

  // ---- document overlays (v2) ---------------------------------------------
  //
  // `doc_overrides` has NO direct `workspace_id` column (same documented
  // exception as the link tables above). Each of the four methods below is
  // called from `service.ts` ONLY after the repo has already been
  // workspace-validated via `getRepoForDiscovery(workspaceId, repoId)` (which
  // 404s cross-workspace). Do NOT add a redundant `repos` join here — the guard
  // already happened one call up, exactly like the agent/skill attachment
  // methods.

  /** The overlay body + version for a `(repo, path)`, or `undefined` if none. */
  async getOverlay(
    repoId: string,
    docPath: string,
  ): Promise<{ body: string; version: number } | undefined> {
    const rows = await this.db
      .select({ body: t.docOverrides.body, version: t.docOverrides.version })
      .from(t.docOverrides)
      .where(and(eq(t.docOverrides.repoId, repoId), eq(t.docOverrides.path, docPath)))
      .limit(1);
    return rows[0];
  }

  /** All overlay rows for a repo (used to merge onto the clone inventory). */
  async listOverlays(repoId: string): Promise<{ path: string; body: string }[]> {
    return this.db
      .select({ path: t.docOverrides.path, body: t.docOverrides.body })
      .from(t.docOverrides)
      .where(eq(t.docOverrides.repoId, repoId));
  }

  /**
   * Create-or-update an overlay for a `(repo, path)`, bumping `version` on
   * conflict (last-write-wins, race-safe). Returns the new version.
   */
  async upsertOverlay(repoId: string, docPath: string, body: string): Promise<{ version: number }> {
    const rows = await this.db
      .insert(t.docOverrides)
      .values({ repoId, path: docPath, body })
      .onConflictDoUpdate({
        target: [t.docOverrides.repoId, t.docOverrides.path],
        set: { body, version: sql`${t.docOverrides.version} + 1` },
      })
      .returning({ version: t.docOverrides.version });
    return rows[0]!;
  }

  /** Delete an overlay row. Returns `true` if a row was removed. */
  async deleteOverlay(repoId: string, docPath: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.docOverrides)
      .where(and(eq(t.docOverrides.repoId, repoId), eq(t.docOverrides.path, docPath)))
      .returning({ id: t.docOverrides.id });
    return rows.length > 0;
  }

  /**
   * Total agent count for a workspace — the coverage denominator (AC-28). No
   * `enabled` filter (matches the `used_by_agents` universe). Already
   * workspace-scoped via `agents.workspace_id`, same pattern as `usedByCounts`.
   */
  async countWorkspaceAgents(workspaceId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId));
    return Number(rows[0]?.count ?? 0);
  }

  // ---- used-by aggregation --------------------------------------------------

  /**
   * Map of document path → count of DISTINCT agents (in this workspace) that
   * use it, either via a direct agent attachment or via an attached, enabled-
   * or-not skill linked to the agent. Both sub-queries are scoped through
   * `agents.workspace_id` (agents are always workspace-owned).
   */
  async usedByCounts(workspaceId: string): Promise<Map<string, number>> {
    // Direct agent attachments, scoped through agents.workspace_id.
    const direct = this.db
      .select({
        path: t.agentContextDocs.path,
        agentId: t.agentContextDocs.agentId,
      })
      .from(t.agentContextDocs)
      .innerJoin(t.agents, eq(t.agents.id, t.agentContextDocs.agentId))
      .where(eq(t.agents.workspaceId, workspaceId));

    // Skill-derived attachments: skill attached to a doc -> agent linked to
    // that skill via agent_skills -> agent must be in this workspace.
    const viaSkill = this.db
      .select({
        path: t.skillContextDocs.path,
        agentId: t.agentSkills.agentId,
      })
      .from(t.skillContextDocs)
      .innerJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skillContextDocs.skillId))
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(eq(t.agents.workspaceId, workspaceId));

    const combined = union(direct, viaSkill).as('combined');

    const rows = await this.db
      .select({
        path: combined.path,
        agentCount: sql<number>`count(distinct ${combined.agentId})::int`,
      })
      .from(combined)
      .groupBy(combined.path);

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.path, Number(row.agentCount));
    }
    return map;
  }
}
