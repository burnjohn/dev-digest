/**
 * Unit tests for `onboarding/helpers.ts` pure functions.
 * No DB, no LLM, no file I/O.
 */
import { describe, it, expect } from 'vitest';
import {
  buildLlmInput,
  appendDiagramColors,
  mapGithubLink,
  attachRankOrder,
  toOnboardingTourDto,
} from '../src/modules/onboarding/helpers.js';
import {
  LLM_INPUT_MAX_BYTES,
  LLM_INPUT_MAX_ENDPOINTS,
  LLM_INPUT_MAX_ROUTES_PER_FILE,
} from '../src/modules/onboarding/constants.js';
import type { OnboardingRow } from '../src/modules/onboarding/repository.js';

describe('mapGithubLink — AC-8/AC-9', () => {
  it('builds a GitHub blob URL when repoBasics + sha are available', () => {
    const link = mapGithubLink({ owner: 'acme', name: 'api' }, 'abc123', 'src/index.ts');
    expect(link).toBe('https://github.com/acme/api/blob/abc123/src/index.ts');
  });

  it('returns null when repoBasics is unavailable', () => {
    expect(mapGithubLink(null, 'abc123', 'src/index.ts')).toBeNull();
  });

  it('returns null when sha is unavailable', () => {
    expect(mapGithubLink({ owner: 'acme', name: 'api' }, null, 'src/index.ts')).toBeNull();
  });
});

