import { describe, expect, it } from 'vitest';
import { classifyFile, buildSmartDiff } from './smart-diff.js';
import { SPLIT_SUGGESTION_LINE_THRESHOLD } from './smart-diff-constants.js';

describe('classifyFile', () => {
  it('classifies lock files as boilerplate, including nested paths', () => {
    expect(classifyFile('package-lock.json')).toBe('boilerplate');
    expect(classifyFile('packages/api/package-lock.json')).toBe('boilerplate');
    expect(classifyFile('pnpm-lock.yaml')).toBe('boilerplate');
    expect(classifyFile('yarn.lock')).toBe('boilerplate');
    expect(classifyFile('go.sum')).toBe('boilerplate');
  });

  it('classifies package.json, build output, and snapshots as boilerplate', () => {
    expect(classifyFile('package.json')).toBe('boilerplate');
    expect(classifyFile('dist/index.js')).toBe('boilerplate');
    expect(classifyFile('src/__snapshots__/Foo.test.tsx.snap')).toBe('boilerplate');
    expect(classifyFile('public/bundle.min.js')).toBe('boilerplate');
  });

  it('classifies bootstrap/config/index files as wiring', () => {
    expect(classifyFile('src/index.ts')).toBe('wiring');
    expect(classifyFile('src/server.ts')).toBe('wiring');
    expect(classifyFile('src/config.ts')).toBe('wiring');
    expect(classifyFile('vitest.config.ts')).toBe('wiring');
    expect(classifyFile('tsconfig.json')).toBe('wiring');
    expect(classifyFile('.github/workflows/ci.yml')).toBe('wiring');
  });

  it('classifies markdown, spec documents, and docs directories as docs', () => {
    expect(classifyFile('README.md')).toBe('docs');
    expect(classifyFile('docs/architecture.md')).toBe('docs');
    expect(classifyFile('specs/11-why-risk-brief.md')).toBe('docs');
    expect(classifyFile('.devdigest/specs/rate-limit.md')).toBe('docs');
    expect(classifyFile('server/CLAUDE.md')).toBe('docs');
    expect(classifyFile('LICENSE')).toBe('docs');
  });

  it('classifies test files, test directories, fixtures and mocks as tests', () => {
    expect(classifyFile('src/middleware/ratelimit.test.ts')).toBe('tests');
    expect(classifyFile('src/components/Button.spec.tsx')).toBe('tests');
    expect(classifyFile('server/test/reviews.it.test.ts')).toBe('tests');
    expect(classifyFile('src/__tests__/helpers.ts')).toBe('tests');
    expect(classifyFile('test/fixtures/views.js')).toBe('tests');
    expect(classifyFile('e2e/run.ts')).toBe('tests');
  });

  it('prefers docs over tests, and tests over wiring', () => {
    expect(classifyFile('test/README.md')).toBe('docs');
    expect(classifyFile('test/index.ts')).toBe('tests');
    expect(classifyFile('src/__mocks__/index.ts')).toBe('tests');
  });

  it('falls back to core for everything else', () => {
    expect(classifyFile('src/middleware/ratelimit.ts')).toBe('core');
    expect(classifyFile('src/api/public/webhooks.ts')).toBe('core');
  });

  it('classifies WIRING_PATH_PATTERNS matches not covered by basename alone', () => {
    expect(classifyFile('vite.config.ts')).toBe('wiring');
    expect(classifyFile('.env')).toBe('wiring');
    expect(classifyFile('.env.production')).toBe('wiring');
    expect(classifyFile('docker-compose.yml')).toBe('wiring');
    expect(classifyFile('Dockerfile')).toBe('wiring');
  });

  it('classifies a root-level file with no directory by its whole path as basename', () => {
    expect(classifyFile('index.ts')).toBe('wiring');
    expect(classifyFile('utils.ts')).toBe('core');
  });

  it('checks boilerplate before wiring, so a boilerplate path pattern wins over a wiring basename', () => {
    expect(classifyFile('dist/index.js')).toBe('boilerplate');
  });
});

