import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Transaction } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillType, SkillSource } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';
import { isBodyChange } from './helpers.js';

/**
 * A1 — skills data-access. Owns `skills` and `skill_versions`.
 *
 * It also READS `agent_skills` for the `used_by` count. That is deliberate and
 * sanctioned: the link table is owned by the agents module (see the header on
 * `modules/agents/repository.ts`), and the onion rule bans importing another
 * MODULE, not reading another module's table. Nothing here writes to it.
 *
 * Workspace-scoped throughout — every public method takes `workspaceId` and no
 * query can reach a row belonging to another tenant.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description?: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

/** A skill row plus how many agents link it. */
export interface SkillWithUsage {
  skill: SkillRow;
  usedBy: number;
}

/**
 * What a locked write decided to do, once it has seen the current row.
 *
 * `versionMessage` is only ever persisted when `bumpVersion` is true — with no
 * bump there is no snapshot row to carry it, which is exactly why a note on a
 * metadata-only save is dropped rather than rejected.
 */
export interface SkillWritePlan {
  patch: UpdateSkill;
  bumpVersion: boolean;
  versionMessage: string | null;
}

/** A resolver's verdict: apply this plan, or abort the whole write. */
export type SkillWriteResolution<TAbort> =
  | { ok: true; plan: SkillWritePlan }
  | { ok: false; reason: TAbort };

/**
 * The outcome of a locked write. Discriminated rather than `undefined` so a
 * caller can tell "no such skill" from its own abort reason — the route turns
 * the two into different 404 messages.
 */
export type SkillWriteResult<TAbort> =
  | { ok: true; row: SkillRow }
  | { ok: false; reason: TAbort | 'skill_not_found' };

export class SkillsRepository {
  constructor(private db: Db) {}

