import type { Db } from '../../db/client.js';
import type { PullLookupResult } from '@devdigest/shared';
import { LookupRepository } from './repository.js';
import { isMatchedLookupRow, toPullLookup } from './helpers.js';

/**
 * `lookup` service. Business logic for the human-coordinates→internal-id
 * boundary (§5.2, docs/plans/05-mcp-server.md): given a workspace, a repo's
 * `owner/name`, and a PR number, resolve it or explain why not.
 *
 * `LookupServiceDeps` is explicit rather than the whole `Container` — it is
 * structurally satisfied by `Container` with no call-site or container
 * change (`server/INSIGHTS.md`, 2026-08-15).
 */
export interface LookupServiceDeps {
  db: Db;
}

export class LookupService {
  private repo: LookupRepository;

  constructor(deps: LookupServiceDeps) {
    this.repo = new LookupRepository(deps.db);
  }

  async resolvePull(
    workspaceId: string,
    fullName: string,
    number: number,
  ): Promise<PullLookupResult> {
    const row = await this.repo.resolve(workspaceId, fullName, number);

    if (!row) {
      const candidates = await this.repo.listImportedRepoFullNames(workspaceId);
      return {
        ok: false,
        reason: 'repo_not_found',
        message: `"${fullName}" is not imported in this workspace.`,
        candidates,
      };
    }

    if (!isMatchedLookupRow(row)) {
      const candidates = await this.repo.listPullNumbers(row.repoId);
      return {
        ok: false,
        reason: 'pull_not_found',
        message: `PR #${number} was not found in "${fullName}".`,
        candidates,
      };
    }

    return {
      ok: true,
      pull: toPullLookup(row),
    };
  }
}