describe('buildSmartDiff', () => {
  it('orders groups core, wiring, tests, docs, boilerplate when all are present', () => {
    const result = buildSmartDiff(
      [
        { path: 'README.md', additions: 1, deletions: 0 },
        { path: 'package-lock.json', additions: 1, deletions: 0 },
        { path: 'src/a.test.ts', additions: 1, deletions: 0 },
        { path: 'src/index.ts', additions: 1, deletions: 0 },
        { path: 'src/a.ts', additions: 1, deletions: 0 },
      ],
      [],
    );
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'tests', 'docs', 'boilerplate']);
  });

  it('groups files in core, wiring, boilerplate order, omitting empty groups', () => {
    const result = buildSmartDiff(
      [
        { path: 'src/foo.ts', additions: 5, deletions: 1 },
        { path: 'package-lock.json', additions: 20, deletions: 0 },
      ],
      [],
    );
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'boilerplate']);
  });

  it('assembles a wiring group for a wiring-classified file, alongside core and boilerplate', () => {
    const result = buildSmartDiff(
      [
        { path: 'src/foo.ts', additions: 5, deletions: 1 },
        { path: 'src/index.ts', additions: 2, deletions: 0 },
        { path: 'package-lock.json', additions: 20, deletions: 0 },
      ],
      [],
    );
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    const wiring = result.groups.find((g) => g.role === 'wiring')!;
    expect(wiring.files).toEqual([
      {
        path: 'src/index.ts',
        pseudocode_summary: null,
        additions: 2,
        deletions: 0,
        finding_lines: [],
      },
    ]);
  });

  it('expands and dedupes finding_lines only for the matching file', () => {
    const result = buildSmartDiff(
      [
        { path: 'src/foo.ts', additions: 5, deletions: 1 },
        { path: 'src/bar.ts', additions: 2, deletions: 0 },
      ],
      [
        { file: 'src/foo.ts', startLine: 10, endLine: 12 },
        { file: 'src/foo.ts', startLine: 11, endLine: 11 },
      ],
    );
    const foo = result.groups[0]!.files.find((f) => f.path === 'src/foo.ts')!;
    const bar = result.groups[0]!.files.find((f) => f.path === 'src/bar.ts')!;
    expect(foo.finding_lines).toEqual([10, 11, 12]);
    expect(bar.finding_lines).toEqual([]);
  });

  it('flips too_big at the threshold', () => {
    const under = buildSmartDiff(
      [{ path: 'src/foo.ts', additions: SPLIT_SUGGESTION_LINE_THRESHOLD, deletions: 0 }],
      [],
    );
    expect(under.split_suggestion.too_big).toBe(false);
    expect(under.split_suggestion.total_lines).toBe(SPLIT_SUGGESTION_LINE_THRESHOLD);

    const over = buildSmartDiff(
      [{ path: 'src/foo.ts', additions: SPLIT_SUGGESTION_LINE_THRESHOLD + 1, deletions: 0 }],
      [],
    );
    expect(over.split_suggestion.too_big).toBe(true);
    expect(over.split_suggestion.proposed_splits).toEqual([{ name: 'src', files: ['src/foo.ts'] }]);
  });

  it('names the split "(root)" for a root-level core file', () => {
    const result = buildSmartDiff(
      [{ path: 'foo.ts', additions: SPLIT_SUGGESTION_LINE_THRESHOLD + 1, deletions: 0 }],
      [],
    );
    expect(result.split_suggestion.proposed_splits).toEqual([{ name: '(root)', files: ['foo.ts'] }]);
  });

  it('groups proposed_splits by top-level directory of core files, excluding wiring/boilerplate', () => {
    const result = buildSmartDiff(
      [
        { path: 'src/api/foo.ts', additions: SPLIT_SUGGESTION_LINE_THRESHOLD, deletions: 0 },
        { path: 'src/api/bar.ts', additions: 1, deletions: 0 },
        { path: 'lib/baz.ts', additions: 1, deletions: 0 },
        { path: 'src/index.ts', additions: 1, deletions: 0 }, // wiring — excluded
        { path: 'package-lock.json', additions: 1, deletions: 0 }, // boilerplate — excluded
      ],
      [],
    );
    expect(result.split_suggestion.too_big).toBe(true);
    expect(result.split_suggestion.proposed_splits).toEqual([
      { name: 'src', files: ['src/api/foo.ts', 'src/api/bar.ts'] },
      { name: 'lib', files: ['lib/baz.ts'] },
    ]);
  });

  it('never sets pseudocode_summary (no LLM call)', () => {
    const result = buildSmartDiff([{ path: 'src/foo.ts', additions: 1, deletions: 0 }], []);
    expect(result.groups[0]!.files[0]!.pseudocode_summary).toBeNull();
  });
});
