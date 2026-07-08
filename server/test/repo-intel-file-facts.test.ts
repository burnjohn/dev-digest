/**
 * Unit tests for `RepoIntelService.getAllFileFacts` — repo-wide `file_facts`
 * aggregator (onboarding's routes/endpoints inventory).
 *
 * Hermetic: no Postgres, no Docker, no clone. The service's `repo`
 * (RepoIntelRepository) is patched with a stub, mirroring
 * repo-intel-importers.test.ts / repo-intel-facade-degraded.test.ts.
 *
 * Distinct from `getFileFacts` (the existing `files`-filtered read used by
 * blast): `getAllFileFacts` takes no file list and is intentionally UNCAPPED
 * at this layer — proven here with a >100-row fixture. Any hub-file or
 * LLM-input capping belongs downstream in the onboarding module, not here.
 */
import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import type { IndexerFileFactsRow } from '../src/modules/repo-intel/repository.js';

function buildService(opts: {
  flagEnabled: boolean;
  allFileFacts: IndexerFileFactsRow[];
}): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: opts.flagEnabled },
    db: {} as never,
    codeIndex: {
      symbols: async () => [],
      references: async () => [],
    } as never,
  } as never;

  const svc = new RepoIntelService(container);

  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getRepoBasics: async () => null,
    tryGetIndexState: async () => null,
    getAllFileFacts: async (_repoId: string) => opts.allFileFacts,
  };

  return svc;
}

describe('getAllFileFacts — gate conditions', () => {
  it('returns [] when repoIntelEnabled=false, even if the repository has rows', async () => {
    const svc = buildService({
      flagEnabled: false,
      allFileFacts: [{ filePath: 'a.ts', endpoints: ['GET /a'], crons: [] }],
    });
    await expect(svc.getAllFileFacts('repo1')).resolves.toEqual([]);
  });

  it('returns [] for a repo with no indexed facts', async () => {
    const svc = buildService({ flagEnabled: true, allFileFacts: [] });
    await expect(svc.getAllFileFacts('repo1')).resolves.toEqual([]);
  });
});

describe('getAllFileFacts — uncapped repo-wide inventory', () => {
  it('returns ALL rows for a repo, with no implicit cap (>100 rows fixture)', async () => {
    const rows: IndexerFileFactsRow[] = Array.from({ length: 137 }, (_, i) => ({
      filePath: `src/file-${i}.ts`,
      endpoints: [`GET /route-${i}`],
      crons: i % 10 === 0 ? [`cron-${i}`] : [],
    }));
    const svc = buildService({ flagEnabled: true, allFileFacts: rows });

    const result = await svc.getAllFileFacts('repo1');

    expect(result).toHaveLength(137);
    expect(result).toEqual(rows);
  });

  it('includes hub files (no HUB_ENDPOINT_LIMIT-style filtering at this layer)', async () => {
    // A "hub" file with far more than blast's HUB_ENDPOINT_LIMIT (5) endpoints
    // must survive intact — that filter is blast-specific, not applied here.
    const hub: IndexerFileFactsRow = {
      filePath: 'src/routes/index.ts',
      endpoints: Array.from({ length: 42 }, (_, i) => `GET /hub-${i}`),
      crons: [],
    };
    const svc = buildService({ flagEnabled: true, allFileFacts: [hub] });

    const result = await svc.getAllFileFacts('repo1');

    expect(result).toHaveLength(1);
    expect(result[0]!.endpoints).toHaveLength(42);
  });
});
