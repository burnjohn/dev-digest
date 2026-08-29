import { describe, it, expect } from 'vitest';
import { EvalPromptDiffLine } from '@devdigest/shared';
import { diffPromptLines, comparePromptVersions } from '../src/modules/evals/prompt-diff.js';

/**
 * SPEC-03 AC-35/AC-36 — the pure version-text line differ. Hermetic: no I/O,
 * no fixtures beyond plain strings.
 */
describe('diffPromptLines', () => {
  it('marks unchanged lines same, an inserted line add, and nothing del, in source order', () => {
    const oldText = 'line one\nline two\nline three';
    const newText = 'line one\nline two\ninserted line\nline three';

    const result = diffPromptLines(oldText, newText);

    expect(result).toEqual([
      { op: 'same', text: 'line one' },
      { op: 'same', text: 'line two' },
      { op: 'add', text: 'inserted line' },
      { op: 'same', text: 'line three' },
    ]);
    expect(result.some((l) => l.op === 'del')).toBe(false);
  });

  it('marks a removed line del, in source order, with nothing add', () => {
    const oldText = 'alpha\nbeta\ngamma';
    const newText = 'alpha\ngamma';

    const result = diffPromptLines(oldText, newText);

    expect(result).toEqual([
      { op: 'same', text: 'alpha' },
      { op: 'del', text: 'beta' },
      { op: 'same', text: 'gamma' },
    ]);
    expect(result.some((l) => l.op === 'add')).toBe(false);
  });

  it('returns an ordered array of {op, text} matching the contract shape exactly', () => {
    const result = diffPromptLines('a\nb', 'a\nc');

    for (const line of result) {
      expect(() => EvalPromptDiffLine.parse(line)).not.toThrow();
    }
    // Exact shape — no extra keys beyond what the contract declares.
    expect(Object.keys(result[0]).sort()).toEqual(['op', 'text']);
  });

  it('never recurses even for a long pathological pair (iterative DP)', () => {
    const oldLines = Array.from({ length: 3000 }, (_, i) => `line-${i}`);
    const newLines = [...oldLines];
    newLines[1500] = 'mutated-line';
    const oldText = oldLines.join('\n');
    const newText = newLines.join('\n');

    expect(() => diffPromptLines(oldText, newText)).not.toThrow();
    const result = diffPromptLines(oldText, newText);
    expect(result.filter((l) => l.op !== 'same')).toEqual([
      { op: 'del', text: 'line-1500' },
      { op: 'add', text: 'mutated-line' },
    ]);
  });
});

describe('comparePromptVersions', () => {
  it('returns a distinguishable same-version verdict for identical texts, not an empty array', () => {
    const verdict = comparePromptVersions('same text\nacross both', 'same text\nacross both');

    expect(verdict).toEqual({ sameVersion: true });
    expect('diff' in verdict).toBe(false);
  });

  it('returns sameVersion: false with the diff array for differing texts', () => {
    const verdict = comparePromptVersions('a\nb', 'a\nb\nc');

    expect(verdict.sameVersion).toBe(false);
    if (!verdict.sameVersion) {
      expect(verdict.diff).toEqual([
        { op: 'same', text: 'a' },
        { op: 'same', text: 'b' },
        { op: 'add', text: 'c' },
      ]);
    }
  });
});
