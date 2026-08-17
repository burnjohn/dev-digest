import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * The conventions module end-to-end, driven by fixtures instead of a model.
 *
 * These cases are about the GATES, not the happy path: a fabricated evidence path,
 * a hallucinated snippet, an invented file path and a rule the user already
 * rejected all have to die before they reach the page — and a good snippet has to
 * survive with its line number corrected. Everything goes through HTTP, so the
 * response schemas and the DTO gate are exercised too.
 *
 * Each test gets its OWN repo row (`freshRepo`). Extraction replaces a repo's
 * pending rows and the accept/reject decisions deliberately survive, so tests
 * sharing one repo would be order-dependent — and the demo repo already carries
 * the four seeded candidates from `seed-conventions.ts`.
 */

/** The two files the mock clone contains — every fixture cites one (or lies about it). */
const USERS_TS = [
  'import { db } from "../lib/db";', // 1
  '', // 2
  'export async function getUser(id: string) {', // 3
  '  const user = await db.users.find(id);', // 4
  '  const posts = await db.posts.findMany({ userId: id });', // 5
  '  return { user, posts };', // 6
  '}', // 7
].join('\n');

/**
 * The second file deliberately re-states each of `THREE_RULES`' probes, so every
 * fixture rule has support in a file OTHER than the one it cites. That is now
 * load-bearing: a rule followed only in its own evidence file is dropped, so a
 * fixture without a second site would test the drop gate instead of whatever it
 * meant to test.
 */
const OTHER_TS = [
  'import { db } from "../lib/db";', // 1 — supports the `imports` rule
  '', // 2
  'export async function listUsers(id: string) {', // 3 — supports the `typing` rule
  '  const user = await db.users.find(id);', // 4 — supports the `async` rule
  '  return [user];', // 5
  '}', // 6
].join('\n');

/** A file that follows NOTHING the fixtures propose — the violation side of a ratio. */
const LEGACY_TS = [
  'export function listLegacy() {', // 1
  '  return db.users.findAll().then((rows) => rows);', // 2 — a .then() chain
  '}', // 3
].join('\n');

const SAMPLE_PATHS = ['src/api/users.ts', 'src/api/other.ts'];

/** Repo-wide declarations — the denominator a `naming` rule is scored against. */
const SYMBOLS = [
  { path: 'src/hooks/useUser.ts', name: 'useUser', kind: 'function', exported: true },
  { path: 'src/hooks/useCart.ts', name: 'useCart', kind: 'function', exported: true },
  { path: 'src/hooks/useAuth.ts', name: 'useAuth', kind: 'function', exported: true },
  { path: 'src/hooks/legacy.ts', name: 'getCartData', kind: 'function', exported: true },
];

/**
 * A `RepoIntel` stub. Only the reads the extractor makes are real; every other
 * method throws, so a change that starts depending on more of the facade fails
 * loudly here instead of silently degrading.
 */
function fakeRepoIntel(paths: string[] = SAMPLE_PATHS, symbols = SYMBOLS): RepoIntel {
  const unused = (name: string) => () => {
    throw new Error(`RepoIntel.${name} should not be called by conventions`);
  };
  return {
    getConventionSamples: async (_repoId: string, n: number) => paths.slice(0, n),
    // The whole-repo corpora conformance is counted over.
    getAllSymbolNames: async () => symbols,
    getTopFilesByRank: async (_repoId: string, n: number) => paths.slice(0, n),
    getSymbolsInFiles: async () => [
      {
        file: 'src/api/users.ts',
        name: 'getUser',
        kind: 'function',
        exported: true,
        startLine: 3,
        endLine: 7,
        signature: null,
      },
    ],
    indexRepo: unused('indexRepo'),
    refreshIndex: unused('refreshIndex'),
    getIndexState: unused('getIndexState'),
    getBlastRadius: unused('getBlastRadius'),
    getRepoMap: unused('getRepoMap'),
    getFileRank: unused('getFileRank'),
    getCallerSignatures: unused('getCallerSignatures'),
    getUnresolvedReferences: unused('getUnresolvedReferences'),
    getCriticalPaths: unused('getCriticalPaths'),
  } as unknown as RepoIntel;
}

