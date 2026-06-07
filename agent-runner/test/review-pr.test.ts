import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgent } from '../src/manifest.js';
import { MockLLMProvider } from '../src/llm.js';
import { MockRunnerGitHub } from '../src/github.js';
import { filesToUnifiedDiff } from '../src/diff.js';
import { reviewAndPost } from '../src/review-pr.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

// GitHub `listFiles` returns the hunk text in `patch` (no diff/--- /+++ headers).
const CONFIG_PATCH = `@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_abc123def456",
   redisUrl: x,`;

const CANNED = {
  verdict: 'request_changes',
  summary: 'A hardcoded Stripe secret was introduced.',
  score: 35,
  findings: [
    {
      id: 'f-secret',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move it to an environment variable.',
      confidence: 0.96,
      kind: 'finding',
    },
    {
      id: 'f-phantom',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'Not in the diff.',
      confidence: 0.4,
      kind: 'finding',
    },
  ],
};

describe('filesToUnifiedDiff', () => {
  it('reconstructs a UnifiedDiff from listFiles patches and reports skipped files', () => {
    const { diff, skipped } = filesToUnifiedDiff([
      { path: 'src/config.ts', patch: CONFIG_PATCH },
      { path: 'assets/logo.png', patch: null }, // binary → no patch
    ]);
    expect(diff.files.map((f) => f.path)).toEqual(['src/config.ts']);
    // line 11 (the added secret) is covered by the hunk's new-side line numbers
    expect(diff.files[0]!.hunks[0]!.newLineNumbers).toContain(11);
    expect(skipped).toEqual(['assets/logo.png']);
  });
});

describe('reviewAndPost (M2 flow: getDiff → engine → grounding → postReview)', () => {
  it('posts a grounded review to GitHub via the (mock) client', async () => {
    const agent = await loadAgent(
      join(FIX, 'agents', 'security-reviewer.yaml'),
      join(FIX, 'skills'),
    );
    const github = new MockRunnerGitHub([
      { path: 'src/config.ts', patch: CONFIG_PATCH },
      { path: 'assets/logo.png', patch: null },
    ]);

    const result = await reviewAndPost({
      github,
      llm: new MockLLMProvider(CANNED),
      agent,
      owner: 'acme',
      repo: 'payments-api',
      prNumber: 482,
    });

    // engine: grounding kept line-11, dropped line-999 phantom
    expect(result.outcome.grounding).toBe('1/2 passed');
    expect(result.outcome.review.findings).toHaveLength(1);
    expect(result.skipped).toEqual(['assets/logo.png']);

    // posted exactly one review with the right event + inline comment
    expect(result.posted?.id).toBe('mock-review-482');
    expect(github.posted).toHaveLength(1);
    const { payload, owner, prNumber } = github.posted[0]!;
    expect(owner).toBe('acme');
    expect(prNumber).toBe(482);
    expect(payload.event).toBe('REQUEST_CHANGES');
    expect(payload.comments).toHaveLength(1);
    expect(payload.comments![0]!.path).toBe('src/config.ts');
    expect(payload.comments![0]!.line).toBe(11);
    expect(payload.body).toContain('Hardcoded Stripe secret key');
  });

  it('post: "none" runs the review without posting', async () => {
    const agent = await loadAgent(
      join(FIX, 'agents', 'security-reviewer.yaml'),
      join(FIX, 'skills'),
    );
    const github = new MockRunnerGitHub([{ path: 'src/config.ts', patch: CONFIG_PATCH }]);
    const result = await reviewAndPost({
      github,
      llm: new MockLLMProvider(CANNED),
      agent,
      owner: 'acme',
      repo: 'payments-api',
      prNumber: 7,
      post: 'none',
    });
    expect(result.posted).toBeNull();
    expect(github.posted).toHaveLength(0);
    expect(result.outcome.review.findings).toHaveLength(1);
  });
});
