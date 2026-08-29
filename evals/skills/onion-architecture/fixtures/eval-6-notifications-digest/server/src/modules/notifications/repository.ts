import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type DigestPrefsRow = typeof t.digestPreferences.$inferSelect;

export class DigestPreferencesRepository {
  constructor(private db: Db) {}

  async getForWorkspace(workspaceId: string): Promise<DigestPrefsRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.digestPreferences)
      .where(eq(t.digestPreferences.workspaceId, workspaceId));
    return row;
  }
}
