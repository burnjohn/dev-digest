import { describe, expect, it } from 'vitest';
import { buildSmartDiff } from './service.js';

const makeFile = (
  path: string,
  additions: number,
  deletions: number,
): { path: string; additions: number; deletions: number; patch: null } => ({
  path,
  additions,
  deletions,
  patch: null,
});

describe('buildSmartDiff — groups', () => {
  it('correctly assigns roles and always emits all 3 groups', () => {
    const files = [
      makeFile('src/services/payment.service.ts', 30, 5),  // core
      makeFile('src/index.ts', 10, 2),                      // wiring
      makeFile('pnpm-lock.yaml', 200, 100),                 // boilerplate
    ];
    const findings = [
      { file: 'src/services/payment.service.ts', start_line: 42, end_line: 45 },
      { file: 'src/services/payment.service.ts', start_line: 80, end_line: 82 },
    ];

    const result = buildSmartDiff(files, findings);

    expect(result.groups).toHaveLength(3);

    const core = result.groups.find((g) => g.role === 'core');
    const wiring = result.groups.find((g) => g.role === 'wiring');
    const boilerplate = result.groups.find((g) => g.role === 'boilerplate');
    expect(core).toBeDefined();
    expect(wiring).toBeDefined();
    expect(boilerplate).toBeDefined();

    expect(core!.files).toHaveLength(1);
    expect(core!.files[0]!.path).toBe('src/services/payment.service.ts');
    expect(core!.files[0]!.finding_lines).toEqual([42, 80]);

    expect(wiring!.files).toHaveLength(1);
    expect(wiring!.files[0]!.path).toBe('src/index.ts');
    expect(wiring!.files[0]!.finding_lines).toEqual([]);

    expect(boilerplate!.files).toHaveLength(1);
    expect(boilerplate!.files[0]!.path).toBe('pnpm-lock.yaml');
  });

  it('deduplicates finding_lines', () => {
    const files = [makeFile('src/auth.ts', 20, 5)];
    const findings = [
      { file: 'src/auth.ts', start_line: 10, end_line: 12 },
      { file: 'src/auth.ts', start_line: 10, end_line: 14 },
      { file: 'src/auth.ts', start_line: 20, end_line: 22 },
    ];

    const result = buildSmartDiff(files, findings);
    const core = result.groups.find((g) => g.role === 'core');
    expect(core).toBeDefined();
    expect(core!.files[0]!.finding_lines).toEqual([10, 20]);
  });

  it('ignores findings with null start_line', () => {
    const files = [makeFile('src/helper.ts', 10, 2)];
    const findings = [
      { file: 'src/helper.ts', start_line: null, end_line: null },
      { file: 'src/helper.ts', start_line: 5, end_line: 7 },
    ];

    const result = buildSmartDiff(files, findings);
    const core = result.groups.find((g) => g.role === 'core');
    expect(core).toBeDefined();
    expect(core!.files[0]!.finding_lines).toEqual([5]);
  });

  it('emits empty groups when no files of that role', () => {
    const files = [makeFile('src/service.ts', 10, 5)]; // core only
    const result = buildSmartDiff(files, []);

    const wiring = result.groups.find((g) => g.role === 'wiring')!;
    const boilerplate = result.groups.find((g) => g.role === 'boilerplate')!;
    expect(wiring.files).toHaveLength(0);
    expect(boilerplate.files).toHaveLength(0);
  });

  it('pseudocode_summary is null for all files', () => {
    const files = [
      makeFile('src/service.ts', 10, 5),
      makeFile('src/index.ts', 5, 1),
    ];
    const result = buildSmartDiff(files, []);
    result.groups.forEach((g) => {
      g.files.forEach((f) => expect(f.pseudocode_summary).toBeNull());
    });
  });
});

describe('buildSmartDiff — split_suggestion', () => {
  it('too_big=false when total_lines <= 500', () => {
    const files = [makeFile('src/a.ts', 200, 100)]; // 300 lines
    const result = buildSmartDiff(files, []);
    expect(result.split_suggestion.too_big).toBe(false);
    expect(result.split_suggestion.total_lines).toBe(300);
    expect(result.split_suggestion.proposed_splits).toEqual([]);
  });

  it('too_big=true when total_lines > 500', () => {
    const files = [makeFile('src/a.ts', 300, 210)]; // 510 lines
    const result = buildSmartDiff(files, []);
    expect(result.split_suggestion.too_big).toBe(true);
    expect(result.split_suggestion.total_lines).toBe(510);
  });

  it('exact boundary: 500 lines → not too_big', () => {
    const files = [makeFile('src/a.ts', 250, 250)]; // exactly 500
    const result = buildSmartDiff(files, []);
    expect(result.split_suggestion.too_big).toBe(false);
  });

  it('proposed_splits chunks core files by ~150 lines', () => {
    const files = [
      makeFile('src/a.ts', 100, 60),  // 160 lines → Part 1
      makeFile('src/b.ts', 80, 80),   // 160 lines → Part 2
      makeFile('src/c.ts', 90, 80),   // 170 lines → Part 3
      makeFile('src/index.ts', 5, 3), // wiring — excluded from splits
    ];
    // total = 160+160+170+8 = 498... need to exceed 500
    // Let's adjust so total > 500
    const coreFiles = [
      makeFile('src/a.ts', 100, 60),  // 160
      makeFile('src/b.ts', 80, 80),   // 160
      makeFile('src/c.ts', 90, 82),   // 172  total core=492
      makeFile('src/index.ts', 5, 5), // wiring 10, grand total=502
    ];
    const result = buildSmartDiff(coreFiles, []);
    expect(result.split_suggestion.too_big).toBe(true);
    const splits = result.split_suggestion.proposed_splits;
    // Part 1: src/a.ts (160 >= 150) → flushed
    // Part 2: src/b.ts (160 >= 150) → flushed
    // Part 3: src/c.ts (last core file) → flushed
    expect(splits.length).toBeGreaterThanOrEqual(2);
    expect(splits[0]!.name).toBe('Part 1');
    expect(splits[0]!.files).toContain('src/a.ts');
    expect(splits[splits.length - 1]!.files).toContain('src/c.ts');
  });

  it('proposed_splits excludes wiring and boilerplate files', () => {
    const files = [
      makeFile('src/a.ts', 300, 210), // core, 510 total alone
      makeFile('src/index.ts', 100, 50),    // wiring
      makeFile('pnpm-lock.yaml', 500, 200), // boilerplate
    ];
    const result = buildSmartDiff(files, []);
    expect(result.split_suggestion.too_big).toBe(true);
    result.split_suggestion.proposed_splits.forEach((split) => {
      split.files.forEach((f) => {
        expect(f).not.toBe('src/index.ts');
        expect(f).not.toBe('pnpm-lock.yaml');
      });
    });
  });
});