/** One raw candidate as an extraction call returns them. */
function candidate(over: Record<string, unknown> = {}) {
  return {
    category: 'async',
    rule: 'Always use async/await instead of .then() chains',
    rationale: 'Every data-access call in the sampled handlers is awaited.',
    evidence_path: 'src/api/users.ts',
    // Deliberately WRONG: the quote is really on line 4. Grounding must fix it.
    evidence_line: 6,
    evidence_snippet: 'const user = await db.users.find(id);',
    probe: 'await db.users.find(',
    confidence: 0.9,
    ...over,
  };
}

/** Three rules distinct enough to survive each other's dedup pass. */
const THREE_RULES = [
  candidate(),
  candidate({
    category: 'imports',
    rule: 'Import the shared db handle from lib/db, never construct one',
    evidence_snippet: 'import { db } from "../lib/db";',
    evidence_line: 1,
    probe: 'from "../lib/db"',
    confidence: 0.8,
  }),
  candidate({
    category: 'typing',
    rule: 'Route helpers annotate their id parameter as string',
    evidence_snippet: 'export async function getUser(id: string) {',
    evidence_line: 3,
    probe: '(id: string)',
    confidence: 0.7,
  }),
];

d('/repos/:id/conventions', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** A repo of this test's own, so no test can observe another's decisions. */
  async function freshRepo(): Promise<string> {
    repoSeq += 1;
    const name = `payments-api-${repoSeq}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    return repo!.id;
  }

  /**
   * `structuredBySchema` keys the fixture by `req.schemaName`, so ONE mock serves
   * both steps of the dialogue: the file-selection call and all six category
   * extraction calls. Every category call therefore returns the SAME list, and the
   * per-category filter keeps each candidate only in the pass whose `category` it
   * declares — so a one-candidate fixture yields exactly one candidate, not six.
   */
  function makeApp(
    opts: {
      conventions?: unknown[];
      paths?: string[];
      selected?: string[];
      /**
       * The step-H2 semantic dedup verdict. Defaults to an explicit "no duplicates"
       * fixture rather than leaning on `MockLLMProvider`'s `{}` fallback: the real
       * schema's fields are REQUIRED (OpenAI strict mode rejects optional-without-
       * nullable), so `{}` would not parse. See `test/structured-schemas.test.ts`.
       */
      dedup?: unknown;
    } = {},
  ) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        github: new MockGitHubClient(),
        git: new MockGitClient({
          files: {
            'src/api/users.ts': USERS_TS,
            'src/api/other.ts': OTHER_TS,
            'src/api/legacy.ts': LEGACY_TS,
            // `readConfigDigests` reads this allowlisted name; without it the
            // config path is dead in tests (MockGitClient returns '' for a
            // missing file and the service filters empties out).
            'tsconfig.json': '{ "compilerOptions": { "strict": true } }',
          },
        }),
        repoIntel: fakeRepoIntel(opts.paths),
        llm: {
          openai: new MockLLMProvider('openai', {
            structuredBySchema: {
              ConventionFileSelection: { paths: opts.selected ?? SAMPLE_PATHS },
              ConventionExtraction: { conventions: opts.conventions ?? [candidate()] },
              ConventionDedup: opts.dedup ?? { duplicate_groups: [], covered_by_existing: [] },
            },
          }),
        },
      },
    });
  }

  it('grounds a real snippet, CORRECTING the model’s line number', async () => {
    const repoId = await freshRepo();
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // One in-category candidate in, one row out — the other five passes returned
    // the same `async` rule and the category filter discarded it.
    expect(body.candidates).toHaveLength(1);
    const only = body.candidates[0];
    // The model said line 6. The quote is on line 4. We store 4.
    expect(only.evidence_start_line).toBe(4);
    expect(only.evidence_end_line).toBe(4);
    expect(only.status).toBe('pending');
    expect(only.category).toBe('async');
    // The probe appears in both mock files → support 2, and confidence is
    // re-derived from that, not taken from the model's 0.9.
    expect(only.support_count).toBe(2);
    expect(only.support_files).toEqual(SAMPLE_PATHS);
    expect(only.confidence).not.toBe(0.9);
    // The DTO gate: the tenant id must not reach the wire.
    expect(only).not.toHaveProperty('workspace_id');

    expect(body.last_scan).toMatchObject({
      sampled_files: 2,
      selected_files: 2,
      raw_candidates: 1,
      dropped_ungrounded: 0,
      dropped_unsupported: 0,
      dropped_duplicate: 0,
      model: 'openai/gpt-4o-mini',
    });
    // The stats reconcile across all four gates.
    expect(
      body.last_scan.raw_candidates -
        body.last_scan.dropped_ungrounded -
        body.last_scan.dropped_unsupported -
        body.last_scan.dropped_duplicate,
    ).toBe(body.candidates.length);
    await app.close();
  });

  it('DROPS a rule nothing but its own evidence file follows', async () => {
    // The whole point of the rework: one site is an observation about one file,
    // not a house convention, and it used to be shown at a demoted score.
    const repoId = await freshRepo();
    const app = await makeApp({
      conventions: [
        candidate({
          evidence_snippet: 'const posts = await db.posts.findMany({ userId: id });',
          evidence_line: 5,
          probe: 'db.posts.findMany',
        }),
      ],
    });
    const body = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      })
    ).json();
    expect(body.candidates).toHaveLength(0);
    expect(body.last_scan).toMatchObject({
      raw_candidates: 1,
      dropped_ungrounded: 0,
      dropped_unsupported: 1,
    });
    await app.close();
  });

  it('measures a naming rule against every declaration, not the sampled files', async () => {
    // 3 of 4 indexed hooks conform. Counted over the `symbols` corpus, so the
    // score reflects a real denominator rather than "1 file contains this string".
    const repoId = await freshRepo();
    const app = await makeApp({
      conventions: [
        candidate({
          category: 'naming',
          rule: 'Hooks are named with a use prefix',
          probe: {
            target: 'symbols',
            scope: { kinds: ['function'], exported: true },
            pattern: '^use[A-Z]',
          },
        }),
      ],
    });
    const body = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      })
    ).json();
    expect(body.candidates).toHaveLength(1);
    const only = body.candidates[0];
    expect(only.probe_strategy).toBe('symbols');
    expect(only.follow_count).toBe(3);
    expect(only.violation_count).toBe(1);
    expect(only.conformance).toBeCloseTo(0.75, 5);
    // A measured denominator means the score is NOT capped.
    expect(only.signals.capped).toBe(false);
    expect(body.last_scan.counted_symbols).toBe(4);
    await app.close();
  });

  it('caps a rule whose denominator could not be measured, and marks it', async () => {
    const repoId = await freshRepo();
    const app = await makeApp(); // bare-string probe → no counter probe
    const body = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      })
    ).json();
    const only = body.candidates[0];
    // `null`, not 0 — "we could not measure" is a different claim from "none found".
    expect(only.violation_count).toBeNull();
    expect(only.conformance).toBeNull();
    expect(only.confidence).toBeLessThanOrEqual(0.85);
    await app.close();
  });

  it('counts conformance against a counter-probe when the model supplies one', async () => {
    const repoId = await freshRepo();
    const app = await makeApp({
      paths: [...SAMPLE_PATHS, 'src/api/legacy.ts'],
      selected: [...SAMPLE_PATHS, 'src/api/legacy.ts'],
      conventions: [
        candidate({
          probe: {
            target: 'text',
            kind: 'regex',
            pattern: 'await db\\.users',
            counter_kind: 'regex',
            counter_pattern: '\\.then\\(',
          },
        }),
      ],
    });
    const body = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      })
    ).json();
    const only = body.candidates[0];
    expect(only.follow_count).toBe(2); // users.ts + other.ts
    expect(only.violation_count).toBe(1); // legacy.ts
    expect(only.conformance).toBeCloseTo(2 / 3, 5);
    expect(only.signals.capped).toBe(false);
    await app.close();
  });

  it('survives a catastrophic-backtracking probe instead of hanging on it', async () => {
    // The assertion that matters is that the request COMPLETES. A vitest timeout
    // here is the ReDoS alarm; the pattern validator should refuse the pattern
    // long before the regex engine ever sees this input.
    const repoId = await freshRepo();
    const app = await makeApp({
      conventions: [
        candidate({
          probe: { target: 'text', kind: 'regex', pattern: '(a+)+$' },
        }),
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    // Unusable probe ⇒ no independent support ⇒ dropped, not shown at a guess.
    expect(res.json().candidates).toHaveLength(0);
    expect(res.json().last_scan.dropped_unsupported).toBe(1);
    await app.close();
  });

  it('boosts a rule the project config declares — but only if the quote is real', async () => {
    const repoId = await freshRepo();
    const withReal = await makeApp({
      conventions: [
        candidate({
          config_evidence: { path: 'tsconfig.json', snippet: '"strict": true' },
        }),
      ],
    });
    const real = (
      await withReal.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      })
    ).json().candidates[0];
    expect(real.config_declared).toBe(true);
    await withReal.close();

    const repoId2 = await freshRepo();
    const withFake = await makeApp({
      conventions: [
        candidate({
          config_evidence: { path: 'tsconfig.json', snippet: '"skipAuthChecks": true' },
        }),
      ],
    });
    const fake = (
      await withFake.inject({
        method: 'POST',
        url: `/repos/${repoId2}/conventions/extract`,
        payload: {},
      })
    ).json().candidates[0];
    // A fabricated citation forfeits the boost; it never drops the candidate,
    // which can still stand on its code evidence.
    expect(fake.config_declared).toBe(false);
    expect(real.confidence).toBeGreaterThan(fake.confidence);
    await withFake.close();
  });

  it('DROPS a candidate that cites a file the scan never read', async () => {
    const repoId = await freshRepo();
    const app = await makeApp({
      conventions: [candidate({ evidence_path: 'src/secrets/nope.ts' })],
    });
    const body = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      })
    ).json();
    expect(body.candidates).toHaveLength(0);
    expect(body.last_scan).toMatchObject({ raw_candidates: 1, dropped_ungrounded: 1 });
    await app.close();
  });

  it('DROPS a candidate whose snippet is not in the file it cites', async () => {
    const repoId = await freshRepo();
    const app = await makeApp({
      conventions: [candidate({ evidence_snippet: 'await db.users.findOrFail(id)' })],
    });
    const body = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      })
    ).json();
    expect(body.candidates).toHaveLength(0);
    expect(body.last_scan.dropped_ungrounded).toBe(1);
    await app.close();
  });

  it('ignores a selected path that was not in the offered candidate set', async () => {
    // The traversal guard: a path the model invented never reaches the filesystem.
    const repoId = await freshRepo();
    const app = await makeApp({ selected: ['../../etc/passwd', 'src/api/users.ts'] });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().last_scan.selected_files).toBe(1);
    await app.close();
  });

  it('409s when the repo has no code index instead of reporting zero conventions', async () => {
    const repoId = await freshRepo();
    const app = await makeApp({ paths: [] });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/index/i);
    await app.close();
  });

  it('PATCH accepts, rejects and edits — and skill-draft merges only the accepted set', async () => {
    const repoId = await freshRepo();
    const app = await makeApp({ conventions: THREE_RULES });
    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} });

    const rows = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json()
      .candidates as { id: string; rule: string }[];
    expect(rows).toHaveLength(3);

    // edit one rule's text and accept it in a single patch
    const edited = await app.inject({
      method: 'PATCH',
      url: `/conventions/${rows[0]!.id}`,
      payload: { rule: 'Awaited calls only — no .then() chains', status: 'accepted' },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      rule: 'Awaited calls only — no .then() chains',
      status: 'accepted',
    });

    await app.inject({
      method: 'PATCH',
      url: `/conventions/${rows[1]!.id}`,
      payload: { status: 'accepted' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${rows[2]!.id}`,
      payload: { status: 'rejected' },
    });

    const draft = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions/skill-draft` })
    ).json();
    expect(draft.name).toBe(`payments-api-${repoSeq}-conventions`);
    expect(draft.type).toBe('convention');
    // exactly the two accepted rules — the rejected one is absent
    expect(draft.body.match(/^## /gm)).toHaveLength(2);
    expect(draft.body).toContain('Awaited calls only');
    expect(draft.body).not.toContain(rows[2]!.rule);
    expect(draft.evidence_files.length).toBeGreaterThan(0);

    // Saving goes through the EXISTING skills endpoint; skill-link then stamps the
    // rules that shipped in it.
    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: draft.name,
        description: draft.description,
        type: draft.type,
        source: 'extracted',
        body: draft.body,
        evidence_files: draft.evidence_files,
      },
    });
    expect(created.statusCode).toBe(201);
    const skill = created.json();
    expect(skill).toMatchObject({ source: 'extracted', type: 'convention', version: 1 });

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/repos/${repoId}/conventions/skill-link`,
          payload: { ids: [rows[0]!.id, rows[1]!.id], skill_id: skill.id },
        })
      ).statusCode,
    ).toBe(200);

    const after = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    expect(
      after.candidates.filter((c: { skill_id: string | null }) => c.skill_id === skill.id),
    ).toHaveLength(2);
    await app.close();
  });

  it('does NOT re-propose a rejected rule on re-scan, and keeps the user’s decisions', async () => {
    const repoId = await freshRepo();
    const app = await makeApp();
    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} });

    const [target] = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json().candidates as { id: string; rule: string; status: string }[];
    expect(target!.status).toBe('pending');

    await app.inject({
      method: 'PATCH',
      url: `/conventions/${target!.id}`,
      payload: { status: 'rejected' },
    });

    // Same fixture, same rule — the dedup pass against past rejects must eat it.
    const rescan = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    expect(rescan.statusCode).toBe(200);
    const after = rescan.json().candidates as { id: string; rule: string; status: string }[];

    expect(after.some((c) => c.status === 'pending')).toBe(false);
    // The rejection itself survives a re-scan — it IS the dedup memory.
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: target!.id, status: 'rejected' });
    expect(rescan.json().last_scan.dropped_duplicate).toBe(1);
    await app.close();
  });

  it('MERGES a re-scan into the list: new rules are added, old ones survive', async () => {
    // A scan reads 12-14 of 40 sampled files, so a rule absent from one run usually
    // means its evidence file wasn't sampled. Re-scanning must add, not replace.
    const repoId = await freshRepo();
    const ruleA = 'Route handlers await every data-access call';
    const ruleB = 'Modules export a factory rather than a singleton';

    const first = await makeApp({ conventions: [candidate({ rule: ruleA })] });
    await first.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} });
    const before = (
      await first.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json().candidates as { id: string; rule: string }[];
    expect(before.map((c) => c.rule)).toEqual([ruleA]);
    await first.close();

    // Second run finds A again plus a new B: only B is added, A keeps its row.
    const second = await makeApp({
      conventions: [candidate({ rule: ruleA }), candidate({ category: 'structure', rule: ruleB })],
    });
    const body = (
      await second.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} })
    ).json();
    const after = body.candidates as { id: string; rule: string }[];

    expect(after).toHaveLength(2);
    expect(new Set(after.map((c) => c.rule))).toEqual(new Set([ruleA, ruleB]));
    expect(after.find((c) => c.rule === ruleA)!.id).toBe(before[0]!.id);
    expect(body.last_scan.dropped_duplicate).toBe(1);
    await second.close();
  });

  it('is idempotent: re-scanning the same fixture adds nothing', async () => {
    const repoId = await freshRepo();
    const app = await makeApp({ conventions: THREE_RULES });
    const scan = async () =>
      (await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} }))
        .json();

    const before = (await scan()).candidates as { id: string }[];
    expect(before.length).toBeGreaterThan(1);

    const second = await scan();
    expect((second.candidates as { id: string }[]).map((c) => c.id)).toEqual(
      before.map((c) => c.id),
    );
    // The scan really ran and really proposed rules — it just added none of them,
    // which is what makes the identical id list above meaningful rather than a no-op.
    expect(second.last_scan.raw_candidates).toBeGreaterThan(0);
    expect(second.last_scan.dropped_duplicate).toBeGreaterThanOrEqual(before.length);
    await app.close();
  });

  it('re-scores a pending rule a later scan measured more strongly', async () => {
    // Rows are permanent now, so a score from a thin first sample would otherwise
    // stick forever. `probe` drives conformance, so a wider one raises confidence.
    const repoId = await freshRepo();
    const rule = 'Route handlers await every data-access call';

    const weak = await makeApp({
      conventions: [candidate({ rule, probe: 'await db.users.find(', confidence: 0.4 })],
    });
    const before = (
      await weak.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} })
    ).json().candidates[0] as { id: string; confidence: number };
    await weak.close();

    const strong = await makeApp({
      conventions: [candidate({ rule, probe: 'await ', confidence: 0.95 })],
    });
    const after = (
      await strong.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} })
    ).json().candidates as { id: string; confidence: number }[];

    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before.id);
    expect(after[0]!.confidence).toBeGreaterThan(before.confidence);
    await strong.close();
  });

  it('does NOT re-propose an ACCEPTED rule on re-scan', async () => {
    // The bug this covers: dedup memory used to be the rejected rows only, so every
    // re-scan handed back a fresh `pending` twin of everything the user had
    // accepted — while `replacePending` correctly left the accepted original in
    // place. Two identical cards, one accepted, one pending.
    const repoId = await freshRepo();
    const app = await makeApp();
    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} });

    const [target] = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json().candidates as { id: string; rule: string; status: string }[];

    await app.inject({
      method: 'PATCH',
      url: `/conventions/${target!.id}`,
      payload: { status: 'accepted' },
    });

    const rescan = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    const after = rescan.json().candidates as { id: string; rule: string; status: string }[];

    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: target!.id, status: 'accepted' });
    expect(after.filter((c) => c.rule === target!.rule)).toHaveLength(1);
    expect(rescan.json().last_scan.dropped_duplicate).toBe(1);
    await app.close();
  });

  it('collapses a PARAPHRASE the lexical gate cannot see, on the model’s verdict', async () => {
    // These two score 0.60 token-set containment against a 0.80 threshold — the
    // real pair that shipped side by side on the page. Only step H2 can merge them.
    const repoId = await freshRepo();
    const app = await makeApp({
      conventions: [
        candidate({
          rule: 'All asynchronous functions use await for handling promises instead of .then() chaining.',
          confidence: 0.5,
        }),
        candidate({
          category: 'error_handling',
          rule: 'All asynchronous operations use await instead of promise chains.',
          confidence: 0.95,
        }),
      ],
      dedup: { duplicate_groups: [[0, 1]], covered_by_existing: [] },
    });
    const body = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} })
    ).json();

    expect(body.candidates).toHaveLength(1);
    // The group keeps its best-corroborated member, same rule as the lexical pass.
    expect(body.candidates[0].category).toBe('error_handling');
    expect(body.last_scan).toMatchObject({ raw_candidates: 2, dropped_duplicate: 1 });
    await app.close();
  });

  it('keeps both when the model reports no duplicates, and when the call fails', async () => {
    const pair = [
      candidate({ rule: 'Route handlers await every data-access call', confidence: 0.9 }),
      candidate({
        category: 'error_handling',
        rule: 'Wrap external calls in try/catch and rethrow a typed error',
        confidence: 0.9,
      }),
    ];

    const cleanRepo = await freshRepo();
    const clean = await makeApp({
      conventions: pair,
      dedup: { duplicate_groups: [], covered_by_existing: [] },
    });
    expect(
      (await clean.inject({ method: 'POST', url: `/repos/${cleanRepo}/conventions/extract`, payload: {} }))
        .json().candidates,
    ).toHaveLength(2);
    await clean.close();

    // A garbage verdict must FAIL OPEN: the fixture cannot parse `ConventionDedup`,
    // so the mock throws — and a scan must never lose conventions to a tidying pass.
    // Its OWN repo: scans merge now, so reusing the repo above would make these two
    // rules duplicates of themselves and prove nothing about the failure path.
    const brokenRepo = await freshRepo();
    const broken = await makeApp({ conventions: pair, dedup: { duplicate_groups: 'nonsense' } });
    const body = (
      await broken.inject({ method: 'POST', url: `/repos/${brokenRepo}/conventions/extract`, payload: {} })
    ).json();
    expect(body.candidates).toHaveLength(2);
    expect(body.last_scan.dropped_duplicate).toBe(0);
    await broken.close();
  });

  it('holds a card’s position when it is accepted, even against a full confidence tie', async () => {
    // `created_at` cannot break these ties — a scan is inserted in ONE transaction,
    // so every row shares its `now()`. Without the `id` key the list fell back to
    // heap order, and accepting a row rewrote its tuple to the end of the heap.
    const repoId = await freshRepo();
    const tied = ['Handlers await every db call', 'Services return typed results', 'Modules export a factory'].map(
      (rule) => candidate({ rule, confidence: 0.9 }),
    );
    const app = await makeApp({ conventions: tied });
    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract`, payload: {} });

    const list = async () =>
      (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json()
        .candidates as { id: string; confidence: number }[];

    const before = await list();
    expect(before).toHaveLength(3);
    // The tie is the whole point — if scoring ever separates these, this test stops
    // exercising the tie-break and should be rebuilt, not deleted.
    expect(new Set(before.map((c) => c.confidence)).size).toBe(1);

    await app.inject({
      method: 'PATCH',
      url: `/conventions/${before[1]!.id}`,
      payload: { status: 'accepted' },
    });

    expect((await list()).map((c) => c.id)).toEqual(before.map((c) => c.id));
    await app.close();
  });

  it('does not re-propose a rule the workspace already has as a skill', async () => {
    const repoId = await freshRepo();
    const app = await makeApp();
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: `existing-async-rule-${repoSeq}`,
          body:
            '# async style\nThis project is written with async/await everywhere. Never write a ' +
            '.then() chain in application code.',
        },
      })
    ).json();

    const body = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      })
    ).json();
    expect(body.candidates).toHaveLength(0);
    expect(body.last_scan.dropped_duplicate).toBe(1);

    // Skills are workspace-scoped, and `freshRepo` only isolates the conventions
    // rows — leaving this skill behind would silently dedup the async rule out of
    // every later test in this file.
    await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    await app.close();
  });

  it('collapses the same rule proposed under two categories, keeping the stronger', async () => {
    const repoId = await freshRepo();
    const app = await makeApp({
      conventions: [
        candidate({ confidence: 0.5 }),
        // Same rule, different category — both survive their own category filter,
        // so only the cross-category dedup pass can collapse them.
        candidate({ category: 'structure', confidence: 0.95 }),
      ],
    });
    const body = (
      await app.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/extract`,
        payload: {},
      })
    ).json();
    expect(body.candidates).toHaveLength(1);
    // Highest blended confidence wins, so the surviving row is the `structure` one.
    expect(body.candidates[0].category).toBe('structure');
    expect(body.last_scan).toMatchObject({ raw_candidates: 2, dropped_duplicate: 1 });
    await app.close();
  });

  it('404s a repo from another workspace rather than revealing it exists', async () => {
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${Date.now()}` })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: other!.id,
        owner: 'other',
        name: 'private-api',
        fullName: 'other/private-api',
      })
      .returning();

    const app = await makeApp();
    expect(
      (await app.inject({ method: 'GET', url: `/repos/${foreign!.id}/conventions` })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/repos/${foreign!.id}/conventions/skill-draft`,
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it('serves the seeded demo-repo candidates without any model call', async () => {
    const [demo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
    const app = await makeApp();
    const body = (
      await app.inject({ method: 'GET', url: `/repos/${demo!.id}/conventions` })
    ).json();
    expect(body.candidates.length).toBeGreaterThanOrEqual(4);
    // Seeded rows must look exactly like scanned ones — support consistent with
    // the meter, and a real line range.
    for (const c of body.candidates) {
      expect(c.support_count).toBe(c.support_files.length);
      expect(c.evidence_start_line).toBeGreaterThan(0);
      // A site count is never smaller than the file count it spans, and every
      // seeded row carries a real denominator — same as a scanned one.
      expect(c.follow_count).toBeGreaterThanOrEqual(c.support_count);
      expect(c.conformance).toBeGreaterThan(0);
      expect(c.conformance).toBeLessThanOrEqual(1);
      expect(c.signals.capped).toBe(false);
    }
    // No scan has run for the demo repo, so the header line has nothing to show.
    expect(body.last_scan).toBeNull();
    await app.close();
  });
});
