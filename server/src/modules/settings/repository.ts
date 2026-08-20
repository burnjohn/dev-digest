import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * F1 — settings data-access. The ONLY place that touches the `settings` table.
 * Prefs are stored as key/value rows scoped by workspace + user.
 *
 * SECRETS ARE NOT HERE: API keys and the GitHub token go through
 * SecretsProvider, never this table — see server/CLAUDE.md.
 */

export type { SettingRow } from '../../db/rows.js';
import type { SettingRow } from '../../db/rows.js';

export class SettingsRepository {
  constructor(private db: Db) {}

  /** Every pref row for a workspace (the caller folds them into an object). */
  listForWorkspace(workspaceId: string): Promise<SettingRow[]> {
    return this.db.select().from(t.settings).where(eq(t.settings.workspaceId, workspaceId));
  }

  /**
   * Upsert one pref. Idempotent on (workspace, user, key) so a PUT of the same
   * value is a no-op rather than a duplicate row.
   */
  async upsert(
    workspaceId: string,
    userId: string,
    key: string,
    /** `settings.value` is `jsonb` — a pref is arbitrary JSON, not a string. */
    value: unknown,
  ): Promise<void> {
    await this.db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoUpdate({
        target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
        set: { value },
      });
  }

  /**
   * Upsert a whole preference patch in ONE transaction — a partial payload must
   * land whole or not at all, never as a half-applied bag on a mid-loop failure.
   * (The adapter owns db.transaction until this module grows a unit-of-work port.)
   */
  async upsertMany(
    workspaceId: string,
    userId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(patch)) {
        await tx
          .insert(t.settings)
          .values({ workspaceId, userId, key, value })
          .onConflictDoUpdate({
            target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
            set: { value },
          });
      }
    });
  }
}
