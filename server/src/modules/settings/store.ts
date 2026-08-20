import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Upsert a bag of settings keys ATOMICALLY and return the workspace's rows.
 * A partial PUT must never half-apply: either every key lands or none does.
 *
 * NOTE on ownership: the settings module has no application layer /
 * unit-of-work port yet, so this persistence helper (the adapter) owns
 * `db.transaction` directly; a unit-of-work port takes this over when the
 * module migrates to the onion layout.
 */
export async function upsertSettings(
  db: Db,
  workspaceId: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<(typeof t.settings.$inferSelect)[]> {
  return db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(body)) {
      await tx
        .insert(t.settings)
        .values({ workspaceId, userId, key, value })
        .onConflictDoUpdate({
          target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
          set: { value },
        });
    }
    return tx.select().from(t.settings).where(eq(t.settings.workspaceId, workspaceId));
  });
}
