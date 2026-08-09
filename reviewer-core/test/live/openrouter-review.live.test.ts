import { describe, expect, it } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { OpenRouterProvider, reviewPullRequest } from '../../src/index.js';

function syntheticFile(path: string, lines: string[]): { raw: string; file: UnifiedDiff['files'][number] } {
  return {
    raw: [
      `diff --git a/${path} b/${path}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join('\n'),
    file: {
      path,
      additions: lines.length,
      deletions: 0,
      hunks: [
        {
          file: path,
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: lines.length,
          newLineNumbers: lines.map((_, index) => index + 1),
        },
      ],
    },
  };
}

function largeSyntheticDiff(): UnifiedDiff {
  const configLines = Array.from(
    { length: 280 },
    (_, index) =>
      index === 119
        ? 'export const adminToken = "sk_live_DO_NOT_USE_TEST_VALUE";'
        : `export const configValue${index} = "safe-${index}-${'x'.repeat(96)}";`,
  );
  const serviceLines = Array.from(
    { length: 280 },
    (_, index) => `export class Service${index} { run() { return "safe-${index}-${'y'.repeat(96)}"; } }`,
  );
  const files = [
    syntheticFile('src/config.ts', configLines),
    syntheticFile('src/services.ts', serviceLines),
  ];
  return { raw: files.map((entry) => entry.raw).join('\n'), files: files.map((entry) => entry.file) };
}

describe('paid OpenRouter review orchestration', () => {
  it('falls back from an invalid mapper and returns a grounded planted defect', async () => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for the paid live test');
    const provider = new OpenRouterProvider(apiKey, {
      maxRetries: 0,
      transportRetries: 0,
    });
    const events: string[] = [];
    const startedAt = Date.now();

    const outcome = await reviewPullRequest({
      systemPrompt:
        'You are a precise application-security pull-request reviewer. Report committed live-looking credentials as concrete security findings. Return no style findings.',
      model: 'invalid/devdigest-fallback-probe',
      diff: largeSyntheticDiff(),
      llm: provider,
      maxPromptTokens: 12_000,
      minDiffTokens: 1_000,
      maxRetries: 1,
      sessionId: `devdigest-live-${Date.now()}`,
      onEvent: (event) => events.push(event.msg),
    });
    const elapsedMs = Date.now() - startedAt;
    const groundedSecret = outcome.review.findings.find(
      (finding) => finding.file === 'src/config.ts' && finding.start_line <= 120 && finding.end_line >= 120,
    );

    expect(outcome.mode).toBe('map-reduce');
    expect(outcome.chunks.some((call) => call.model === 'invalid/devdigest-fallback-probe')).toBe(true);
    expect(events.some((message) => message.includes('fallback'))).toBe(true);
    expect(outcome.chunks.some((call) => call.stage === 'adjudicate')).toBe(true);
    expect(groundedSecret).toBeDefined();
    expect(outcome.dropped.find((item) => item.finding.id === groundedSecret?.id)).toBeUndefined();
    expect(outcome.tokensIn).toBeGreaterThan(0);
    expect(outcome.tokensOut).toBeGreaterThan(0);
    expect(outcome.costUsd).not.toBeNull();

    console.log(
      JSON.stringify({
        elapsedMs,
        calls: outcome.chunks,
        chunkCount: new Set(outcome.chunks.filter((call) => call.stage === 'map').map((call) => call.label)).size,
        tokensIn: outcome.tokensIn,
        tokensOut: outcome.tokensOut,
        costUsd: outcome.costUsd,
        grounding: outcome.grounding,
        findings: outcome.review.findings.map((finding) => ({
          file: finding.file,
          line: finding.start_line,
          severity: finding.severity,
          title: finding.title,
        })),
      }),
    );
  });
});
