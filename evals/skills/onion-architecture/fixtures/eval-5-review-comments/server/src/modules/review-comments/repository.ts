import { and, eq, desc } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type CommentRow = typeof t.comments.$inferSelect;
export type CommentThreadRow = {
  findingId: string;
  commentCount: number;
  lastActivityAt: Date;
  resolved: boolean;
};

export class CommentRepository {
  constructor(private db: Db) {}

  async listForFinding(findingId: string): Promise<CommentRow[]> {
    return this.db
      .select()
      .from(t.comments)
      .where(eq(t.comments.findingId, findingId))
      .orderBy(desc(t.comments.createdAt));
  }

  async insert(findingId: string, authorId: string, body: string): Promise<CommentRow> {
    const [row] = await this.db
      .insert(t.comments)
      .values({ findingId, authorId, body })
      .returning();
    return row;
  }

  async markResolved(commentId: string): Promise<void> {
    await this.db.update(t.comments).set({ resolved: true }).where(eq(t.comments.id, commentId));
  }
}
