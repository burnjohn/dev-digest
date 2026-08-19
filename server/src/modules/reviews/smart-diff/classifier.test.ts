import { describe, it, expect } from 'vitest';
import type { SmartDiffFinding } from '@devdigest/shared';
import { classifyFile, buildSmartDiff, type SmartDiffInputFile } from './classifier.js';
import { TOO_BIG_CORE_FILES, TOO_BIG_TOTAL_LINES } from './constants.js';

describe('classifyFile', () => {
  it('classifies a lock file as boilerplate', () => {
    expect(classifyFile('pnpm-lock.yaml')).toBe('boilerplate');
    expect(classifyFile('package-lock.json')).toBe('boilerplate');
    expect(classifyFile('packages/api/foo.lock')).toBe('boilerplate');
  });

  it('classifies a config file as wiring', () => {
    expect(classifyFile('vitest.config.ts')).toBe('wiring');
    expect(classifyFile('src/tsconfig.build.json')).toBe('wiring');
    expect(classifyFile('.github/workflows/ci.yml')).toBe('wiring');
    // Bare `config.ts` (no `.config.` infix) is the same plumbing role.
    expect(classifyFile('src/config.ts')).toBe('wiring');
  });

  it('does not misclassify a file that merely contains "config" as a substring', () => {
    expect(classifyFile('src/configurationLoader.ts')).toBe('core');
  });

  it('classifies an ordinary business-logic file as core', () => {
    expect(classifyFile('src/modules/reviews/service.ts')).toBe('core');
    expect(classifyFile('src/lib/hooks/reviews.ts')).toBe('core');
  });

  it('gives boilerplate priority over wiring/core when multiple patterns match', () => {
    // Under dist/** AND named like a config file — boilerplate wins because a
    // build artifact is never worth reviewing, regardless of its name.
    expect(classifyFile('packages/api/dist/vitest.config.js')).toBe('boilerplate');
    // A generated file that also matches the wiring "*.d.ts" pattern.
    expect(classifyFile('src/api.generated.d.ts')).toBe('boilerplate');
  });
});

describe('buildSmartDiff', () => {
  function file(overrides: Partial<SmartDiffInputFile>): SmartDiffInputFile {
    return { path: 'src/modules/reviews/service.ts', additions: 1, deletions: 0, ...overrides };
  }

  it('groups files by role and orders groups core → wiring → boilerplate', () => {
    const files: SmartDiffInputFile[] = [
      file({ path: 'pnpm-lock.yaml', additions: 5, deletions: 0 }),
      file({ path: 'vitest.config.ts', additions: 2, deletions: 1 }),
      file({ path: 'src/modules/reviews/service.ts', additions: 10, deletions: 3 }),
    ];
    const result = buildSmartDiff(files, new Map());
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(result.groups[0]?.files[0]?.path).toBe('src/modules/reviews/service.ts');
    expect(result.groups[1]?.files[0]?.path).toBe('vitest.config.ts');
    expect(result.groups[2]?.files[0]?.path).toBe('pnpm-lock.yaml');
  });

  it('omits groups with no files rather than emitting an empty group', () => {
    const files: SmartDiffInputFile[] = [file({ path: 'src/modules/reviews/service.ts' })];
    const result = buildSmartDiff(files, new Map());
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.role).toBe('core');
  });

  it('sets pseudocode_summary to null (deterministic, no LLM)', () => {
    const result = buildSmartDiff([file({})], new Map());
    expect(result.groups[0]?.files[0]?.pseudocode_summary).toBeNull();
  });

  it('dedupes findings by line (worse severity wins) and sorts ascending', () => {
    const findings: SmartDiffFinding[] = [
      { line: 42, severity: 'WARNING' },
      { line: 10, severity: 'SUGGESTION' },
      { line: 42, severity: 'CRITICAL' }, // same line as above, worse severity
      { line: 10, severity: 'SUGGESTION' }, // exact duplicate
    ];
    const findingsByFile = new Map([['src/modules/reviews/service.ts', findings]]);
    const result = buildSmartDiff([file({})], findingsByFile);
    const smartFile = result.groups[0]?.files[0];
    expect(smartFile?.findings).toEqual([
      { line: 10, severity: 'SUGGESTION' },
      { line: 42, severity: 'CRITICAL' },
    ]);
  });

  it('defaults to an empty findings array for a file with no findings', () => {
    const result = buildSmartDiff([file({})], new Map());
    expect(result.groups[0]?.files[0]?.findings).toEqual([]);
  });

  it('split_suggestion.too_big is false at/just under the total-lines threshold', () => {
    const result = buildSmartDiff(
      [file({ additions: TOO_BIG_TOTAL_LINES, deletions: 0 })],
      new Map(),
    );
    expect(result.split_suggestion.total_lines).toBe(TOO_BIG_TOTAL_LINES);
    expect(result.split_suggestion.too_big).toBe(false);
  });

  it('split_suggestion.too_big is true just over the total-lines threshold', () => {
    const result = buildSmartDiff(
      [file({ additions: TOO_BIG_TOTAL_LINES + 1, deletions: 0 })],
      new Map(),
    );
    expect(result.split_suggestion.too_big).toBe(true);
  });

  it('split_suggestion.too_big is false at exactly the core-file-count threshold', () => {
    const files: SmartDiffInputFile[] = Array.from({ length: TOO_BIG_CORE_FILES }, (_, i) =>
      file({ path: `src/modules/reviews/file-${i}.ts`, additions: 1, deletions: 0 }),
    );
    const result = buildSmartDiff(files, new Map());
    expect(result.split_suggestion.too_big).toBe(false);
  });

  it('split_suggestion.too_big is true just over the core-file-count threshold', () => {
    const files: SmartDiffInputFile[] = Array.from({ length: TOO_BIG_CORE_FILES + 1 }, (_, i) =>
      file({ path: `src/modules/reviews/file-${i}.ts`, additions: 1, deletions: 0 }),
    );
    const result = buildSmartDiff(files, new Map());
    expect(result.split_suggestion.too_big).toBe(true);
  });

  it('does not count wiring/boilerplate files toward the core-file-count threshold', () => {
    const files: SmartDiffInputFile[] = Array.from({ length: TOO_BIG_CORE_FILES + 5 }, (_, i) =>
      file({ path: `config-${i}.config.ts`, additions: 1, deletions: 0 }),
    );
    const result = buildSmartDiff(files, new Map());
    expect(result.split_suggestion.too_big).toBe(false);
  });
});
