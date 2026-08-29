import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type TagRow = typeof t.tags.$inferSelect;

export class TagRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<TagRow[]> {
    return this.db.select().from(t.tags).where(eq(t.tags.workspaceId, workspaceId));
  }

  async create(workspaceId: string, name: string): Promise<TagRow> {
    const [row] = await this.db.insert(t.tags).values({ workspaceId, name }).returning();
    return row;
  }
}
