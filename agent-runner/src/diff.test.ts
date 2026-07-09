import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff, stripIgnoredFiles } from './diff.js';

/**
 * Sanity test for the self-authored unified-diff parser (agent-runner cannot
 * import the server's `git/diff-parser.ts` — outside owned paths and would
 * break the ncc bundle's self-containment). Must produce the exact
 * `UnifiedDiff`/`DiffHunk` shape the citation-grounding gate needs: per-file
 * hunks with the set of new-side line numbers they cover.
 */
export const FIXTURE_DIFF_RAW = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -9,3 +9,4 @@
 host: 'localhost',
+apiKey: 'sk_live_abcdef123456',
 port: 3000,
 timeout: 30,
`;

describe('parseUnifiedDiff', () => {
  it('parses a single-file, single-hunk diff into files + hunks + new-side line numbers', () => {
    const diff = parseUnifiedDiff(FIXTURE_DIFF_RAW);

    expect(diff.raw).toBe(FIXTURE_DIFF_RAW);
    expect(diff.files).toHaveLength(1);
    const file = diff.files[0]!;
    expect(file.path).toBe('src/config.ts');
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(0);
    expect(file.hunks).toHaveLength(1);

    const hunk = file.hunks[0]!;
    expect(hunk.oldStart).toBe(9);
    expect(hunk.oldLines).toBe(3);
    expect(hunk.newStart).toBe(9);
    expect(hunk.newLines).toBe(4);
    // context(9), added(10), context(11), context(12)
    expect(hunk.newLineNumbers).toEqual([9, 10, 11, 12]);
  });

  it('a line NOT covered by any hunk (e.g. 999) is absent from new-side line numbers', () => {
    const diff = parseUnifiedDiff(FIXTURE_DIFF_RAW);
    const covered = new Set(diff.files[0]!.hunks.flatMap((h) => h.newLineNumbers));
    expect(covered.has(999)).toBe(false);
  });

  it('handles multiple files', () => {
    const raw = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 line one
+line two
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -5,2 +5,2 @@
-old line
+new line
 unchanged
`;
    const diff = parseUnifiedDiff(raw);
    expect(diff.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(diff.files[1]!.deletions).toBe(1);
    expect(diff.files[1]!.additions).toBe(1);
  });
});

describe('stripIgnoredFiles', () => {
  const raw = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,1 +1,2 @@
 keep me
+real change
diff --git a/.devdigest/runner/index.js b/.devdigest/runner/index.js
--- a/.devdigest/runner/index.js
+++ b/.devdigest/runner/index.js
@@ -1,1 +1,1 @@
-old bundle
+new bundle
diff --git a/.github/workflows/devdigest-review.yml b/.github/workflows/devdigest-review.yml
--- a/.github/workflows/devdigest-review.yml
+++ b/.github/workflows/devdigest-review.yml
@@ -1,1 +1,2 @@
 name: DevDigest Review
+on: pull_request
`;

  it('drops the .devdigest/ runner bundle (the source of the GitHub 422)', () => {
    const files = parseUnifiedDiff(stripIgnoredFiles(raw)).files.map((f) => f.path);
    expect(files).not.toContain('.devdigest/runner/index.js');
  });

  it('drops the generated .github/workflows/ file', () => {
    const files = parseUnifiedDiff(stripIgnoredFiles(raw)).files.map((f) => f.path);
    expect(files).not.toContain('.github/workflows/devdigest-review.yml');
  });

  it('keeps the target repo files untouched', () => {
    const diff = parseUnifiedDiff(stripIgnoredFiles(raw));
    expect(diff.files.map((f) => f.path)).toEqual(['src/config.ts']);
    expect(diff.files[0]!.additions).toBe(1);
    // the kept section's content survives verbatim
    expect(diff.raw).toContain('+real change');
    expect(diff.raw).not.toContain('new bundle');
  });

  it('is a no-op when nothing is ignored', () => {
    expect(stripIgnoredFiles(FIXTURE_DIFF_RAW)).toBe(FIXTURE_DIFF_RAW);
  });
});
