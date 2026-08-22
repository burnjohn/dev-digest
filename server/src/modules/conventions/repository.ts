import { eq, and } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { conventions } from '../../db/schema.js';
import type { ConventionRow } from '../../db/rows.js';

export class ConventionsRepository {
  constructor(private readonly db: Db) {}

  async insertBatch(
    rows: Array<{
      workspaceId: string;
      repoId: string;
      category: string;
      rule: string;
      evidencePath: string;
      evidenceSnippet: string;
      confidence: number;
    }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.db.insert(conventions).values(rows);
  }

  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(conventions)
      .where(and(eq(conventions.workspaceId, workspaceId), eq(conventions.repoId, repoId)))
      .orderBy(conventions.id);
  }

  async update(
    id: string,
    patch: { rule?: string; category?: string; accepted?: boolean },
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(conventions)
      .set(patch)
      .where(eq(conventions.id, id))
      .returning();
    return row;
  }

  async deleteByRepo(workspaceId: string, repoId: string): Promise<void> {
    await this.db
      .delete(conventions)
      .where(and(eq(conventions.workspaceId, workspaceId), eq(conventions.repoId, repoId)));
  }
}
