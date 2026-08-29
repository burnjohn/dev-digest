import type { Db } from '../../db/client.js';
import type * as schema from '../../db/schema.js';
import { LabelRepository } from './repository.js';
import { toLabelDto } from './helpers.js';
import { LABEL_SYNC_JOB_KIND } from './constants.js';
import { REFRESH_JOB_KIND } from '../repo-intel/constants.js';
import type { LabelSyncResult } from './types.js';

export type LabelRow = typeof schema.labels.$inferSelect;

export interface LabelServiceDeps {
  db: Db;
  jobs: { enqueue(kind: string, payload: unknown): Promise<void> };
}

/**
 * Labels service. Keeps a repo's local label cache in step with GitHub, and
 * chains a repo-intel refresh once a sync completes so downstream indexing
 * sees the latest label set.
 */
export class LabelService {
  private repo: LabelRepository;

  constructor(private deps: LabelServiceDeps) {
    this.repo = new LabelRepository(deps.db);
  }

  async list(repoId: string) {
    const rows = await this.repo.listForRepo(repoId);
    return rows.map(toLabelDto);
  }

  async sync(repoId: string, fullName: string): Promise<LabelSyncResult> {
    await this.repo.syncFromGitHub(repoId, fullName);
    await this.deps.jobs.enqueue(LABEL_SYNC_JOB_KIND, { repoId });
    await this.deps.jobs.enqueue(REFRESH_JOB_KIND, { repoId });
    return { created: 0, updated: 0, removed: 0 };
  }
}
