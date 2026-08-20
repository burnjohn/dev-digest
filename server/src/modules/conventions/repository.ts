import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionStatus } from '@devdigest/shared';
import type { VerifiedCandidate } from './helpers.js';

/**
 * Conventions data-access. Owns the `conventions` table only.
 *
 * Workspace-scoped throughout; `repo_id` is nullable in the schema (a workspace
 * -wide convention is legal) but every query here is repo-scoped, because the
 * extractor only ever produces repo-scoped rows.
 */

import type { ConventionRow } from '../../db/rows.js';
export type { ConventionRow };

export class ConventionsRepository {
  constructor(private db: Db) {}

  async listForRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.confidence), desc(t.conventions.createdAt));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  /** The accepted rows behind a skill draft, in the order they were listed. */
  async listByIds(workspaceId: string, ids: string[]): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is ConventionRow => !!r);
  }

  /**
   * Replace this repo's PENDING candidates with a fresh scan's results.
   *
   * Accepted and rejected rows survive untouched — a re-scan re-proposes, it
   * does not re-litigate decisions the user already made. Not a transaction:
   * nothing in this server runs in one yet (see server/INSIGHTS.md), and the
   * worst interleaving here loses a pending row the next scan re-creates.
   */
  async replacePending(
    workspaceId: string,
    repoId: string,
    candidates: VerifiedCandidate[],
  ): Promise<ConventionRow[]> {
    await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'pending'),
        ),
      );
    if (candidates.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(
        candidates.map((c) => ({
          workspaceId,
          repoId,
          category: c.category,
          rule: c.rule,
          rationale: c.rationale,
          evidencePath: c.evidencePath,
          evidenceLine: c.evidenceLine,
          evidenceSnippet: c.evidenceSnippet,
          confidence: c.confidence,
          status: 'pending' as const,
        })),
      )
      .returning();
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { rule?: string; rationale?: string | null; status?: ConventionStatus },
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.rationale !== undefined ? { rationale: patch.rationale } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning({ id: t.conventions.id });
    return rows.length > 0;
  }
}
