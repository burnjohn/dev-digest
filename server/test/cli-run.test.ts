import { describe, it, expect, vi } from 'vitest';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { runReviewCli, type CliDeps } from '../src/cli/run.js';

/** A real unified diff: line 11 is the added `secret` line (grounding keeps it). */
const DIFF = [
  'diff --git a/src/config.ts b/src/config.ts',
  '--- a/src/config.ts',
  '+++ b/src/config.ts',
  '@@ -10,3 +10,4 @@ export function helper() {',
  '   const a = 1;',
  '+  const secret = "sk_live_deadbeef";',
  '   return a;',
  ' }',
].join('\n');

/** Structured Review the mocked LLM returns: one grounded CRITICAL on line 11. */
const REVIEW_FIXTURE = {
  verdict: 'request_changes',
  summary: 'secret committed',
  score: 20,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'sk_live in the working copy',
      confidence: 0.98,
      kind: 'finding',
    },
  ],
};

function deps(over: Partial<CliDeps> & { diff: string; llm?: MockLLMProvider }): {
  d: CliDeps;
  out: () => string;
  llm: MockLLMProvider;
  makeLlm: ReturnType<typeof vi.fn>;
} {
  const llm = over.llm ?? new MockLLMProvider('openrouter', { structured: REVIEW_FIXTURE });
  const chunks: string[] = [];
  const makeLlm = vi.fn(async () => llm);
  const d: CliDeps = {
    mode: 'working',
    runGit: async () => over.diff,
    makeLlm,
    systemPrompt: 'You are a code reviewer.',
    model: 'deepseek/deepseek-v4-flash',
    color: false,
    write: (s) => chunks.push(s),
    ...over,
  };
  return { d, out: () => chunks.join(''), llm, makeLlm };
}

describe('runReviewCli — reuse the Structured Reviewer from the CLI (L04)', () => {
  it('C.P0.1 — working diff → same engine → grounded findings printed to terminal', async () => {
    const { d, out, llm } = deps({ diff: DIFF });
    const res = await runReviewCli(d);
    // The engine really ran (the same completeStructured path the UI uses).
    expect(llm.calls.some((c) => c.method === 'completeStructured')).toBe(true);
    expect(out()).toContain('src/config.ts:11');
    expect(out()).toContain('Hardcoded secret key');
    expect(res.findingsCount).toBe(1);
  });

  it('C.P0.2 — empty working tree → empty state and ZERO model calls (no wasted tokens)', async () => {
    const { d, out, makeLlm, llm } = deps({ diff: '   \n' });
    const res = await runReviewCli(d);
    expect(makeLlm).not.toHaveBeenCalled(); // provider never even constructed
    expect(llm.calls.length).toBe(0);
    expect(res.llmCalls).toBe(0);
    expect(out()).toMatch(/nothing to review|clean/i);
  });

  it('C.P1.1 — a CRITICAL blocker → non-zero exit code (usable as a pre-push hook)', async () => {
    const { d } = deps({ diff: DIFF });
    const res = await runReviewCli(d);
    expect(res.exitCode).toBe(1);
  });

  it('C.P1.2 — no blockers (findings dropped by grounding) → exit 0', async () => {
    // Finding cites line 999 — not in the diff → grounding drops it → no blockers.
    const llm = new MockLLMProvider('openrouter', {
      structured: {
        ...REVIEW_FIXTURE,
        findings: [{ ...REVIEW_FIXTURE.findings[0], start_line: 999, end_line: 999 }],
      },
    });
    const { d } = deps({ diff: DIFF, llm });
    const res = await runReviewCli(d);
    expect(res.exitCode).toBe(0);
    expect(res.findingsCount).toBe(0);
  });
});
