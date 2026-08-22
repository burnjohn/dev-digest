import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export async function getSettingsRows(
  db: Db,
  workspaceId: string,
): Promise<Array<{ key: string; value: unknown }>> {
  const rows = await db
    .select()
    .from(t.settings)
    .where(eq(t.settings.workspaceId, workspaceId));
  return rows.map((r) => ({ key: r.key, value: r.value }));
}

export async function upsertSettingKv(
  db: Db,
  workspaceId: string,
  userId: string,
  key: string,
  value: unknown,
): Promise<void> {
  await db
    .insert(t.settings)
    .values({ workspaceId, userId, key, value })
    .onConflictDoUpdate({
      target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
      set: { value },
    });
}