describe('attachRankOrder — AC-7 (server owns final order, not the LLM)', () => {
  it('emits entries in the SERVER-computed rank order, ignoring the order rationale was supplied in', () => {
    const rankedPaths = ['src/core.ts', 'src/utils.ts', 'src/index.ts']; // rank-DESCENDING
    // LLM returns rationale in a DIFFERENT (reversed/alphabetical) order —
    // Map insertion order below deliberately does not match rankedPaths.
    const rationaleByPath = new Map<string, string>([
      ['src/index.ts', 'Entry point'],
      ['src/core.ts', 'Core logic'],
      ['src/utils.ts', 'Shared utils'],
    ]);

    const entries = attachRankOrder(rankedPaths, rationaleByPath, {
      mapGithubLinkFor: () => null,
    });

    expect(entries.map((e) => e.path)).toEqual(['src/core.ts', 'src/utils.ts', 'src/index.ts']);
    expect(entries[0]!.rationale).toBe('Core logic');
    expect(entries[0]!.rank).toBe(1);
    expect(entries[2]!.rank).toBe(3);
  });

  it('falls back to a deterministic placeholder when the LLM omitted a rationale for a ranked path', () => {
    const rankedPaths = ['src/a.ts', 'src/b.ts'];
    const rationaleByPath = new Map<string, string>([['src/a.ts', 'Has rationale']]);

    const entries = attachRankOrder(rankedPaths, rationaleByPath, {
      mapGithubLinkFor: () => null,
    });

    expect(entries).toHaveLength(2);
    expect(entries[1]!.path).toBe('src/b.ts');
    expect(entries[1]!.rationale).toMatch(/ranked #2/);
  });

  it('sets rank: null for every entry in lite mode', () => {
    const entries = attachRankOrder(['src/a.ts'], new Map(), {
      mapGithubLinkFor: () => null,
      rankIsNull: true,
    });
    expect(entries[0]!.rank).toBeNull();
  });

  it('attaches github_link per entry via the provided mapper', () => {
    const entries = attachRankOrder(['src/a.ts'], new Map(), {
      mapGithubLinkFor: (p) => `https://github.com/x/y/blob/sha/${p}`,
    });
    expect(entries[0]!.github_link).toBe('https://github.com/x/y/blob/sha/src/a.ts');
  });
});

describe('buildLlmInput — bounded LLM input (§4)', () => {
  it('never includes full file contents — only paths/one-line facts/aggregate counts', () => {
    const result = buildLlmInput({
      rankedFiles: [{ path: 'src/index.ts', summary: 'entry point' }],
      routeFacts: [{ filePath: 'src/router.ts', endpoints: ['GET /api/x'], crons: [] }],
      criticalPaths: [['src/index.ts', 'src/core.ts']],
      stack: { packageJson: '{"name":"demo"}' },
    });
    expect(result).not.toContain('function ');
    expect(result).toContain('src/index.ts');
    expect(result).toContain('GET /api/x');
  });

  it('caps a single hub file endpoint contribution at LLM_INPUT_MAX_ROUTES_PER_FILE before the global cap', () => {
    const hubEndpoints = Array.from({ length: 30 }, (_, i) => `GET /api/hub-${i}`);
    const result = buildLlmInput({
      rankedFiles: [],
      routeFacts: [{ filePath: 'src/hub.ts', endpoints: hubEndpoints, crons: [] }],
      criticalPaths: [],
      stack: {},
    });
    // Only LLM_INPUT_MAX_ROUTES_PER_FILE (10) of the 30 should appear.
    const occurrences = (result.match(/GET \/api\/hub-/g) ?? []).length;
    expect(occurrences).toBe(LLM_INPUT_MAX_ROUTES_PER_FILE);
  });

  it('caps total endpoints across the whole bundle at LLM_INPUT_MAX_ENDPOINTS', () => {
    // 10 files x 10 endpoints each = 100 raw; must cap at 60 total.
    const routeFacts = Array.from({ length: 10 }, (_, fileIdx) => ({
      filePath: `src/file-${fileIdx}.ts`,
      endpoints: Array.from({ length: 10 }, (_, epIdx) => `GET /api/f${fileIdx}-e${epIdx}`),
      crons: [],
    }));
    const result = buildLlmInput({
      rankedFiles: [],
      routeFacts,
      criticalPaths: [],
      stack: {},
    });
    const occurrences = (result.match(/GET \/api\//g) ?? []).length;
    expect(occurrences).toBeLessThanOrEqual(LLM_INPUT_MAX_ENDPOINTS);
  });

  it('caps ranked files at LLM_INPUT_TOP_N_FILES (20) in the assembled bundle', () => {
    const rankedFiles = Array.from({ length: 40 }, (_, i) => ({ path: `src/f${i}.ts` }));
    const result = buildLlmInput({
      rankedFiles,
      routeFacts: [],
      criticalPaths: [],
      stack: {},
    });
    // Files beyond index 19 (0-based) must not appear.
    expect(result).not.toContain('src/f39.ts');
    expect(result).toContain('src/f0.ts');
  });

  it('a large-repo fixture (>200 file_facts rows, >30 ranked files) stays within LLM_INPUT_MAX_BYTES', () => {
    const rankedFiles = Array.from({ length: 35 }, (_, i) => ({
      path: `src/module-${i}/index.ts`,
      summary: 'a moderately long one-line summary describing this file role in the system',
    }));
    const routeFacts = Array.from({ length: 220 }, (_, i) => ({
      filePath: `src/routes/handler-${i}.ts`,
      endpoints: [`GET /api/resource-${i}`, `POST /api/resource-${i}`],
      crons: [],
    }));
    const criticalPaths = Array.from({ length: 5 }, (_, i) =>
      Array.from({ length: 6 }, (_, j) => `src/chain-${i}/step-${j}.ts`),
    );
    const result = buildLlmInput({
      rankedFiles,
      routeFacts,
      criticalPaths,
      stack: {
        packageJson: JSON.stringify({ name: 'big-repo', scripts: { dev: 'x', build: 'y' } }),
        readmeExcerpt: 'A'.repeat(2000),
      },
    });
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(LLM_INPUT_MAX_BYTES);
  });

  it('never truncates mid-entry — every kept line is a complete path/route/summary', () => {
    // Force truncation with an oversized readme so the byte-budget kicks in.
    const rankedFiles = Array.from({ length: 20 }, (_, i) => ({ path: `src/f${i}.ts` }));
    const routeFacts = Array.from({ length: 10 }, (_, i) => ({
      filePath: `src/r${i}.ts`,
      endpoints: [`GET /api/${i}`],
      crons: [],
    }));
    const result = buildLlmInput({
      rankedFiles,
      routeFacts,
      criticalPaths: [['a.ts', 'b.ts']],
      stack: { readmeExcerpt: 'X'.repeat(100_000) },
    });
    // No line should be cut off mid-word in a way that leaves a dangling
    // partial route string (spot check: every GET/POST line that appears is
    // a full "METHOD /path" pair, not a half-written fragment).
    for (const line of result.split('\n')) {
      if (line.includes('GET /api/')) {
        expect(line).toMatch(/GET \/api\/\d+$/);
      }
    }
  });
});

describe('appendDiagramColors', () => {
  it('returns null unchanged when diagram is null', () => {
    expect(appendDiagramColors(null, 'architecture')).toBeNull();
  });

  it('appends a classDef/style block for a simple flowchart', () => {
    const diagram = 'flowchart LR\n  A["client: Next.js app"] --> B["API"]\n  B --> C["Postgres db"]';
    const result = appendDiagramColors(diagram, 'architecture');
    expect(result).not.toBeNull();
    expect(result).toContain('classDef');
    expect(result).toContain(diagram);
  });
});

describe('toOnboardingTourDto', () => {
  it('sets generated_at to null when row is null (never generated)', () => {
    const dto = toOnboardingTourDto('repo-1', null, [], {
      status: 'degraded',
      degraded: true,
      reason: 'no_data',
      mode: 'lite',
      llm_cost_cents: null,
    });
    expect(dto.generated_at).toBeNull();
  });

  it('sets generated_at from row.generatedAt when a row exists', () => {
    const row: OnboardingRow = {
      repoId: 'repo-1',
      json: {},
      generatedAt: new Date('2026-07-03T12:00:00Z'),
      mode: 'full',
      indexStatus: 'full',
      degraded: false,
      degradedReason: null,
      llmCostCents: 12,
    };
    const dto = toOnboardingTourDto('repo-1', row, [], {
      status: 'full',
      degraded: false,
      reason: null,
      mode: 'full',
      llm_cost_cents: 12,
    });
    expect(dto.generated_at).toBe('2026-07-03T12:00:00.000Z');
  });
});
