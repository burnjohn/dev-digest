import { describe, it, expect } from 'vitest';
import type { GitClient, GitHubClient, IssueMeta, RepoRef, UnifiedDiff } from '@devdigest/shared';
import {
  truncateMarkdown,
  linkedIssueRefs,
  planSpecRefs,
  gatherIntentSources,
  type IntentSourceDeps,
} from '../src/modules/reviews/intent-sources.js';

/**
 * Hermetic unit coverage for `intent-sources.ts` (plan 03-intent-layer.md §5.1,
 * T4). No DB, no network — `IntentSourceDeps` is stubbed in-file. Covers:
 *   - `truncateMarkdown`'s budget boundary and the `truncated` vs `used`
 *     distinction (REQ-5: a cut source must never report `used`).
 *   - `linkedIssueRefs` / `planSpecRefs` pure parsing.
 *   - `gatherIntentSources` source selection, per-source budgets, and the
 *     REQ-3 invariant that no diff/change body ever reaches the prompt.
 */

const REPO_REF: RepoRef = { owner: 'acme', name: 'payments-api' };

function emptyDiff(): UnifiedDiff {
  return { raw: '', files: [] };
}

function diffWithHunk(): UnifiedDiff {
  return {
    raw: 'diff --git a/src/config.ts b/src/config.ts\n+  stripeKey: "sk_live_SECRET_MARKER",',
    files: [
      {
        path: 'src/config.ts',
        additions: 4,
        deletions: 1,
        hunks: [
          {
            file: 'src/config.ts',
            oldStart: 10,
            oldLines: 3,
            newStart: 10,
            newLines: 4,
            newLineNumbers: [10, 11, 12, 13],
          },
        ],
      },
    ],
  };
}

/** Stub `IntentSourceDeps` — hermetic, no DB, no network (per lane rules). */
function makeDeps(opts: {
  files?: Record<string, string>;
  readFileThrows?: Set<string>;
  issue?: IssueMeta | 'reject';
} = {}): IntentSourceDeps & { readFileCalls: string[] } {
  const readFileCalls: string[] = [];
  const git: GitClient = {
    clonePathFor: () => '/mock',
    clone: async () => ({ path: '/mock' }),
    fetchPullHead: async () => {},
    sync: async () => ({ head: 'sha' }),
    currentHead: async () => 'sha',
    diff: async () => emptyDiff(),
    blame: async () => [],
    log: async () => [],
    readFile: async (_repo: RepoRef, path: string) => {
      readFileCalls.push(path);
      if (opts.readFileThrows?.has(path)) {
        throw new Error(`ENOENT: no such file, open '${path}'`);
      }
      return opts.files?.[path] ?? '';
    },
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
      if (opts.issue === 'reject') throw new Error('GitHub 404');
      return opts.issue ?? { number: n, title: `Issue #${n}`, body: 'issue body', state: 'open' };
    },
    currentLogin: async () => 'mock-user',
  } as unknown as GitHubClient;

  return { git, github: async () => github, readFileCalls };
}

describe('truncateMarkdown', () => {
  it('does not truncate text exactly at the budget', () => {
    const text = 'x'.repeat(50);
    const result = truncateMarkdown(text, 50);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(text);
    expect(result.chars).toBe(50);
  });

  it('truncates text one char over budget, and it is never reported as used-equivalent', () => {
    const text = 'x'.repeat(51);
    const result = truncateMarkdown(text, 50);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('[… truncated …]');
  });

  it('heading-aware cut keeps a heading that lives past the cut point (never a naive head slice)', () => {
    const filler = 'no heading here, just prose. '.repeat(20); // ~600 chars, no heading
    const text = `${filler}\n## Late Heading\nimportant content past the cut`;
    const result = truncateMarkdown(text, 80);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('## Late Heading');
  });
});

describe('linkedIssueRefs', () => {
  it('parses issue references in order of first appearance and dedups repeats', () => {
    const body = 'This closes #12 and also relates to #12, plus fixes #7.';
    expect(linkedIssueRefs(body)).toEqual([12, 7]);
  });

  it('returns [] for a null or empty body', () => {
    expect(linkedIssueRefs(null)).toEqual([]);
    expect(linkedIssueRefs(undefined)).toEqual([]);
    expect(linkedIssueRefs('')).toEqual([]);
  });
});

describe('planSpecRefs', () => {
  it('extracts a repo-relative markdown path, and scopes a blob URL to the given repo', () => {
    const body = [
      'See docs/plans/03-intent-layer.md for details.',
      'Also https://github.com/acme/payments-api/blob/main/server/specs/y.md',
      'And a foreign repo: https://github.com/other-org/other-repo/blob/main/plan.md',
    ].join('\n');
    const refs = planSpecRefs(body, REPO_REF);

    const relative = refs.find((r) => r.ref === 'docs/plans/03-intent-layer.md');
    expect(relative?.path).toBe('docs/plans/03-intent-layer.md');

    const sameRepoBlob = refs.find((r) => r.ref.includes('acme/payments-api'));
    expect(sameRepoBlob?.path).toBe('server/specs/y.md');

    const foreignBlob = refs.find((r) => r.ref.includes('other-org/other-repo'));
    expect(foreignBlob?.path).toBeNull();
  });
});

