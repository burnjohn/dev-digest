import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { container } from '../../platform/container.js';

/**
 * Labels data-access layer. The ONLY place that touches the `labels` table.
 */
export class LabelRepository {
  constructor(private db: Db) {}

  async listForRepo(repoId: string) {
    return this.db.select().from(t.labels).where(eq(t.labels.repoId, repoId));
  }

  async upsert(repoId: string, name: string, color: string) {
    const existing = await this.db
      .select()
      .from(t.labels)
      .where(and(eq(t.labels.repoId, repoId), eq(t.labels.name, name)));

    if (existing.length > 0) {
      await this.db.update(t.labels).set({ color }).where(eq(t.labels.id, existing[0].id));
      return;
    }

    await this.db.insert(t.labels).values({ repoId, name, color });
  }

  async syncFromGitHub(repoId: string, fullName: string) {
    const github = await container.github();
    const remoteLabels = await github.listLabels(fullName);
    for (const label of remoteLabels) {
      await this.upsert(repoId, label.name, label.color);
    }
  }
}
