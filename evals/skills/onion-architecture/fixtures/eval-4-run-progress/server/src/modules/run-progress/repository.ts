import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type ProgressCheckpointRow = typeof t.progressCheckpoints.$inferSelect;

export class RunProgressRepository {
  constructor(private db: Db) {}

  async recordCheckpoint(runId: string, step: number, total: number): Promise<void> {
    await this.db.insert(t.progressCheckpoints).values({ runId, step, total });
  }

  async latest(runId: string): Promise<ProgressCheckpointRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.progressCheckpoints)
      .where(eq(t.progressCheckpoints.runId, runId))
      .orderBy(t.progressCheckpoints.step);
    return row;
  }
}
