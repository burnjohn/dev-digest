import { describe, expect, it } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import {
  planReviewChunks,
  PromptBudgetExceededError,
} from '../src/review/chunks.js';

function unified(raw: string): UnifiedDiff {
  const paths = [...raw.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((match) => match[2]!);
  return {
    raw,
    files: paths.map((path) => ({ path, additions: 1, deletions: 0, hunks: [] })),
  };
}

function fileDiff(path: string, body: string, start = 1): string {
  const lines = body.split('\n');
  const additions = lines.filter((line) => line.startsWith('+')).length;
  const deletions = lines.filter((line) => line.startsWith('-')).length;
  const context = lines.length - additions - deletions;
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${start},${context + deletions} +${start},${context + additions} @@`,
    body,
  ].join('\n');
}

describe('planReviewChunks', () => {
  it('keeps a small multi-file diff in one focused chunk', () => {
    const diff = unified(
      [fileDiff('src/a.ts', ' const a = 1;\n+const b = 2;'), fileDiff('src/b.ts', '+export {};')].join('\n'),
    );

    const chunks = planReviewChunks({ diff, promptOverheadTokens: 100, maxPromptTokens: 2_000 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(chunks[0]!.diffText).toContain('diff --git a/src/a.ts');
    expect(chunks[0]!.diffText).toContain('diff --git a/src/b.ts');
  });

  it('packs complete file blocks without exceeding the total prompt budget', () => {
    const diff = unified(
      [
        fileDiff('src/a.ts', `+const a = '${'a'.repeat(700)}';`),
        fileDiff('src/b.ts', `+const b = '${'b'.repeat(700)}';`),
      ].join('\n'),
    );

    const chunks = planReviewChunks({
      diff,
      promptOverheadTokens: 80,
      maxPromptTokens: 420,
      minDiffTokens: 40,
    });

    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.files)).toEqual([['src/a.ts'], ['src/b.ts']]);
    expect(chunks.every((chunk) => chunk.estimatedTokens <= 420)).toBe(true);
  });

  it('splits a large file on complete hunk boundaries', () => {
    const path = 'src/large.ts';
    const raw = [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -1,1 +1,1 @@ first',
      `+const first = '${'a'.repeat(500)}';`,
      '@@ -20,1 +20,1 @@ second',
      `+const second = '${'b'.repeat(500)}';`,
    ].join('\n');

    const chunks = planReviewChunks({
      diff: unified(raw),
      promptOverheadTokens: 50,
      maxPromptTokens: 310,
      minDiffTokens: 40,
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.diffText).toContain('@@ -1,1 +1,1 @@ first');
    expect(chunks[0]!.diffText).not.toContain('@@ -20,1 +20,1 @@ second');
    expect(chunks[1]!.diffText).toContain('@@ -20,1 +20,1 @@ second');
  });

  it('splits an oversized hunk without dropping or duplicating changed lines', () => {
    const path = 'src/oversized.ts';
    const markers = ['ADDED_ONE', 'ADDED_TWO', 'REMOVED_ONE', 'ADDED_THREE'];
    const raw = [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -10,3 +10,5 @@ function calculate() {',
      `-REMOVED_ONE_${'r'.repeat(260)}`,
      `+ADDED_ONE_${'a'.repeat(260)}`,
      `+ADDED_TWO_${'b'.repeat(260)}`,
      ' const stable = true;',
      `+ADDED_THREE_${'c'.repeat(260)}`,
      ' }',
    ].join('\n');

    const chunks = planReviewChunks({
      diff: unified(raw),
      promptOverheadTokens: 40,
      maxPromptTokens: 210,
      minDiffTokens: 40,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const marker of markers) {
      expect(chunks.filter((chunk) => chunk.diffText.includes(marker))).toHaveLength(1);
    }
    const headers = chunks.map((chunk) => chunk.diffText.match(/^@@ .*$/m)?.[0]);
    expect(new Set(headers).size).toBe(chunks.length);
    expect(chunks.every((chunk) => chunk.estimatedTokens <= 210)).toBe(true);
  });

  it('fragments one minified changed line instead of failing the review', () => {
    const payload = `START_${'a'.repeat(2_400)}_END`;
    const raw = fileDiff('dist/minified.js', `+${payload}`);

    const chunks = planReviewChunks({
      diff: unified(raw),
      promptOverheadTokens: 40,
      maxPromptTokens: 220,
      minDiffTokens: 40,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.estimatedTokens <= 220)).toBe(true);
    const fragments = chunks.flatMap((chunk) =>
      chunk.diffText
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
        .map((line) => line.slice(1)),
    );
    expect(fragments.join('')).toBe(payload);
  });

  it('keeps a large hunkless patch within the budget', () => {
    const path = 'assets/generated.patch';
    const payload = `literal ${'z'.repeat(2_400)}`;
    const raw = [
      `diff --git a/${path} b/${path}`,
      'new file mode 100644',
      'GIT binary patch',
      payload,
    ].join('\n');

    const chunks = planReviewChunks({
      diff: unified(raw),
      promptOverheadTokens: 40,
      maxPromptTokens: 220,
      minDiffTokens: 40,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.estimatedTokens <= 220)).toBe(true);
    const rendered = chunks.map((chunk) => chunk.diffText).join('\n');
    expect(rendered).toContain('literal');
    expect(rendered.match(/z/g)).toHaveLength(2_400);
  });

  it('uses less diff capacity when fixed prompt overhead grows', () => {
    const diff = unified(
      [
        fileDiff('src/a.ts', `+const a = '${'a'.repeat(380)}';`),
        fileDiff('src/b.ts', `+const b = '${'b'.repeat(380)}';`),
      ].join('\n'),
    );

    const lowOverhead = planReviewChunks({
      diff,
      promptOverheadTokens: 20,
      maxPromptTokens: 430,
      minDiffTokens: 40,
    });
    const highOverhead = planReviewChunks({
      diff,
      promptOverheadTokens: 170,
      maxPromptTokens: 430,
      minDiffTokens: 40,
    });

    expect(lowOverhead).toHaveLength(1);
    expect(highOverhead).toHaveLength(2);
  });

  it('fails explicitly when fixed prompt content leaves no safe diff budget', () => {
    const diff = unified(fileDiff('src/a.ts', '+const a = 1;'));

    expect(() =>
      planReviewChunks({
        diff,
        promptOverheadTokens: 950,
        maxPromptTokens: 1_000,
        minDiffTokens: 100,
      }),
    ).toThrow(PromptBudgetExceededError);
  });

  it('produces stable labels for identical input', () => {
    const diff = unified(
      fileDiff(
        'src/a.ts',
        [1, 2, 3, 4].map((n) => `+const a${n} = '${String(n).repeat(180)}';`).join('\n'),
      ),
    );
    const input = { diff, promptOverheadTokens: 50, maxPromptTokens: 240, minDiffTokens: 40 };

    expect(planReviewChunks(input).map((chunk) => chunk.label)).toEqual(
      planReviewChunks(input).map((chunk) => chunk.label),
    );
  });
});
