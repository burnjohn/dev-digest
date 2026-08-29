import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export class CommentRepository {
  constructor(private db: Db) {}

  async listSince(workspaceId: string, since: Date) {
    return this.db
      .select()
      .from(t.comments)
      .where(and(eq(t.comments.workspaceId, workspaceId), gte(t.comments.createdAt, since)));
  }
}
