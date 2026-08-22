import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * A1 — skills data-access. Owns `skills`, `skill_versions`, and reads
 * `agent_skills` (for used-by queries). Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: 'rubric' | 'convention' | 'security' | 'custom';
  source: 'manual' | 'imported_url' | 'extracted' | 'community';
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[];
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: 'rubric' | 'convention' | 'security' | 'custom';
  source?: 'manual' | 'imported_url' | 'extracted' | 'community';
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[];
  /** Optional version message stored in skill_versions when body changes. */
  message?: string | null;
}

export interface SkillStats {
  used_by_count: number;
  agents: { id: string; name: string }[];
  version_count: number;
  findings_by_category: Record<string, number>;
  findings_last_30d: number;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db.select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Insert a skill AND record version 1 in skill_versions. */
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
        enabled: values.enabled ?? true,
        version: 1,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    await this.db.insert(t.skillVersions).values({
      skillId: row!.id,
      version: 1,
      body: row!.body,
      message: null,
    });
    return row!;
  }

  /**
   * Update a skill. When body changes, bump version and insert into skill_versions.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.evidenceFiles !== undefined ? { evidenceFiles: patch.evidenceFiles } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) {
      await this.db.insert(t.skillVersions).values({
        skillId: row.id,
        version: nextVersion,
        body: row.body,
        message: patch.message ?? null,
      });
    }
    return row;
  }

  /** All body versions for a skill, newest first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** Restore a skill to a previous version (creates a new version entry). */
  async restore(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillRow | undefined> {
    const [versionRow] = await this.db
      .select()
      .from(t.skillVersions)
      .where(
        and(
          eq(t.skillVersions.skillId, skillId),
          eq(t.skillVersions.version, version),
        ),
      );
    if (!versionRow) return undefined;

    return this.update(workspaceId, skillId, {
      body: versionRow.body,
      message: `Restored from version ${version}`,
    });
  }

  /** Usage and finding stats for a skill. */
  async stats(skillId: string): Promise<SkillStats> {
    // used_by_count + agents
    const agentRows = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agentSkills.skillId, skillId));

    // version_count
    const [versionCountRow] = await this.db
      .select({ cnt: count() })
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId));
    const versionCount = Number(versionCountRow?.cnt ?? 0);

    // findings_by_category (last 30 days)
    const categoryRows = await this.db
      .select({ category: t.findings.category, cnt: count() })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .innerJoin(
        t.agentSkills,
        and(
          eq(t.agentSkills.agentId, sql`${t.reviews.agentId}`),
          eq(t.agentSkills.skillId, skillId),
        ),
      )
      .where(sql`${t.reviews.createdAt} >= now() - interval '30 days'`)
      .groupBy(t.findings.category);

    const findingsByCategory: Record<string, number> = {};
    let findingsLast30d = 0;
    for (const row of categoryRows) {
      const n = Number(row.cnt);
      findingsByCategory[row.category] = n;
      findingsLast30d += n;
    }

    return {
      used_by_count: agentRows.length,
      agents: agentRows,
      version_count: versionCount,
      findings_by_category: findingsByCategory,
      findings_last_30d: findingsLast30d,
    };
  }
}
