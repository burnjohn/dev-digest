import { describe, it, expect } from 'vitest';
import { Review } from '@devdigest/shared';
import {
  MockLLMProvider,
  MockGitClient,
  MockGitHubClient,
  MockCodeIndex,
  MockEmbedder,
} from '../src/adapters/mocks.js';
import { assemblePrompt } from '../src/platform/prompt.js';
import { groundFindings } from '../src/platform/grounding.js';
import { estimateCost } from '../src/adapters/llm/pricing.js';

describe('mock adapters (no network)', () => {
  it('MockGitClient.diff parses into hunks with new line numbers', async () => {
    const git = new MockGitClient();
    const diff = await git.diff();
    expect(diff.files[0]!.path).toBe('src/config.ts');
    expect(diff.files[0]!.hunks[0]!.newLineNumbers.length).toBeGreaterThan(0);
  });

  it('MockGitHubClient records posted reviews and opened PRs', async () => {
    const gh = new MockGitHubClient();
    await gh.postReview({ owner: 'a', name: 'b' }, 482, { body: 'x', event: 'COMMENT' });
    expect(gh.posted).toHaveLength(1);
    const { url } = await gh.openPullRequest({ owner: 'a', name: 'b' }, {
      title: 't',
      head: 'h',
      base: 'main',
      body: 'b',
    });
    expect(url).toContain('github.com');
  });

  it('MockCodeIndex + MockEmbedder return deterministic shapes', async () => {
    const ci = new MockCodeIndex();
    expect((await ci.symbols({ owner: 'a', name: 'b' }))[0]!.name).toBe('rateLimit');
    const emb = await new MockEmbedder().embed(['a', 'b']);
    expect(emb[0]!).toHaveLength(1536);
  });

  it('MockGitHubClient.getRepoTree returns the default fixture tree with { path, type } entries', async () => {
    const gh = new MockGitHubClient();
    const tree = await gh.getRepoTree({ owner: 'a', name: 'b' }, 'main');
    expect(tree).toEqual([
      { path: 'src', type: 'tree' },
      { path: 'src/index.ts', type: 'blob' },
      { path: 'package.json', type: 'blob' },
      { path: 'README.md', type: 'blob' },
    ]);
  });

  it('MockGitHubClient.getRepoTree respects a MockGitHubOptions.tree override', async () => {
    const customTree = [{ path: 'lib', type: 'tree' as const }, { path: 'lib/main.ts', type: 'blob' as const }];
    const gh = new MockGitHubClient({ tree: customTree });
    const tree = await gh.getRepoTree({ owner: 'a', name: 'b' });
    expect(tree).toEqual(customTree);
  });

  it('MockGitHubClient.getFileContents returns the fixture content for a known path', async () => {
    const gh = new MockGitHubClient();
    const contents = await gh.getFileContents({ owner: 'a', name: 'b' }, 'package.json', 'main');
    expect(contents).toContain('"name": "mock-repo"');
  });

  it('MockGitHubClient.getFileContents returns null for a path absent from the fixture (404→null contract)', async () => {
    const gh = new MockGitHubClient();
    const contents = await gh.getFileContents({ owner: 'a', name: 'b' }, 'does/not/exist.ts', 'main');
    expect(contents).toBeNull();
  });

  // NOTE: OctokitGitHubClient (src/adapters/github/octokit.ts) is not unit-tested at the
  // Octokit-injection level — no test in this repo mocks/injects a fake Octokit instance for
  // ANY method on that adapter (see server/test/adapters.test.ts, server/test/onboarding-*.test.ts).
  // That's consistent with the established convention here: Octokit HTTP behavior (incl. the
  // getFileContents 404→null branch at octokit.ts:426-432) is exercised indirectly through
  // MockGitHubClient-backed service tests, e.g. the lite-mode / AC-12 no-data-fallback specs in
  // server/test/onboarding-service.test.ts. Introducing a new fake-Octokit harness here would be
  // a new pattern, not an extension of an existing one, so it's intentionally out of scope.
});

describe('structured review pipeline (mock LLM → grounding)', () => {
  it('runs assemble → completeStructured(Review) → groundFindings end-to-end', async () => {
    // a fixture review where one finding is grounded and one is hallucinated
    const fixture = {
      verdict: 'request_changes',
      summary: 'secret key committed',
      score: 38,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
          rationale: 'sk_live in diff',
          confidence: 0.98,
          kind: 'finding',
        },
        {
          id: 'f-hallucinated',
          severity: 'WARNING',
          category: 'bug',
          title: 'phantom finding on a line not in the diff',
          file: 'src/config.ts',
          start_line: 999,
          end_line: 999,
          rationale: 'not real',
          confidence: 0.3,
          kind: 'finding',
        },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const git = new MockGitClient();
    const diff = await git.diff();

    const { messages } = assemblePrompt({
      system: 'security reviewer',
      diff: diff.raw,
      task: 'Review PR #482',
    });
    const result = await llm.completeStructured({
      model: 'gpt-4.1',
      schema: Review,
      schemaName: 'Review',
      messages,
    });
    expect(result.data.findings).toHaveLength(2);

    const grounded = groundFindings(result.data.findings, diff);
    expect(grounded.kept).toHaveLength(1); // the real one survives
    expect(grounded.kept[0]!.id).toBe('f1');
    expect(grounded.dropped[0]!.finding.id).toBe('f-hallucinated');
    expect(llm.calls.find((c) => c.method === 'completeStructured')).toBeTruthy();
  });
});

describe('pricing / cost discipline', () => {
  it('estimates cost for known models and returns null for unknown', () => {
    expect(estimateCost('gpt-4o-mini', 1_000_000, 0)).toBeCloseTo(0.15, 5);
    expect(estimateCost('some-future-model', 1000, 1000)).toBeNull();
  });
});
