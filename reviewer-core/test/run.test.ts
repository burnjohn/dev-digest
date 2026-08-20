import { describe, it, expect, vi } from 'vitest';
import type {
  LLMProvider,
  Review,
  StructuredRequest,
  StructuredResult,
  UnifiedDiff,
} from '@devdigest/shared';
import { MockLLMProvider, MockGitClient } from '../../server/src/adapters/mocks.js';
import {
  CLAUDE_HAIKU_45,
  CLAUDE_SONNET_46,
  GPT_56_LUNA,
  GPT_56_TERRA,
  reviewPullRequest,
} from '../src/index.js';

type ScriptedHandler = (
  req: StructuredRequest<unknown>,
) => Promise<StructuredResult<unknown>>;

class ScriptedLLM implements LLMProvider {
  readonly calls: StructuredRequest<unknown>[] = [];

  constructor(
    readonly id: LLMProvider['id'],
    private readonly handler: ScriptedHandler,
  ) {}

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push(req as StructuredRequest<unknown>);
    return (await this.handler(req as StructuredRequest<unknown>)) as StructuredResult<T>;
  }

  async listModels() {
    return [];
  }

  async complete(): Promise<never> {
    throw new Error('not used');
  }

  async embed() {
    return [];
  }
}

function structured(
  model: string,
  data: Review,
  usage: { tokensIn?: number; tokensOut?: number; costUsd?: number | null } = {},
): StructuredResult<unknown> {
  return {
    data,
    model,
    tokensIn: usage.tokensIn ?? 10,
    tokensOut: usage.tokensOut ?? 5,
    costUsd: usage.costUsd ?? 0.01,
    raw: JSON.stringify(data),
    attempts: 1,
  };
}

function largeTwoFileDiff(): UnifiedDiff {
  const files = ['src/a.ts', 'src/b.ts'];
  const raw = files
    .map((path, index) =>
      [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        '@@ -1,1 +1,1 @@',
        `+export const value${index} = '${String(index).repeat(2_000)}';`,
      ].join('\n'),
    )
    .join('\n');
  return {
    raw,
    files: files.map((path) => ({
      path,
      additions: 1,
      deletions: 0,
      hunks: [{ file: path, oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, newLineNumbers: [1] }],
    })),
  };
}

function largeFourFileDiff(): UnifiedDiff {
  const files = Array.from({ length: 4 }, (_, index) => `src/file-${index}.ts`);
  const raw = files
    .map((path, index) =>
      [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        '@@ -1,1 +1,1 @@',
        `+export const value${index} = '${String(index).repeat(2_000)}';`,
      ].join('\n'),
    )
    .join('\n');
  return {
    raw,
    files: files.map((path) => ({
      path,
      additions: 1,
      deletions: 0,
      hunks: [{ file: path, oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, newLineNumbers: [1] }],
    })),
  };
}

function requestText(req: StructuredRequest<unknown>): string {
  return req.messages.map((message) => message.content).join('\n');
}

/**
 * Engine-level test for reviewPullRequest (the core lifted out of the server's
 * runOneAgent). Uses the server's mock LLM + git so we exercise the real
 * assemble → completeStructured → reduce → grounding pipeline with no DB/SSE.
 */
