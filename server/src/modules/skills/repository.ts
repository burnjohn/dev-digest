import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillType, SkillSource } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';

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
   * Update a skill, bumping the version and snapshotting ONLY when the body
   * changed. Returns `undefined` when the id does not exist in this workspace.
   *
   * The `FOR UPDATE` row lock is load-bearing, not defensive. Without it two
   * concurrent PUTs both read `version = 3`, both compute 4, and the second
   * insert violates the `(skill_id, version)` primary key. The tempting fix —
   * `.onConflictDoNothing()` on the snapshot, as `AgentsRepository.snapshotVersion`
   * does — is worse than the crash: it silently DROPS a version of the user's
   * text while reporting success. Serialize instead.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
    opts: { bumpVersion: boolean },
  ): Promise<SkillRow | undefined> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .for('update');
      if (!existing) return undefined;

      const nextVersion = opts.bumpVersion ? existing.version + 1 : existing.version;

      const [row] = await tx
        .update(t.skills)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.evidenceFiles !== undefined ? { evidenceFiles: patch.evidenceFiles } : {}),
          ...(opts.bumpVersion ? { version: nextVersion } : {}),
        })
        .where(eq(t.skills.id, id))
        .returning();
      if (!row) return undefined;

      if (opts.bumpVersion) {
        await tx.insert(t.skillVersions).values({
          skillId: id,
          version: nextVersion,
          body: row.body,
        });
      }
      return row;
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
