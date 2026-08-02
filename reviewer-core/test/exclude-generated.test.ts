import { describe, it, expect } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { excludeGenerated, DEFAULT_GENERATED_PATTERNS } from '../src/review/exclude-generated.js';

/** A diff whose `raw` really contains one `diff --git` section per file, so the
 *  rebuild path (not just the file list) is exercised. */
function diffOf(paths: string[]): UnifiedDiff {
  return {
    raw: paths.map((p) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n+x`).join('\n'),
    files: paths.map((p) => ({
      path: p,
      additions: 1,
      deletions: 0,
      hunks: [{ file: p, oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['+x'] }],
    })),
  } as UnifiedDiff;
}

describe('excludeGenerated', () => {
  it('drops drizzle snapshots and shrinks raw, not just the file list', () => {
    const before = diffOf([
      'server/src/db/migrations/meta/0010_snapshot.json',
      'server/src/db/migrations/meta/_journal.json',
      'server/src/modules/pulls/routes.ts',
    ]);
    const { diff, excluded } = excludeGenerated(before);

    expect(diff.files.map((f) => f.path)).toEqual(['server/src/modules/pulls/routes.ts']);
    expect(excluded).toHaveLength(2);
    expect(diff.raw).not.toContain('0010_snapshot.json');
    expect(diff.raw).toContain('routes.ts');
    expect(diff.raw.length).toBeLessThan(before.raw.length);
  });

  it('covers lockfiles, build output and minified assets', () => {
    const { excluded } = excludeGenerated(
      diffOf(['pnpm-lock.yaml', 'client/dist/app.js', 'a/b.min.css', 'src/real.ts']),
    );
    expect(excluded.sort()).toEqual(['a/b.min.css', 'client/dist/app.js', 'pnpm-lock.yaml']);
  });

  it('leaves an ordinary diff untouched', () => {
    const before = diffOf(['src/a.ts', 'src/b.ts']);
    const { diff, excluded } = excludeGenerated(before);
    expect(excluded).toEqual([]);
    expect(diff).toBe(before);
  });

  it('keeps the diff when EVERY file is generated — a review of noise beats no review', () => {
    const before = diffOf(['pnpm-lock.yaml', 'server/src/db/migrations/meta/0010_snapshot.json']);
    const { diff, excluded } = excludeGenerated(before);
    expect(excluded).toEqual([]);
    expect(diff).toBe(before);
  });

  it('honours caller-supplied patterns instead of the defaults', () => {
    const { excluded } = excludeGenerated(diffOf(['pnpm-lock.yaml', 'src/gen.ts']), [/gen\.ts$/]);
    expect(excluded).toEqual(['src/gen.ts']);
  });

  it('exports the default patterns so callers can extend them', () => {
    expect(DEFAULT_GENERATED_PATTERNS.some((p) => p.test('x/migrations/meta/0001_snapshot.json'))).toBe(true);
  });
});
