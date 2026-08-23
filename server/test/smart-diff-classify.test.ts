import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSmartDiff,
  classifyPath,
  type ClassifiableFile,
  type ClassifiableFinding,
} from '../src/modules/reviews/smart-diff/classify.js';
import { LOCK_FILES } from '../src/modules/reviews/smart-diff/constants.js';

/**
 * Hermetic unit coverage for `smart-diff/classify.ts` + `constants.ts`
 * (plan 04-smart-diff.md §7 T2). Pure functions only — no DB, no network, no
 * LLM provider anywhere on this path (REQ-8).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMART_DIFF_DIR = path.resolve(__dirname, '../src/modules/reviews/smart-diff');

function file(overrides: Partial<ClassifiableFile> & { path: string }): ClassifiableFile {
  return { additions: 0, deletions: 0, patch: 'diff', ...overrides };
}

function finding(overrides: Partial<ClassifiableFinding> & { file: string }): ClassifiableFinding {
  return {
    id: 'f1',
    start_line: 1,
    end_line: 1,
    severity: 'WARNING',
    title: 'Untitled',
    review_created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('classifyPath', () => {
  const cases: Array<[string, string]> = [
    // boilerplate — lock files, root and nested
    ['package-lock.json', 'boilerplate'],
    ['pnpm-lock.yaml', 'boilerplate'],
    ['a/b/pnpm-lock.yaml', 'boilerplate'],
    ['yarn.lock', 'boilerplate'],
    ['Gemfile.lock', 'boilerplate'],
    ['Cargo.lock', 'boilerplate'],
    ['poetry.lock', 'boilerplate'],
    ['composer.lock', 'boilerplate'],
    ['Pipfile.lock', 'boilerplate'],
    ['gradlew', 'boilerplate'],
    ['mvnw', 'boilerplate'],
    // boilerplate — vendored / generated
    ['node_modules/lodash/index.js', 'boilerplate'],
    ['client/dist/bundle.js', 'boilerplate'],
    ['some/vendor/thing.go', 'boilerplate'],
    ['app/assets/bootstrap.min.css', 'boilerplate'],
    ['src/__snapshots__/App.test.tsx.snap', 'boilerplate'],
    ['src/schema.generated.ts', 'boilerplate'],
    ['client/src/vendor/shared/contracts/brief.ts', 'boilerplate'],
    ['docs/README.md', 'boilerplate'],
    ['LICENSE', 'boilerplate'],
    // precedence — boilerplate beats wiring
    ['dist/next.config.js', 'boilerplate'],
    // REQ-32 — package.json classifies boilerplate, at any depth, alongside its lock file
    ['package.json', 'boilerplate'],
    ['client/package.json', 'boilerplate'],
    // wiring
    ['vite.config.ts', 'wiring'],
    ['tsconfig.json', 'wiring'],
    ['drizzle.config.ts', 'wiring'],
    ['.env.production', 'wiring'],
    ['.github/workflows/ci.yml', 'wiring'],
    ['src/index.ts', 'wiring'],
    ['server/src/modules/reviews/routes.ts', 'wiring'],
    ['app/repos/layout.tsx', 'wiring'],
    // core — unmatched default
    ['src/lib/thing.ts', 'core'],
    ['server/src/modules/reviews/service.ts', 'core'],
    ['src/api/users.ts', 'core'],
    // REQ-30 — the canonical contracts tree is core, not boilerplate; the
    // hand-maintained UI vendor tree is not boilerplate either. The third case
    // ('client/src/vendor/shared/contracts/brief.ts' — the synced mirror IS
    // boilerplate) is already covered above.
    ['server/src/vendor/shared/contracts/skills-api.ts', 'core'],
    ['client/src/vendor/ui/shell/AppFrame.tsx', 'core'],
  ];

  it.each(cases)('classifies %s as %s', (p, expected) => {
    expect(classifyPath(p)).toBe(expected);
  });

  it('every LOCK_FILES entry classifies boilerplate at root and nested', () => {
    for (const name of LOCK_FILES) {
      expect(classifyPath(name)).toBe('boilerplate');
      expect(classifyPath(`a/b/${name}`)).toBe('boilerplate');
    }
  });
});

describe('buildSmartDiff — REQ-1 / REQ-12 (empty + zero-findings shape)', () => {
  it('returns three empty ordered groups for no files and no findings', () => {
    const result = buildSmartDiff([], []);
    expect(result.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    for (const g of result.groups) {
      expect(g.files).toEqual([]);
      expect(g.file_count).toBe(0);
    }
    expect(result.unmatched_finding_count).toBe(0);
    expect(result.total_files).toBe(0);
  });

  it('groups and orders correctly with zero findings — all findings empty, all default_open false', () => {
    const files = [
      file({ path: 'src/core-a.ts', additions: 10, deletions: 0 }),
      file({ path: 'package.json', additions: 1, deletions: 0 }),
      file({ path: 'pnpm-lock.yaml', additions: 500, deletions: 0 }),
    ];
    const result = buildSmartDiff(files, []);
    for (const g of result.groups) {
      for (const f of g.files) {
        expect(f.findings).toEqual([]);
        expect(f.default_open).toBe(false);
      }
    }
    expect(result.unmatched_finding_count).toBe(0);
  });
});

describe('buildSmartDiff — REQ-3 file-level collapse rule', () => {
  it('boilerplate never opens by default, findings or not; core/wiring open only with findings', () => {
    const files = [
      file({ path: 'pnpm-lock.yaml' }), // boilerplate, no findings
      file({ path: 'yarn.lock' }), // boilerplate, WITH findings
      file({ path: 'src/core.ts' }), // core, no findings
      file({ path: 'src/other-core.ts' }), // core, WITH findings
      file({ path: 'tsconfig.json' }), // wiring, no findings
      file({ path: '.github/workflows/ci.yml' }), // wiring, WITH findings
    ];
    const findings = [
      finding({ id: 'f-boilerplate', file: 'yarn.lock' }),
      finding({ id: 'f-core', file: 'src/other-core.ts' }),
      finding({ id: 'f-wiring', file: '.github/workflows/ci.yml' }),
    ];
    const result = buildSmartDiff(files, findings);
    const byPath = new Map(result.groups.flatMap((g) => g.files).map((f) => [f.path, f]));

    expect(byPath.get('pnpm-lock.yaml')!.default_open).toBe(false);
    expect(byPath.get('yarn.lock')!.default_open).toBe(false); // findings.length > 0 uniformly would break this
    expect(byPath.get('src/core.ts')!.default_open).toBe(false);
    expect(byPath.get('src/other-core.ts')!.default_open).toBe(true);
    expect(byPath.get('tsconfig.json')!.default_open).toBe(false);
    expect(byPath.get('.github/workflows/ci.yml')!.default_open).toBe(true);
  });
});

describe('buildSmartDiff — REQ-28 groups never carry a collapse flag', () => {
  it('a group object has exactly role, file_count, files — no default_open', () => {
    const result = buildSmartDiff([file({ path: 'src/a.ts' })], []);
    for (const g of result.groups) {
      expect(Object.keys(g).sort()).toEqual(['file_count', 'files', 'role']);
    }
  });
});

describe('buildSmartDiff — REQ-5 large flag', () => {
  it('exactly LARGE_FILE_LINES is not large; one over is', () => {
    const atThreshold = file({ path: 'src/at.ts', additions: 300, deletions: 100 });
    const overThreshold = file({ path: 'src/over.ts', additions: 300, deletions: 101 });
    const result = buildSmartDiff([atThreshold, overThreshold], []);
    const byPath = new Map(result.groups.flatMap((g) => g.files).map((f) => [f.path, f]));
    expect(byPath.get('src/at.ts')!.large).toBe(false);
    expect(byPath.get('src/over.ts')!.large).toBe(true);
  });
});

describe('buildSmartDiff — REQ-6 split_suggestion.too_big', () => {
  it('total_lines at the threshold is not too big; one over is', () => {
    const atThreshold = buildSmartDiff([file({ path: 'a.ts', additions: 1000, deletions: 0 })], []);
    expect(atThreshold.split_suggestion.too_big).toBe(false);
    expect(atThreshold.split_suggestion.proposed_splits).toEqual([]);

    const overThreshold = buildSmartDiff([file({ path: 'a.ts', additions: 1001, deletions: 0 })], []);
    expect(overThreshold.split_suggestion.too_big).toBe(true);
    expect(overThreshold.split_suggestion.proposed_splits).toEqual([]);
  });
});

describe('buildSmartDiff — REQ-7 / REQ-23 dedup, newest wins', () => {
  it('two findings identical on the key but differing on id/created_at collapse to one, newest id survives', () => {
    const files = [file({ path: 'src/a.ts' })];
    const findings = [
      finding({
        id: 'older-id',
        file: 'src/a.ts',
        severity: 'CRITICAL',
        start_line: 10,
        end_line: 10,
        title: '  Hardcoded Secret ',
        review_created_at: '2026-01-01T00:00:00.000Z',
      }),
      finding({
        id: 'newer-id',
        file: 'src/a.ts',
        severity: 'CRITICAL',
        start_line: 10,
        end_line: 10,
        title: 'hardcoded secret',
        review_created_at: '2026-01-02T00:00:00.000Z',
      }),
    ];
    const result = buildSmartDiff(files, findings);
    const fileOut = result.groups.flatMap((g) => g.files).find((f) => f.path === 'src/a.ts')!;
    expect(fileOut.findings).toHaveLength(1);
    expect(fileOut.findings[0].id).toBe('newer-id');
  });
});

describe('buildSmartDiff — REQ-9 total within-group order', () => {
  it('orders by has-findings, severity, count, changed_lines, path — and is input-order independent', () => {
    const files = [
      file({ path: 'src/no-findings-small.ts', additions: 1, deletions: 0 }),
      file({ path: 'src/no-findings-big.ts', additions: 900, deletions: 0 }),
      file({ path: 'src/one-warning.ts', additions: 5, deletions: 0 }),
      file({ path: 'src/two-warnings.ts', additions: 5, deletions: 0 }),
      file({ path: 'src/one-critical.ts', additions: 5, deletions: 0 }),
      file({ path: 'src/tie-a.ts', additions: 5, deletions: 0 }),
      file({ path: 'src/tie-b.ts', additions: 5, deletions: 0 }),
    ];
    const findings = [
      finding({ id: '1', file: 'src/one-warning.ts', severity: 'WARNING', title: 'w1' }),
      finding({ id: '2', file: 'src/two-warnings.ts', severity: 'WARNING', title: 'w2' }),
      finding({ id: '3', file: 'src/two-warnings.ts', severity: 'WARNING', title: 'w3' }),
      finding({ id: '4', file: 'src/one-critical.ts', severity: 'CRITICAL', title: 'c1' }),
      finding({ id: '5', file: 'src/tie-a.ts', severity: 'WARNING', title: 'ta' }),
      finding({ id: '6', file: 'src/tie-b.ts', severity: 'WARNING', title: 'tb' }),
    ];
    const expectedOrder = [
      'src/one-critical.ts', // CRITICAL beats WARNING
      'src/two-warnings.ts', // 2 findings beats 1
      'src/one-warning.ts', // tie on everything but path -> asc ("o" < "t")
      'src/tie-a.ts',
      'src/tie-b.ts',
      'src/no-findings-big.ts', // no findings, but bigger than the other no-findings file
      'src/no-findings-small.ts',
    ];

    const result = buildSmartDiff(files, findings);
    const coreGroup = result.groups.find((g) => g.role === 'core')!;
    expect(coreGroup.files.map((f) => f.path)).toEqual(expectedOrder);

    // Shuffling the input file array must not change the emitted order.
    const shuffled = [...files].reverse();
    const shuffledResult = buildSmartDiff(shuffled, findings);
    const shuffledCoreGroup = shuffledResult.groups.find((g) => g.role === 'core')!;
    expect(shuffledCoreGroup.files.map((f) => f.path)).toEqual(expectedOrder);
  });
});

describe('buildSmartDiff — REQ-10 membership independent of findings', () => {
  it('the same file list produces identical (role, path) membership with and without findings', () => {
    const files = [
      file({ path: 'src/core.ts' }),
      file({ path: 'tsconfig.json' }),
      file({ path: 'pnpm-lock.yaml' }),
    ];
    const findings = [
      finding({ id: '1', file: 'src/core.ts', severity: 'CRITICAL' }),
      finding({ id: '2', file: 'tsconfig.json', severity: 'WARNING' }),
      finding({ id: '3', file: 'pnpm-lock.yaml', severity: 'SUGGESTION' }),
    ];

    const withoutFindings = buildSmartDiff(files, []);
    const withFindings = buildSmartDiff(files, findings);

    const membership = (result: ReturnType<typeof buildSmartDiff>) =>
      result.groups.map((g) => ({ role: g.role, paths: g.files.map((f) => f.path).sort() }));

    expect(membership(withoutFindings)).toEqual(membership(withFindings));
  });
});

describe('buildSmartDiff — REQ-11 unmatched findings', () => {
  it('a finding on a file not in the PR is excluded from every group and counted', () => {
    const files = [file({ path: 'src/a.ts' })];
    const findings = [
      finding({ id: '1', file: 'src/does-not-exist.ts', severity: 'CRITICAL' }),
      finding({ id: '2', file: 'src/a.ts', severity: 'WARNING', start_line: 0 }),
    ];
    const result = buildSmartDiff(files, findings);
    expect(result.unmatched_finding_count).toBe(1);

    const allFindingIds = result.groups.flatMap((g) => g.files).flatMap((f) => f.findings.map((x) => x.id));
    expect(allFindingIds).toEqual(['2']);

    const fileOut = result.groups.flatMap((g) => g.files).find((f) => f.path === 'src/a.ts')!;
    expect(fileOut.findings[0].line).toBe(0); // start_line: 0 stays attached, not dropped
  });
});

describe('buildSmartDiff — REQ-8 (static half): no LLM/adapter import anywhere in this module', () => {
  it('classify.ts and constants.ts import nothing from adapters/ or any provider SDK', () => {
    const banned = /adapters\/|openai|anthropic|openrouter|llm/i;
    for (const filename of ['classify.ts', 'constants.ts']) {
      const source = readFileSync(path.join(SMART_DIFF_DIR, filename), 'utf8');
      const importLines = source.split(/\r?\n/).filter((line) => /^\s*import\b/.test(line));
      for (const line of importLines) {
        expect(line).not.toMatch(banned);
      }
    }
  });
});