  /**
   * All skills in the workspace, each with its link count, sorted by name.
   *
   * `Skill` carries no `created_at` on the wire, so name is the only stable sort
   * the client can reproduce. A LEFT join keeps zero-link skills in the result;
   * counting `agentSkills.agentId` (not `*`) is what makes those come back as 0
   * instead of 1.
   */
  async list(workspaceId: string): Promise<SkillWithUsage[]> {
    const rows = await this.db
      .select({ skill: t.skills, usedBy: count(t.agentSkills.agentId) })
      .from(t.skills)
      .leftJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.skills.workspaceId, workspaceId))
      .groupBy(t.skills.id)
      .orderBy(asc(t.skills.name));
    return rows.map((r) => ({ skill: r.skill, usedBy: Number(r.usedBy) }));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Link count for one skill — powers the delete confirmation. */
  async usageCount(id: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, id));
    return Number(row?.n ?? 0);
  }

  /**
   * Insert a skill and its v1 body snapshot in ONE transaction.
   *
   * Both rows or neither: a skill whose `skill_versions` history is missing its
   * first entry would render an empty Versions tab forever, and there is no
   * later write that would repair it.
   */
  async insert(values: InsertSkill): Promise<SkillRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(t.skills)
        .values({
          workspaceId: values.workspaceId,
          name: values.name,
          description: values.description ?? '',
          type: values.type,
          source: values.source,
          body: values.body,
          enabled: values.enabled ?? true,
          version: INITIAL_SKILL_VERSION,
          evidenceFiles: values.evidenceFiles ?? null,
        })
        .returning();
      if (!row) throw new Error('skills insert returned no row');

      await tx.insert(t.skillVersions).values({
        skillId: row.id,
        version: INITIAL_SKILL_VERSION,
        body: row.body,
      });
      return row;
    });
  }

  /**
   * The ONE write path that may bump a skill's version, shared by `update()` and
   * `restoreVersion()`.
   *
   * The `FOR UPDATE` row lock is load-bearing, not defensive. Without it two
   * concurrent writers both read `version = 3`, both compute 4, and the second
   * insert violates the `(skill_id, version)` primary key. The tempting fix —
   * `.onConflictDoNothing()` on the snapshot, as `AgentsRepository.snapshotVersion`
   * does — is worse than the crash: it silently DROPS a version of the user's
   * text while reporting success. Serialize instead.
   *
   * That invariant is why this is extracted rather than copied. A second write
   * path that re-implemented the lock could drift from it, and silent version
   * loss is precisely the failure the paragraph above warns about.
   *
   * `resolve` is a CALLBACK, not a precomputed plan, because restore's body comes
   * from a `skill_versions` read that must happen after the lock is taken. It is
   * `private` for the same reason `tx` is: `db/client.ts` states the transaction
   * handle must never escape the callback or appear in a service signature.
   */
  private async writeLocked<TAbort>(
    workspaceId: string,
    id: string,
    resolve: (tx: Transaction, existing: SkillRow) => Promise<SkillWriteResolution<TAbort>>,
  ): Promise<SkillWriteResult<TAbort>> {
    return this.db.transaction(async (tx): Promise<SkillWriteResult<TAbort>> => {
      const [existing] = await tx
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .for('update');
      // A cross-tenant id dies HERE, before any version read — so the two abort
      // reasons below can never be used to probe another workspace.
      if (!existing) return { ok: false, reason: 'skill_not_found' };

      const resolved = await resolve(tx, existing);
      if (!resolved.ok) return resolved;
      const { patch, bumpVersion, versionMessage } = resolved.plan;

      const nextVersion = bumpVersion ? existing.version + 1 : existing.version;

      const [row] = await tx
        .update(t.skills)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.evidenceFiles !== undefined ? { evidenceFiles: patch.evidenceFiles } : {}),
          ...(bumpVersion ? { version: nextVersion } : {}),
        })
        .where(eq(t.skills.id, id))
        .returning();
      if (!row) return { ok: false, reason: 'skill_not_found' };

      if (bumpVersion) {
        await tx.insert(t.skillVersions).values({
          skillId: id,
          version: nextVersion,
          body: row.body,
          message: versionMessage,
        });
      }
      return { ok: true, row };
    });
  }

  /**
   * Update a skill, bumping the version and snapshotting ONLY when the body
   * changed. Returns `undefined` when the id does not exist in this workspace.
   *
   * A thin caller of `writeLocked` — the plan is fully known before the lock, so
   * the resolver hands it back unchanged and never aborts (hence `never`).
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
    opts: { bumpVersion: boolean; versionMessage?: string | null },
  ): Promise<SkillRow | undefined> {
    const result = await this.writeLocked<never>(workspaceId, id, async () => ({
      ok: true,
      plan: {
        patch,
        bumpVersion: opts.bumpVersion,
        versionMessage: opts.versionMessage ?? null,
      },
    }));
    return result.ok ? result.row : undefined;
  }

  /**
   * Write an OLD version's body forward as a NEW version, under the same lock a
   * save takes.
   *
   * The snapshot is read server-side, INSIDE the transaction, from the immutable
   * `(skill_id, version)` row — never taken from the caller. That is the whole
   * point of the endpoint: a client that posted a body it had cached could write
   * forward text the user never saw if someone saved in between.
   *
   * `bumpVersion` comes from `isBodyChange`, the same predicate the save path
   * uses, so "changed" has exactly one definition in this module. Restoring a
   * body identical to the current one is therefore a no-op — no bump, no
   * snapshot — which keeps "every snapshot differs from its predecessor" true.
   *
   * Deliberately does NOT re-check the restored body against
   * `MAX_SKILL_BODY_CHARS`: it passed that cap when it was written, and if the
   * cap is ever lowered, refusing a user their own prior text is worse than
   * storing it.
   */
  async restoreVersion(
    workspaceId: string,
    id: string,
    targetVersion: number,
    message: string | null,
  ): Promise<SkillWriteResult<'version_not_found'>> {
    return this.writeLocked<'version_not_found'>(workspaceId, id, async (tx, existing) => {
      const [snapshot] = await tx
        .select()
        .from(t.skillVersions)
        .where(and(eq(t.skillVersions.skillId, id), eq(t.skillVersions.version, targetVersion)));
      if (!snapshot) return { ok: false, reason: 'version_not_found' };

      const patch: UpdateSkill = { body: snapshot.body };
      return {
        ok: true,
        plan: { patch, bumpVersion: isBodyChange(existing, patch), versionMessage: message },
      };
    });
  }

  /**
   * Delete a skill. `skill_versions` and `agent_skills` both cascade
   * (`0000_init.sql`), so this silently unlinks the skill from every agent —
   * which is why the service exposes `usageCount` for the confirm dialog.
   */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /**
   * The subset of `ids` that actually belong to this workspace.
   *
   * The tenancy gate for agent↔skill linking: the agents module verifies the
   * AGENT's workspace but has no way to verify the SKILL's, so an id from
   * another tenant would otherwise be linkable — and then injected verbatim into
   * this workspace's review prompts.
   */
  async idsInWorkspace(workspaceId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.id, ids)));
    return rows.map((r) => r.id);
  }

  /**
   * Next free `order` for an agent's skill list: `max(order) + 1`.
   *
   * NOT `links.length` — link 3 skills (0,1,2), unlink the middle one, and the
   * length is 2, colliding with the existing order 2. Duplicate orders make
   * `orderBy(asc(order))` nondeterministic, which silently reshuffles the prompt
   * between runs. `coalesce(..., -1)` covers the empty case, where `max` is NULL.
   */
  async nextLinkOrder(agentId: string): Promise<number> {
    const [row] = await this.db
      .select({ maxOrder: sql<number>`coalesce(max(${t.agentSkills.order}), -1)` })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agentId));
    return Number(row?.maxOrder ?? -1) + 1;
  }
}