describe('gatherIntentSources', () => {
  it('REQ-3: never lets diff.raw or any hunk body reach the gathered prompt sections', async () => {
    const deps = makeDeps();
    const diff = diffWithHunk();
    const { promptSections } = await gatherIntentSources(deps, REPO_REF, { title: 't', body: null }, diff);
    const joined = promptSections.join('\n');
    expect(joined).not.toContain('sk_live_SECRET_MARKER');
    expect(joined).not.toContain(diff.raw);
    expect(joined).toContain('@@ -10,3 +10,4 @@');
  });

  it('records pr_body as missing when the body is null, and file_list as missing for an empty diff', async () => {
    const deps = makeDeps();
    const { sources, promptSections } = await gatherIntentSources(
      deps,
      REPO_REF,
      { title: 'A change', body: null },
      emptyDiff(),
    );
    expect(sources).toContainEqual({ kind: 'pr_body', ref: 'body', status: 'missing', chars: 0 });
    expect(sources).toContainEqual({ kind: 'file_list', ref: '0 files', status: 'missing', chars: 0 });
    expect(promptSections.some((s) => s.startsWith('## PR description'))).toBe(false);
  });

  it('records linked_issue as unreachable (never fabricated) when the fetch fails', async () => {
    const deps = makeDeps({ issue: 'reject' });
    const { sources } = await gatherIntentSources(
      deps,
      REPO_REF,
      { title: 't', body: 'closes #12' },
      emptyDiff(),
    );
    expect(sources).toContainEqual({ kind: 'linked_issue', ref: '#12', status: 'unreachable', chars: 0 });
  });

  it('adds an inline plan_or_spec audit record for a long, heading-rich PR body without duplicating its text', async () => {
    const heading1 = '## Section One\n' + 'content line. '.repeat(50);
    const heading2 = '## Section Two\n' + 'more content. '.repeat(50);
    const body = `${heading1}\n${heading2}`; // > 1200 chars, >= 2 ATX headings
    expect(body.length).toBeGreaterThan(1200);

    const deps = makeDeps();
    const { sources, promptSections } = await gatherIntentSources(
      deps,
      REPO_REF,
      { title: 't', body },
      emptyDiff(),
    );

    const inline = sources.find((s) => s.kind === 'plan_or_spec' && s.ref === 'inline (PR body)');
    expect(inline).toBeDefined();
    expect(sources.filter((s) => s.kind === 'pr_body')).toHaveLength(1);

    const occurrences = promptSections.join('\n\n').split('Section One').length - 1;
    expect(occurrences).toBe(1);
  });

  it('rejects a path-traversal reference before ever calling git.readFile, and records it unreachable', async () => {
    const deps = makeDeps();
    // `docs/../../../etc/passwd.md` starts with a word character, so it PASSES
    // `planSpecRefs`'s repo-relative shape test (`path` is non-null) and only
    // the path-safety gate in `gatherIntentSources` (the `..`-segment check)
    // can reject it — unlike a leading `../` or `/`, which `planSpecRefs`
    // itself already treats as non-repo-relative before any safety check runs.
    const body = 'See docs/../../../etc/passwd.md for reference.';
    const { sources } = await gatherIntentSources(deps, REPO_REF, { title: 't', body }, emptyDiff());

    const planSpecSources = sources.filter((s) => s.kind === 'plan_or_spec');
    expect(planSpecSources.length).toBeGreaterThan(0);
    expect(planSpecSources.every((s) => s.status === 'unreachable')).toBe(true);
    expect(deps.readFileCalls).toHaveLength(0);
  });

  it('exhausts the aggregate plan_or_spec budget: later valid references are skipped, not fetched', async () => {
    // Four distinct, safe, same-repo blob URLs so `planSpecRefs` yields four
    // candidates without needing four literal file paths in the body.
    const refs = ['a', 'b', 'c', 'd'].map(
      (letter) => `https://github.com/acme/payments-api/blob/main/docs/${letter}.md`,
    );
    const body = refs.join('\n');
    // Each doc is 5,900 chars — under its own 6,000-char per-source budget
    // (so each read is reported `used`, not `truncated`), but three of them
    // exhaust the 18,000-char aggregate budget (3 * 5,900 = 17,700; the
    // remaining 300 chars trips the 1,000-char minimum-slice guard).
    const files: Record<string, string> = {
      'docs/a.md': 'x'.repeat(5900),
      'docs/b.md': 'x'.repeat(5900),
      'docs/c.md': 'x'.repeat(5900),
      'docs/d.md': 'x'.repeat(5900),
    };
    const deps = makeDeps({ files });

    const { sources } = await gatherIntentSources(deps, REPO_REF, { title: 't', body }, emptyDiff());
    const planSpecSources = sources.filter((s) => s.kind === 'plan_or_spec');
    expect(planSpecSources).toHaveLength(4);
    expect(planSpecSources.slice(0, 3).every((s) => s.status === 'used')).toBe(true);
    expect(planSpecSources[3]!.status).toBe('skipped');
    expect(deps.readFileCalls).toHaveLength(3);
  });
});
