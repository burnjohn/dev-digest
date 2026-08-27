import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * `context` data-access layer (R3) — the ONLY file in this module that
 * imports `drizzle-orm` (`onion-architecture` §2/§4). Every write is scoped
 * by `workspaceId`, every read by `repoId`, and every method returns row
 * types or scalars — never a query builder, an `SQL` fragment, or the `Db`
 * handle (`onion-architecture` §5 Drizzle, rule 4).
 *
 * Queries `repos`, `agents`, `skills` and `agent_skills` directly alongside
 * `context_attachments` — that is cross-TABLE access, not cross-MODULE
 * import (onion §2 rule 2 forbids importing another module's `.ts` files,
 * not querying a table another module also owns; `blast/repository.ts`'s
 * header makes the same distinction explicit).
 */

/** A discriminated union (not two optional fields) so TS narrows cleanly at every call site. */
export type OwnerId = { kind: 'agent'; id: string } | { kind: 'skill'; id: string };

function ownerCondition(owner: OwnerId) {
  return owner.kind === 'agent'
    ? eq(t.contextAttachments.agentId, owner.id)
    : eq(t.contextAttachments.skillId, owner.id);
}

export interface RepoIdentity {
  id: string;
  owner: string;
  name: string;
}

export interface AttachmentPathRow {
  path: string;
  position: number;
}

export interface SkillAttachmentRow {
  skillId: string;
  path: string;
  position: number;
}

export interface DirectUsageRow {
  path: string;
  agentId: string;
}

export interface SkillUsageRow {
  path: string;
  agentId: string;
  skillEnabled: boolean;
}

export class ContextRepository {
  constructor(private db: Db) {}

  // ---- Tenancy lookups ------------------------------------------------

  async getRepoForWorkspace(workspaceId: string, repoId: string): Promise<RepoIdentity | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, owner: t.repos.owner, name: t.repos.name })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async agentExistsInWorkspace(workspaceId: string, agentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)));
    return row !== undefined;
  }

  async skillExistsInWorkspace(workspaceId: string, skillId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)));
    return row !== undefined;
  }

  // ---- Owner attachments (GET /agents|skills/:id/context) -------------

  /** Ordered attachments for one owner (agent XOR skill), scoped to one repo — position asc, id asc (a unique, immutable last key). */
  async listAttachments(owner: OwnerId, repoId: string): Promise<AttachmentPathRow[]> {
    return this.db
      .select({ path: t.contextAttachments.path, position: t.contextAttachments.position })
      .from(t.contextAttachments)
      .where(and(ownerCondition(owner), eq(t.contextAttachments.repoId, repoId)))
      .orderBy(asc(t.contextAttachments.position), asc(t.contextAttachments.id));
  }

  /**
   * REQ-10/11/12/13 — the replace-set write: delete this owner's rows for
   * `repoId`, then insert the new ordered set, in ONE transaction under ONE
   * guard (`server/INSIGHTS.md`, 2026-08-17 — a delete-then-guarded-insert
   * split across two statements lost data on an empty-but-successful reply;
   * the fix there was one shared guard, which here is simply "both
   * statements or neither" via `db.transaction`).
   */
  async replaceAttachments(
    owner: OwnerId,
    workspaceId: string,
    repoId: string,
    paths: string[],
  ): Promise<void> {
    // Defence in depth — the DB CHECK (`context_attachments_owner_xor_check`)
    // already enforces this; the `OwnerId` discriminated union makes it
    // impossible to construct a call site that names both or neither, so
    // this can only ever fire on a value that bypassed the type system.
    if (owner.kind !== 'agent' && owner.kind !== 'skill') {
      throw new Error('replaceAttachments requires exactly one of agentId or skillId');
    }
    const cond = ownerCondition(owner);
    await this.db.transaction(async (tx) => {
      await tx.delete(t.contextAttachments).where(and(cond, eq(t.contextAttachments.repoId, repoId)));
      if (paths.length === 0) return;
      await tx.insert(t.contextAttachments).values(
        paths.map((path, index) => ({
          workspaceId,
          repoId,
          agentId: owner.kind === 'agent' ? owner.id : null,
          skillId: owner.kind === 'skill' ? owner.id : null,
          path,
          position: index,
        })),
      );
    });
  }

  // ---- REQ-18 effective-list sources -----------------------------------

  /** Source #1 of AC-18's traversal — the agent's own attachments, position order. */
  async getAgentAttachments(agentId: string, repoId: string): Promise<AttachmentPathRow[]> {
    return this.listAttachments({ kind: 'agent', id: agentId }, repoId);
  }

  /** Source #2's ordering — ids of the agent's ENABLED linked skills, in `agent_skills.order`. */
  async getEnabledLinkedSkillIds(agentId: string): Promise<string[]> {
    const rows = await this.db
      .select({ skillId: t.agentSkills.skillId })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.skills.enabled, true)))
      .orderBy(asc(t.agentSkills.order), asc(t.agentSkills.skillId));
    return rows.map((r) => r.skillId);
  }

  /** Source #2's content — every listed skill's attachments for `repoId`, position order; the caller groups by `skillId`. */
  async getSkillAttachments(skillIds: string[], repoId: string): Promise<SkillAttachmentRow[]> {
    if (skillIds.length === 0) return [];
    const rows = await this.db
      .select({
        skillId: t.contextAttachments.skillId,
        path: t.contextAttachments.path,
        position: t.contextAttachments.position,
      })
      .from(t.contextAttachments)
      .where(and(inArray(t.contextAttachments.skillId, skillIds), eq(t.contextAttachments.repoId, repoId)))
      .orderBy(asc(t.contextAttachments.position), asc(t.contextAttachments.id));
    return rows.map((r) => ({ skillId: r.skillId!, path: r.path, position: r.position }));
  }

  // ---- REQ-7 usage counts ----------------------------------------------

  /** Every (path, agentId) pair reached by a DIRECT agent attachment in `repoId`. */
  async getDirectUsage(repoId: string): Promise<DirectUsageRow[]> {
    const rows = await this.db
      .select({ path: t.contextAttachments.path, agentId: t.contextAttachments.agentId })
      .from(t.contextAttachments)
      .where(and(eq(t.contextAttachments.repoId, repoId), isNotNull(t.contextAttachments.agentId)));
    return rows.map((r) => ({ path: r.path, agentId: r.agentId! }));
  }

  /** Every (path, agentId, skillEnabled) triple reached through a SKILL attachment in `repoId` — `skills.enabled` NOT filtered (REQ-7 removes AC-18's filter). */
  async getSkillUsage(repoId: string): Promise<SkillUsageRow[]> {
    return this.db
      .select({
        path: t.contextAttachments.path,
        agentId: t.agentSkills.agentId,
        skillEnabled: t.skills.enabled,
      })
      .from(t.contextAttachments)
      .innerJoin(t.skills, eq(t.skills.id, t.contextAttachments.skillId))
      .innerJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .where(and(eq(t.contextAttachments.repoId, repoId), isNotNull(t.contextAttachments.skillId)));
  }
}
