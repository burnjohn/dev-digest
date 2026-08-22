import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import * as t from "../../db/schema.js";
import type { ConventionRow } from "../../db/rows.js";
export type { ConventionRow };

export class ConventionsRepository {
  constructor(private db: Db) {}

  /** Всі конвенції репо: accepted першими, потім по confidence desc */
  async listByRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionRow[]> {
    const rows = await this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
        ),
      );
    return rows.sort((a, b) => {
      if (a.accepted !== b.accepted) return a.accepted ? -1 : 1;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });
  }

  /**
   * Re-scan: видаляємо всі старі конвенції репо і вставляємо нові.
   * Так при кожному скані маємо свіжі результати.
   */
  async replaceAll(
    workspaceId: string,
    repoId: string,
    candidates: Array<{
      rule: string;
      evidencePath: string;
      evidenceSnippet: string;
      confidence: number;
    }>,
  ): Promise<ConventionRow[]> {
    await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
        ),
      );

    if (candidates.length === 0) return [];

    const rows = await this.db
      .insert(t.conventions)
      .values(
        candidates.map((c) => ({
          workspaceId,
          repoId,
          rule: c.rule,
          evidencePath: c.evidencePath,
          evidenceSnippet: c.evidenceSnippet,
          confidence: c.confidence,
          accepted: false,
        })),
      )
      .returning();

    return rows;
  }

  /** Accept: позначаємо як прийняту */
  async accept(
    workspaceId: string,
    id: string,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ accepted: true })
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.id, id),
        ),
      )
      .returning();
    return row;
  }

  /** Reject = фізично видаляємо */
  async reject(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.id, id),
        ),
      )
      .returning({ id: t.conventions.id });
    return rows.length > 0;
  }

  /** Inline edit: оновити текст правила */
  async updateRule(
    workspaceId: string,
    id: string,
    rule: string,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ rule })
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.id, id),
        ),
      )
      .returning();
    return row;
  }

  /** Тільки accepted — для створення скіла */
  async listAccepted(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.accepted, true),
        ),
      );
  }
}