describe('reviewPullRequest (engine)', () => {
  // One grounded finding (line 11 is in the MockGitClient diff) + one
  // hallucinated finding (line 999) the grounding gate must drop.
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

  it('single-pass: assembles, grounds, drops the hallucinated finding', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();

    const events: string[] = [];
    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      diff,
      llm,
      task: 'Review PR #482',
      onEvent: (e) => events.push(e.msg),
    });

    expect(outcome.mode).toBe('single-pass');
    expect(outcome.grounding).toBe('1/2 passed');
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]!.start_line).toBe(11);
    expect(outcome.dropped).toHaveLength(1);
    // Score is derived from the SURVIVING findings, not the model's self-reported
    // 38: one CRITICAL remains after grounding ⇒ 100 − 35 = 65.
    expect(outcome.review.score).toBe(65);
    // progress is surfaced (server bridges this onto SSE; runner logs it)
    expect(events.some((m) => m.includes('Citation grounding'))).toBe(true);
  });

  it('drops a mislabeled full-file-kind finding with fabricated line anchors (kind grants no bypass)', async () => {
    // A cheap mapper can mislabel a hallucinated finding as secret_leak; inside
    // reviewPullRequest the kind must NOT exempt it from line verification —
    // only dedicated scanner stages may opt in via allowFullFileKinds.
    const mislabeled = {
      ...fixture,
      findings: [
        { ...fixture.findings[1]!, id: 'f-mislabeled', kind: 'secret_leak' },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: mislabeled });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      diff,
      llm,
    });

    expect(outcome.review.findings).toHaveLength(0);
    expect(outcome.dropped.map((d) => d.finding.id)).toContain('f-mislabeled');
    expect(outcome.dropped[0]!.reason).toMatch(/do not intersect/);
  });

  it('score is deterministic from findings: a clean approve scores 100', async () => {
    // Model "approves" but reports a nonsense low score (the cheap-model bug).
    // The engine must ignore that and score the zero findings as a perfect 100.
    const clean = { verdict: 'approve', summary: 'looks good', score: 10, findings: [] };
    const llm = new MockLLMProvider('openai', { structured: clean });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'deepseek/deepseek-v4-flash',
      diff,
      llm,
      task: 'Review PR #5',
    });

    expect(outcome.review.findings).toHaveLength(0);
    expect(outcome.review.score).toBe(100);
  });

  it('checkCancelled throwing aborts before the LLM call', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();
    await expect(
      reviewPullRequest({
        systemPrompt: 's',
        model: 'gpt-4.1',
        diff,
        llm,
        checkCancelled: () => {
          throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');
  });

  it('forwards sessionId to every LLM call (OpenRouter session grouping)', async () => {
    const seen: (string | undefined)[] = [];
    const recorder: LLMProvider = {
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        seen.push(req.sessionId);
        return {
          data: fixture as unknown as T,
          model: req.model,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          raw: '',
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
    const diff = await new MockGitClient().diff();
    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: recorder, sessionId: 'sess-abc' });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s === 'sess-abc')).toBe(true);
  });

  it('ignores the legacy single-pass strategy and plans large diffs automatically', async () => {
    const clean: Review = { verdict: 'approve', summary: 'clean', score: 100, findings: [] };
    const llm = new ScriptedLLM('openai', async (req) => structured(req.model, clean));

    const outcome = await reviewPullRequest({
      systemPrompt: 'general reviewer',
      model: 'gpt-direct',
      diff: largeTwoFileDiff(),
      llm,
      strategy: 'single-pass',
      maxPromptTokens: 1_200,
      minDiffTokens: 100,
    });

    expect(outcome.mode).toBe('map-reduce');
    expect(llm.calls).toHaveLength(2);
    expect(outcome.chunks.map((chunk) => chunk.label)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('maps independent chunks with bounded concurrency and aggregates them in diff order', async () => {
    const clean: Review = { verdict: 'approve', summary: 'clean', score: 100, findings: [] };
    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const llm = new ScriptedLLM('openai', async (req) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await gate;
      active--;
      return structured(req.model, clean);
    });

    const running = reviewPullRequest({
      systemPrompt: 'general reviewer',
      model: 'gpt-direct',
      diff: largeFourFileDiff(),
      llm,
      maxPromptTokens: 1_200,
      minDiffTokens: 100,
    });

    let startError: unknown;
    try {
      await vi.waitFor(() => expect(llm.calls).toHaveLength(3), { timeout: 250, interval: 10 });
    } catch (error) {
      startError = error;
    }
    release();
    const outcome = await running;
    if (startError) throw startError;

    expect(maxActive).toBe(3);
    expect(outcome.chunks.map((chunk) => chunk.label)).toEqual([
      'src/file-0.ts',
      'src/file-1.ts',
      'src/file-2.ts',
      'src/file-3.ts',
    ]);
    expect(outcome.tokensIn).toBe(40);
    expect(outcome.tokensOut).toBe(20);
    expect(outcome.costUsd).toBeCloseTo(0.04);
  });

  it('aborts sibling mapper calls and does not start queued chunks after one chunk exhausts fallbacks', async () => {
    const aborted = new Set<string>();
    const llm = new ScriptedLLM('openrouter', async (req) => {
      const text = requestText(req);
      if (text.includes('src/file-0.ts')) throw new Error(`${req.model} unavailable`);

      const path = ['src/file-1.ts', 'src/file-2.ts'].find((candidate) => text.includes(candidate));
      if (!path) throw new Error('queued chunk started after fatal mapper failure');
      if (!req.signal) throw new Error('mapper request is missing its cancellation signal');
      return await new Promise<StructuredResult<unknown>>((_, reject) => {
        const onAbort = () => {
          aborted.add(path);
          reject(req.signal!.reason);
        };
        if (req.signal!.aborted) onAbort();
        else req.signal!.addEventListener('abort', onAbort, { once: true });
      });
    });

    await expect(
      reviewPullRequest({
        systemPrompt: 'general reviewer',
        model: 'broken/primary',
        diff: largeFourFileDiff(),
        llm,
        maxPromptTokens: 1_200,
        minDiffTokens: 100,
      }),
    ).rejects.toThrow(/src\/file-0\.ts.*broken\/primary.*gpt-5\.6-luna.*claude-haiku-4\.5/);

    expect(aborted).toEqual(new Set(['src/file-1.ts', 'src/file-2.ts']));
    expect(llm.calls.some((call) => requestText(call).includes('src/file-3.ts'))).toBe(false);
  });

  it('cancels every in-flight mapper without starting fallbacks or queued chunks', async () => {
    const controller = new AbortController();
    let aborted = 0;
    const llm = new ScriptedLLM('openrouter', async (req) => {
      if (!req.signal) throw new Error('mapper request is missing its cancellation signal');
      return await new Promise<StructuredResult<unknown>>((_, reject) => {
        const onAbort = () => {
          aborted++;
          reject(req.signal!.reason);
        };
        if (req.signal!.aborted) onAbort();
        else req.signal!.addEventListener('abort', onAbort, { once: true });
      });
    });

    const running = reviewPullRequest({
      systemPrompt: 'general reviewer',
      model: 'preferred/model',
      diff: largeFourFileDiff(),
      llm,
      signal: controller.signal,
      maxPromptTokens: 1_200,
      minDiffTokens: 100,
    });

    let startError: unknown;
    try {
      await vi.waitFor(() => expect(llm.calls).toHaveLength(3), { timeout: 250, interval: 10 });
    } catch (error) {
      startError = error;
    }
    controller.abort(new Error('cancelled by user'));
    await expect(running).rejects.toThrow('cancelled by user');
    if (startError) throw startError;

    expect(aborted).toBe(3);
    expect(llm.calls).toHaveLength(3);
  });

  it('falls back per chunk and adjudicates grounded candidates on OpenRouter', async () => {
    const diff = await new MockGitClient().diff();
    const finalReview = { ...fixture, findings: [fixture.findings[0]!] } as Review;
    const events: string[] = [];
    const llm = new ScriptedLLM('openrouter', async (req) => {
      if (req.model === 'broken/primary') throw new Error('primary unavailable');
      if (req.model === GPT_56_LUNA) return structured(req.model, fixture as Review);
      if (req.model === CLAUDE_SONNET_46) return structured(req.model, finalReview);
      throw new Error(`unexpected model ${req.model}`);
    });

    const outcome = await reviewPullRequest({
      systemPrompt: 'general reviewer',
      model: 'broken/primary',
      diff,
      llm,
      onEvent: (event) => events.push(event.msg),
    });

    expect(llm.calls.map((call) => call.model)).toEqual([
      'broken/primary',
      GPT_56_LUNA,
      CLAUDE_SONNET_46,
    ]);
    expect(outcome.review.findings.map((finding) => finding.id)).toEqual(['f1']);
    expect(events.some((message) => message.includes('fallback'))).toBe(true);
    const reducerUser = llm.calls[2]!.messages.find((message) => message.role === 'user')!.content;
    expect(reducerUser).toContain('"id": "f1"');
    expect(reducerUser).not.toContain('f-hallucinated');
  });

  it('does not call a mapper or fallback when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const llm = new ScriptedLLM('openrouter', async () => {
      throw new Error('must not be called');
    });

    await expect(
      reviewPullRequest({
        systemPrompt: 'general reviewer',
        model: GPT_56_LUNA,
        diff: await new MockGitClient().diff(),
        llm,
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled');
    expect(llm.calls).toHaveLength(0);
  });

  it('fails the run with the chunk and every attempted mapper when all fallbacks fail', async () => {
    const llm = new ScriptedLLM('openrouter', async (req) => {
      throw new Error(`${req.model} unavailable`);
    });

    await expect(
      reviewPullRequest({
        systemPrompt: 'general reviewer',
        model: 'broken/primary',
        diff: await new MockGitClient().diff(),
        llm,
      }),
    ).rejects.toThrow(
      new RegExp(`all files.*broken/primary.*${GPT_56_LUNA}.*${CLAUDE_HAIKU_45}`),
    );
  });

  it('skips adjudication when every mapper candidate fails grounding', async () => {
    const hallucinatedOnly = {
      ...(fixture as Review),
      findings: [fixture.findings[1]!],
    };
    const llm = new ScriptedLLM('openrouter', async (req) =>
      structured(req.model, hallucinatedOnly),
    );

    const outcome = await reviewPullRequest({
      systemPrompt: 'general reviewer',
      model: GPT_56_LUNA,
      diff: await new MockGitClient().diff(),
      llm,
    });

    expect(llm.calls.map((call) => call.model)).toEqual([GPT_56_LUNA]);
    expect(outcome.review.findings).toEqual([]);
    expect(outcome.review.score).toBe(100);
  });

  it('falls back from Sonnet to Terra and accounts for both successful stages', async () => {
    const finalReview = { ...fixture, findings: [fixture.findings[0]!] } as Review;
    const llm = new ScriptedLLM('openrouter', async (req) => {
      if (req.model === GPT_56_LUNA) {
        return structured(req.model, finalReview, { tokensIn: 100, tokensOut: 20, costUsd: 0.02 });
      }
      if (req.model === CLAUDE_SONNET_46) throw new Error('Sonnet unavailable');
      if (req.model === GPT_56_TERRA) {
        return structured(req.model, finalReview, { tokensIn: 30, tokensOut: 10, costUsd: 0.03 });
      }
      throw new Error(`unexpected model ${req.model}`);
    });

    const outcome = await reviewPullRequest({
      systemPrompt: 'general reviewer',
      model: GPT_56_LUNA,
      diff: await new MockGitClient().diff(),
      llm,
    });

    expect(llm.calls.map((call) => call.model)).toEqual([
      GPT_56_LUNA,
      CLAUDE_SONNET_46,
      GPT_56_TERRA,
    ]);
    expect(outcome.tokensIn).toBe(130);
    expect(outcome.tokensOut).toBe(30);
    expect(outcome.costUsd).toBeCloseTo(0.05);
    expect(outcome.chunks.map((chunk) => `${chunk.stage}:${chunk.model}`)).toEqual([
      `map:${GPT_56_LUNA}`,
      `adjudicate:${CLAUDE_SONNET_46}`,
      `adjudicate:${GPT_56_TERRA}`,
    ]);
  });

  it('does not let the adjudicator invent a new grounded candidate', async () => {
    const mapReview = { ...fixture, findings: [fixture.findings[0]!] } as Review;
    const invented = {
      ...fixture.findings[0]!,
      id: 'invented-by-adjudicator',
      title: 'Different claim at a valid changed line',
    };
    const llm = new ScriptedLLM('openrouter', async (req) => {
      if (req.model === GPT_56_LUNA) return structured(req.model, mapReview);
      if (req.model === CLAUDE_SONNET_46) {
        return structured(req.model, {
          ...mapReview,
          findings: [{ ...mapReview.findings[0]!, start_line: 12, end_line: 12 }, invented],
        });
      }
      throw new Error(`unexpected model ${req.model}`);
    });

    const outcome = await reviewPullRequest({
      systemPrompt: 'general reviewer',
      model: GPT_56_LUNA,
      diff: await new MockGitClient().diff(),
      llm,
    });

    expect(outcome.review.findings.map((finding) => finding.id)).toEqual(['f1']);
    expect(outcome.review.findings[0]!.start_line).toBe(11);
  });

  it('preserves exact anchors when mapper candidates reuse the same local id', async () => {
    const diff: UnifiedDiff = {
      raw: [
        'diff --git a/src/a.ts b/src/a.ts',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,1 +1,1 @@',
        '+export const a = brokenA();',
        'diff --git a/src/b.ts b/src/b.ts',
        '--- a/src/b.ts',
        '+++ b/src/b.ts',
        '@@ -1,1 +1,1 @@',
        '+export const b = brokenB();',
      ].join('\n'),
      files: ['src/a.ts', 'src/b.ts'].map((file) => ({
        path: file,
        additions: 1,
        deletions: 0,
        hunks: [{ file, oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, newLineNumbers: [1] }],
      })),
    };
    const findings = [
      { ...fixture.findings[0]!, id: 'finding-1', file: 'src/a.ts', start_line: 1, end_line: 1, title: 'A breaks' },
      { ...fixture.findings[0]!, id: 'finding-1', file: 'src/b.ts', start_line: 1, end_line: 1, title: 'B breaks' },
    ];
    const review = { ...fixture, findings } as Review;
    const llm = new ScriptedLLM('openrouter', async (req) => structured(req.model, review));

    const outcome = await reviewPullRequest({
      systemPrompt: 'general reviewer',
      model: GPT_56_LUNA,
      diff,
      llm,
    });

    expect(outcome.review.findings.map((finding) => finding.file)).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  it('returns grounded mapper findings in explicit degraded mode when both adjudicators fail', async () => {
    const mapReview = { ...fixture, findings: [fixture.findings[0]!] } as Review;
    const events: string[] = [];
    const llm = new ScriptedLLM('openrouter', async (req) => {
      if (req.model === GPT_56_LUNA) return structured(req.model, mapReview);
      throw new Error(`${req.model} unavailable`);
    });

    const outcome = await reviewPullRequest({
      systemPrompt: 'general reviewer',
      model: GPT_56_LUNA,
      diff: await new MockGitClient().diff(),
      llm,
      onEvent: (event) => events.push(event.msg),
    });

    expect(outcome.review.findings.map((finding) => finding.id)).toEqual(['f1']);
    expect(events.some((message) => /degraded/i.test(message))).toBe(true);
  });
});
