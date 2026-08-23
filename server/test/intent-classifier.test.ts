import { describe, it, expect } from 'vitest';
import type {
  DiffHunk,
  FeatureModelChoice,
  GitClient,
  GitHubClient,
  LLMProvider,
  RepoRef,
  StructuredRequest,
  StructuredResult,
  UnifiedDiff,
} from '@devdigest/shared';
import {
  classifyIntent,
  INTENT_SCHEMA_NAME,
  type IntentClassifierDeps,
  type IntentLogger,
} from '../src/modules/reviews/intent-classifier.js';

/**
 * Hermetic unit coverage for `intent-classifier.ts` (plan 03-intent-layer.md
 * §5.1/§5.2, T4). `llm`/`git`/`github`/`tokenizer` are all stubbed in-file —
 * no DB, no network, no real model call.
 */

const REPO_REF: RepoRef = { owner: 'acme', name: 'payments-api' };
const MODEL: FeatureModelChoice = { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' };

function emptyDiff(): UnifiedDiff {
  return { raw: '', files: [] };
}

function malformedDiff(): UnifiedDiff {
  // `hunks` missing on a file — `gatherIntentSources`'s file-list rendering
  // (`for (const h of f.hunks)`) is NOT inside its own try/catch, so this
  // makes `gatherIntentSources` itself throw, exercising `classifyIntent`'s
  // outer "source gathering failed" fallback path. `diff.files` itself stays
  // a valid array so `fallbackIntent`'s own `diff.files.slice(...)` (used to
  // build the fallback's in_scope list) does not ALSO throw.
  return {
    raw: '',
    files: [{ path: 'a.ts', additions: 1, deletions: 0, hunks: undefined as never }],
  };
}

/**
 * A diff with exactly `FILE_LIST_MAX_FILES` (200, per `intent-sources.ts`)
 * small files — under the FILE COUNT cap, so `renderFileList` truncates only
 * because the rendered text crosses `FILE_LIST_MAX_CHARS` (8000): 200 files x
 * ~49 chars/file (a path line + one hunk-header line) is ~10,000 rendered
 * chars, comfortably over the 8000 budget. Routine for a PR of ~35-50+
 * changed files per the comment on `clampConfidence`.
 */
function bigFileListDiff(): UnifiedDiff {
  const files: UnifiedDiff['files'] = [];
  for (let i = 0; i < 200; i++) {
    const idx = String(i).padStart(3, '0');
    const path = `src/pkg/mod/file${idx}.ts`;
    const hunk: DiffHunk = {
      file: path,
      oldStart: 10,
      oldLines: 3,
      newStart: 10,
      newLines: 4,
      newLineNumbers: [10, 11, 12, 13],
    };
    files.push({ path, additions: 3, deletions: 1, hunks: [hunk] });
  }
  return { raw: '', files };
}

interface StubOptions {
  /** Fixture returned by `completeStructured` (validated against `IntentClassification`). */
  fixture?: unknown;
  /** Throw instead of resolving `completeStructured`. */
  rejectCall?: Error;
  /** Throw when the `llm` resolver itself is invoked (e.g. unresolvable provider). */
  rejectResolve?: Error;
  /** Throw when `github.getIssue` is called, to produce an `unreachable` source. */
  rejectIssue?: boolean;
}

function makeLogger(): IntentLogger & { infoCalls: unknown[][]; errorCalls: unknown[][] } {
  const infoCalls: unknown[][] = [];
  const errorCalls: unknown[][] = [];
  return {
    info: (msg, data) => infoCalls.push([msg, data]),
    error: (msg, data) => errorCalls.push([msg, data]),
    infoCalls,
    errorCalls,
  };
}

function makeDeps(opts: StubOptions = {}): IntentClassifierDeps & {
  llmCalls: { provider: string }[];
  structuredCalls: StructuredRequest<unknown>[];
} {
  const llmCalls: { provider: string }[] = [];
  const structuredCalls: StructuredRequest<unknown>[] = [];

  const provider: LLMProvider = {
    id: 'openrouter',
    listModels: async () => [],
    complete: async () => {
      throw new Error('not used');
    },
    completeStructured: async <T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> => {
      structuredCalls.push(req as StructuredRequest<unknown>);
      if (opts.rejectCall) throw opts.rejectCall;
      const fixture = opts.fixture ?? {
        intent: 'Adds rate limiting',
        in_scope: ['src/middleware'],
        out_of_scope: [],
        confidence: 'medium',
      };
      const parsed = req.schema.safeParse(fixture);
      if (!parsed.success) throw new Error(`stub fixture failed schema: ${parsed.error.message}`);
      return {
        data: parsed.data,
        model: req.model,
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0,
        raw: JSON.stringify(fixture),
        attempts: 1,
      };
    },
    embed: async () => [],
  };

  const git: GitClient = {
    clonePathFor: () => '/mock',
    clone: async () => ({ path: '/mock' }),
    fetchPullHead: async () => {},
    sync: async () => ({ head: 'sha' }),
    currentHead: async () => 'sha',
    diff: async () => emptyDiff(),
    blame: async () => [],
    log: async () => [],
    readFile: async () => '',
  } as unknown as GitClient;

  const github: GitHubClient = {
    listPullRequests: async () => [],
    getPullRequest: async () => {
      throw new Error('not used');
    },
    postReview: async () => ({ id: 'x' }),
    listReviewComments: async () => [],
    createReviewComment: async () => {
      throw new Error('not used');
    },
    openPullRequest: async () => ({ url: 'x' }),
    commitFiles: async () => ({ branch: 'x' }),
    findOpenPr: async () => null,
    getIssue: async (_repo: RepoRef, n: number) => {
      if (opts.rejectIssue) throw new Error('GitHub 404');
      return { number: n, title: `Issue #${n}`, body: 'issue body', state: 'open' };
    },
    currentLogin: async () => 'mock-user',
  } as unknown as GitHubClient;

  return {
    git,
    github: async () => github,
    tokenizer: { count: (text: string) => Math.ceil(text.length / 4) },
    llm: async (id) => {
      llmCalls.push({ provider: id });
      if (opts.rejectResolve) throw opts.rejectResolve;
      return provider;
    },
    llmCalls,
    structuredCalls,
  };
}

describe('classifyIntent', () => {
  it('REQ-1: makes exactly one completeStructured call, on the caller-resolved provider+model (never hardcoded)', async () => {
    const deps = makeDeps();
    const result = await classifyIntent(deps, {
      repoRef: REPO_REF,
      pull: { title: 'Add rate limiting', body: 'closes #1' },
      diff: emptyDiff(),
      model: MODEL,
    });

    expect(deps.structuredCalls).toHaveLength(1);
    expect(deps.structuredCalls[0]!.schemaName).toBe(INTENT_SCHEMA_NAME);
    expect(deps.structuredCalls[0]!.model).toBe(MODEL.model);
    expect(deps.llmCalls).toEqual([{ provider: 'openrouter' }]);
    expect(result.fallback).toBe(false);
  });

  it('REQ-6: clamps a high model confidence downward to medium when a source is unreachable', async () => {
    const deps = makeDeps({
      fixture: { intent: 'x', in_scope: [], out_of_scope: [], confidence: 'high' },
      rejectIssue: true, // linked_issue becomes `unreachable`
    });
    const result = await classifyIntent(deps, {
      repoRef: REPO_REF,
      pull: { title: 'Add rate limiting', body: 'A real, substantial description. closes #999' },
      diff: emptyDiff(),
      model: MODEL,
    });
    expect(result.intent.confidence).toBe('medium');
  });

  it('REQ-6: the clamp never raises — a low model confidence stays low even when every source lands "used"', async () => {
    const deps = makeDeps({
      fixture: { intent: 'x', in_scope: [], out_of_scope: [], confidence: 'low' },
    });
    // Strengthen the fixture so pr_body, linked_issue AND plan_or_spec (plus
    // file_list) all land `used` — not just pr_body with the other three
    // `missing`. Only this arrangement can catch a "boost to high once every
    // source is used" mutant: with 3 `missing` sources, `sources.every(s =>
    // s.status === 'used')` is already false before any mutation, so such a
    // mutant would leave `modelConfidence` untouched and the assertion below
    // would pass vacuously either way.
    deps.git = {
      ...deps.git,
      readFile: async (_repo: RepoRef, path: string): Promise<string> =>
        path === 'docs/plan.md' ? '# Plan\n\nRollout details for the change.' : '',
    };
    const result = await classifyIntent(deps, {
      repoRef: REPO_REF,
      pull: {
        title: 'Add rate limiting',
        body: 'A real, substantial description of the change. Closes #42. See docs/plan.md for the design.',
      },
      diff: {
        raw: '',
        files: [
          {
            path: 'src/middleware/ratelimit.ts',
            additions: 4,
            deletions: 0,
            hunks: [
              {
                file: 'src/middleware/ratelimit.ts',
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 4,
                newLineNumbers: [1, 2, 3, 4],
              },
            ],
          },
        ],
      },
      model: MODEL,
    });
    // Anti-vacuity: prove the "full evidence" premise the test name claims —
    // every gathered source really did land `used` — before trusting the
    // confidence assertion that depends on it.
    expect(result.intent.sources.every((s) => s.status === 'used')).toBe(true);
    expect(result.intent.confidence).toBe('low');
  });

  it('REQ-6: a high model answer is clamped to low when the PR has no real signal (no body, no linked issue, no plan/spec)', async () => {
    const deps = makeDeps({
      fixture: { intent: 'x', in_scope: [], out_of_scope: [], confidence: 'high' },
    });
    const result = await classifyIntent(deps, {
      repoRef: REPO_REF,
      pull: { title: 'Add rate limiting', body: null },
      diff: emptyDiff(),
      model: MODEL,
    });
    expect(result.intent.confidence).toBe('low');
  });

  it('W2: a huge changed-file list (file_list truncated) does NOT degrade an otherwise well-supported high confidence', async () => {
    const deps = makeDeps({
      fixture: { intent: 'x', in_scope: [], out_of_scope: [], confidence: 'high' },
    });
    const result = await classifyIntent(deps, {
      repoRef: REPO_REF,
      pull: {
        title: 'Add correlation ID logging',
        body: 'A real, substantial description of the change, covering rationale and rollout plan.',
      },
      diff: bigFileListDiff(),
      model: MODEL,
    });
    // The mutation this guards against (W2 revert) is silent unless we prove
    // the file list actually WAS truncated — otherwise a broken fixture that
    // never crosses FILE_LIST_MAX_CHARS would make this pass vacuously.
    expect(result.intent.sources).toContainEqual(
      expect.objectContaining({ kind: 'file_list', status: 'truncated' }),
    );
    expect(result.intent.confidence).toBe('high');
  });

  it('REQ-13: logs a composition record before the call with provider/model/token estimate and per-source kind+status+chars, and no document text', async () => {
    const deps = makeDeps();
    const log = makeLogger();
    const secretMarker = 'MY-VERY-SECRET-PR-BODY-TEXT-MARKER';
    await classifyIntent(deps, {
      repoRef: REPO_REF,
      pull: { title: 'Add rate limiting', body: secretMarker },
      diff: emptyDiff(),
      model: MODEL,
      log,
    });

    expect(log.infoCalls).toHaveLength(1);
    const [msg, data] = log.infoCalls[0]!;
    expect(msg).toBe('intent: prompt composed');
    const payload = data as {
      provider: string;
      model: string;
      estimatedTokens: number;
      sources: { kind: string; status: string; chars: number }[];
    };
    expect(payload.provider).toBe('openrouter');
    expect(payload.model).toBe(MODEL.model);
    expect(payload.estimatedTokens).toBeGreaterThan(0);
    expect(payload.sources.some((s) => s.kind === 'pr_body' && s.status === 'used')).toBe(true);

    // No secret / no document body: the payload never contains the actual PR
    // body text, only counts and identifiers.
    expect(JSON.stringify(payload)).not.toContain(secretMarker);
  });

  it('REQ-7: an unresolvable provider or a rejected/malformed model response resolves with a low-confidence fallback, never throws', async () => {
    const rejectResolveDeps = makeDeps({ rejectResolve: new Error('OPENROUTER_API_KEY is not configured') });
    const logA = makeLogger();
    const resultA = await classifyIntent(rejectResolveDeps, {
      repoRef: REPO_REF,
      pull: { title: 'Add rate limiting', body: 'x' },
      diff: emptyDiff(),
      model: MODEL,
      log: logA,
    });
    expect(resultA.fallback).toBe(true);
    expect(resultA.intent.confidence).toBe('low');
    expect(logA.errorCalls.length).toBeGreaterThan(0);

    const malformedResponseDeps = makeDeps({ fixture: { not: 'a valid classification' } });
    const resultB = await classifyIntent(malformedResponseDeps, {
      repoRef: REPO_REF,
      pull: { title: 'Add rate limiting', body: 'x' },
      diff: emptyDiff(),
      model: MODEL,
    });
    expect(resultB.fallback).toBe(true);
    expect(resultB.intent.confidence).toBe('low');
  });

  it('REQ-7: resolves with a fallback (never rejects) when source gathering itself throws', async () => {
    const deps = makeDeps();
    const log = makeLogger();
    const result = await classifyIntent(deps, {
      repoRef: REPO_REF,
      pull: { title: 'Add rate limiting', body: 'x' },
      diff: malformedDiff(),
      model: MODEL,
      log,
    });
    expect(result.fallback).toBe(true);
    expect(result.intent.confidence).toBe('low');
    expect(deps.structuredCalls).toHaveLength(0); // never reached the LLM call
    expect(log.errorCalls.length).toBeGreaterThan(0);
  });
});
