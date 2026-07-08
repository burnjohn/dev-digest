/**
 * skills/eval-scoring.ts unit tests — hermetic.
 *
 * `patternMatch` is a pure function (zero I/O, zero LLM calls, AC-27) and is exercised WITHOUT
 * any LLM mock. `judgePractices` is exercised via `MockLLMProvider` (`src/adapters/mocks.ts`),
 * routed through a hand-built fake `Container` exposing only `llm()` (mirrors the
 * `buildContainer` helper pattern already established in `test/eval-service.test.ts`).
 */
import { describe, it, expect, vi } from 'vitest';
import { patternMatch, judgePractices, casePassed } from '../src/modules/skills/eval-scoring.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { Container } from '../src/platform/container.js';
import type { JudgeVerdict } from '@devdigest/shared';

function buildContainer(llm: MockLLMProvider): Container {
  const container = {
    db: {} as never,
    llm: vi.fn().mockResolvedValue(llm),
  };
  return container as unknown as Container;
}

describe('patternMatch', () => {
  it('passes when every expected substring is present (case-insensitive)', () => {
    const output = 'The review flags a SQL Injection risk in the query builder.';
    const result = patternMatch(output, ['sql injection', 'query builder']);
    expect(result).toEqual({ passed: true, missing: [] });
  });

  it('fails and reports exactly the missing substring when one is absent', () => {
    const output = 'The review flags a SQL Injection risk.';
    const result = patternMatch(output, ['sql injection', 'rate limiting']);
    expect(result.passed).toBe(false);
    expect(result.missing).toEqual(['rate limiting']);
  });

  it('reports ALL missing substrings when more than one is absent', () => {
    const output = 'Nothing relevant here.';
    const result = patternMatch(output, ['sql injection', 'rate limiting', 'xss']);
    expect(result.passed).toBe(false);
    expect(result.missing).toEqual(['sql injection', 'rate limiting', 'xss']);
  });

  it('an empty expected array is vacuously satisfied (AC-20 — no grounding requirement)', () => {
    expect(patternMatch('anything at all', [])).toEqual({ passed: true, missing: [] });
    expect(patternMatch('', [])).toEqual({ passed: true, missing: [] });
  });

  it('AC-27: patternMatch makes ZERO LLM provider calls', () => {
    const llm = new MockLLMProvider('openai');
    // patternMatch does not accept a Container/LLMProvider at all — invoking it cannot touch
    // the mock. Assert the mock's call count is 0 before AND after to make the "zero LLM calls"
    // claim explicit and verifiable, not just structural.
    expect(llm.calls.length).toBe(0);
    patternMatch('some output text mentioning sql injection', ['sql injection']);
    patternMatch('irrelevant output', ['something missing']);
    expect(llm.calls.length).toBe(0);
  });
});

describe('judgePractices', () => {
  it('calls completeStructured exactly once and computes score = passed_count / total_count', async () => {
    const llm = new MockLLMProvider('openai', {
      structured: {
        results: [
          { practice: 'explains the security risk', passed: true, evidence: 'This exposes a secret key' },
          { practice: 'suggests a fix', passed: false, evidence: '' },
        ],
      },
    });
    const container = buildContainer(llm);

    const verdict = await judgePractices(
      container,
      'openai',
      'gpt-4.1',
      'This exposes a secret key in config.ts.',
      ['explains the security risk', 'suggests a fix'],
    );

    expect(llm.calls.length).toBe(1);
    expect(llm.calls[0]?.method).toBe('completeStructured');
    expect(verdict.score).toBeCloseTo(0.5);
    expect(verdict.results).toEqual<JudgeVerdict['results']>([
      { practice: 'explains the security risk', passed: true, evidence: 'This exposes a secret key' },
      { practice: 'suggests a fix', passed: false, evidence: '' },
    ]);
    // AC-33: the judge call's own cost is surfaced (mock returns 0.001) so the
    // orchestrator can attribute it per-case, not drop it.
    expect(verdict.costUsd).toBe(0.001);
  });

  it('resolves the provider via container.llm(provider) — never a concrete adapter import', async () => {
    const llm = new MockLLMProvider('anthropic', {
      structured: { results: [{ practice: 'p1', passed: true, evidence: 'quote' }] },
    });
    const container = buildContainer(llm);
    const llmSpy = container.llm as unknown as ReturnType<typeof vi.fn>;

    await judgePractices(container, 'anthropic', 'claude-haiku-4.5', 'output text', ['p1']);

    expect(llmSpy).toHaveBeenCalledWith('anthropic');
  });

  it('a mixed pass/fail verdict with all practices failing yields score 0', async () => {
    const llm = new MockLLMProvider('openai', {
      structured: {
        results: [
          { practice: 'p1', passed: false, evidence: '' },
          { practice: 'p2', passed: false, evidence: '' },
        ],
      },
    });
    const container = buildContainer(llm);

    const verdict = await judgePractices(container, 'openai', 'gpt-4.1', 'output', ['p1', 'p2']);
    expect(verdict.score).toBe(0);
  });
});

describe('casePassed', () => {
  const passingVerdict: JudgeVerdict = { score: 0.8, results: [] };
  const failingVerdict: JudgeVerdict = { score: 0.3, results: [] };

  it('grounding fail short-circuits to false regardless of judge outcome', () => {
    expect(
      casePassed({ passed: false }, true, passingVerdict, true, 0.6),
    ).toBe(false);
    // Even with no practices to judge at all, a failed grounding gate still fails the case.
    expect(casePassed({ passed: false }, true, null, false, 0.6)).toBe(false);
  });

  it('no grounding requirement AND no practices to judge passes trivially', () => {
    expect(casePassed({ passed: true }, false, null, false, 0.6)).toBe(true);
  });

  it('grounding passed AND judge score >= threshold passes', () => {
    expect(casePassed({ passed: true }, true, passingVerdict, true, 0.6)).toBe(true);
  });

  it('grounding passed AND judge score < threshold fails', () => {
    expect(casePassed({ passed: true }, true, failingVerdict, true, 0.6)).toBe(false);
  });

  it('boundary: judge score exactly equal to the threshold passes (>=, not >)', () => {
    const exactVerdict: JudgeVerdict = { score: 0.6, results: [] };
    expect(casePassed({ passed: true }, true, exactVerdict, true, 0.6)).toBe(true);
    // One float epsilon below the threshold still fails — confirms the
    // comparison is a real >=, not an off-by-something rounding artifact.
    const justBelowVerdict: JudgeVerdict = { score: 0.5999999, results: [] };
    expect(casePassed({ passed: true }, true, justBelowVerdict, true, 0.6)).toBe(false);
  });

  it('practices required but judgeResult is null fails cleanly, without touching .score on null', () => {
    // Mutation-testing find: `judgeOk`'s `judgeResult !== null` guard had no
    // direct test — a mutant that hardcodes it to `true` still passes every
    // other casePassed test, since none call this with hasPractices=true AND
    // judgeResult=null simultaneously. hasGrounding=false isolates this from
    // groundingOk (already covered above), so only the judge-side null guard
    // is exercised. Without the real `!== null` check, `judgeResult.score`
    // would throw on a null judgeResult instead of returning false.
    expect(casePassed({ passed: true }, false, null, true, 0.6)).toBe(false);
  });
});
