import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

/**
 * `adapters/git/diff-parser.ts` had no test file of its own before SPEC-03 T5
 * — added alongside the in-hunk header guard (docs/plans/09-eval-pipeline.md
 * T5, `Do` item 3). Covers both halves: real multi-file diffs still resolve
 * file headers exactly as today, and a line that only LOOKS like a header
 * once it is inside a hunk is no longer honoured as one.
 */

const MULTI_FILE_DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,
   env: "prod",
diff --git a/src/new-file.ts b/src/new-file.ts
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;`;

describe('parseUnifiedDiff — real multi-file diff (guard scoped to in-hunk only)', () => {
  it('resolves each file path from its --- /+++ headers exactly as before the guard', () => {
    const parsed = parseUnifiedDiff(MULTI_FILE_DIFF);
    expect(parsed.files).toHaveLength(2);

    const [configFile, newFile] = parsed.files;
    expect(configFile.path).toBe('src/config.ts');
    expect(configFile.hunks).toHaveLength(1);
    expect(configFile.hunks[0].newLineNumbers).toEqual([10, 11, 12, 13]);
    expect(configFile.additions).toBe(1);

    expect(newFile.path).toBe('src/new-file.ts');
    expect(newFile.hunks[0].oldLines).toBe(0);
    expect(newFile.hunks[0].newLineNumbers).toEqual([1, 2]);
    expect(newFile.additions).toBe(2);
  });
});

describe('parseUnifiedDiff — the in-hunk header guard', () => {
  it('honours --- /+++ as a file header only before the first @@ of a file', () => {
    // `-- evil.ts` / `++ evil.ts` diff-encoded (one extra prefix char each)
    // land INSIDE the hunk, after the real `@@`. Before the guard these were
    // read as a second file header, forging the path and dropping both lines
    // from the hunk with no error raised.
    const diff = `diff --git a/case-42.ts b/case-42.ts
--- a/case-42.ts
+++ b/case-42.ts
@@ -1,1 +1,1 @@
--- evil.ts
+++ evil.ts`;

    const parsed = parseUnifiedDiff(diff);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].path).toBe('case-42.ts');
    expect(parsed.files[0].deletions).toBe(1);
    expect(parsed.files[0].additions).toBe(1);
    expect(parsed.files[0].hunks[0].newLineNumbers).toEqual([1]);
  });

  it('a genuine second file after a hunk still opens a new header scope via diff --git', () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-old
+new
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,1 +1,1 @@
-old2
+new2`;

    const parsed = parseUnifiedDiff(diff);
    expect(parsed.files).toHaveLength(2);
    expect(parsed.files[0].path).toBe('a.ts');
    expect(parsed.files[1].path).toBe('b.ts');
  });
});
