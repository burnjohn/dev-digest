import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { groundFindings, groundingSummary } from '../src/platform/grounding.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,
diff --git a/src/api/users.ts b/src/api/users.ts
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -44,2 +44,6 @@
   const users = await db.users.findMany();
+  for (const u of users) {
+    const posts = await db.posts.findMany({ userId: u.id });
+    result.push({ ...u, posts });
+  }`;

function f(partial: Partial<Finding>): Finding {
  return {
    id: 'x',
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    file: 'src/config.ts',
    start_line: 12,
    end_line: 12,
    rationale: 'r',
    confidence: 0.8,
    ...partial,
  };
}

describe('citation grounding gate (§11)', () => {
  const diff = parseUnifiedDiff(DIFF);

  it('keeps a finding whose line intersects a real hunk', () => {
    const res = groundFindings([f({ file: 'src/config.ts', start_line: 12, end_line: 12 })], diff);
    expect(res.kept).toHaveLength(1);
    expect(res.dropped).toHaveLength(0);
  });

  it('drops a finding whose line does NOT intersect any hunk', () => {
    const res = groundFindings(
      [f({ file: 'src/config.ts', start_line: 999, end_line: 999 })],
      diff,
    );
    expect(res.kept).toHaveLength(0);
    expect(res.dropped[0]!.reason).toMatch(/do not intersect/);
  });

  it('drops a finding whose file is not in the diff', () => {
    const res = groundFindings([f({ file: 'src/not-here.ts' })], diff);
    expect(res.kept).toHaveLength(0);
    expect(res.dropped[0]!.reason).toMatch(/not present in diff/);
  });

  it('full-file kinds (secret_leak) ground against the file, not a hunk', () => {
    const res = groundFindings(
      [f({ file: 'src/config.ts', start_line: 1, end_line: 1, kind: 'secret_leak' })],
      diff,
    );
    expect(res.kept).toHaveLength(1);
  });

  it('range intersection across N+1 hunk lines', () => {
    const res = groundFindings(
      [f({ file: 'src/api/users.ts', start_line: 45, end_line: 52, category: 'perf' })],
      diff,
    );
    expect(res.kept).toHaveLength(1);
  });

  it('groundingSummary reports kept/total', () => {
    const res = groundFindings(
      [
        f({ file: 'src/config.ts', start_line: 12, end_line: 12 }),
        f({ file: 'src/config.ts', start_line: 999, end_line: 999 }),
      ],
      diff,
    );
    expect(groundingSummary(res)).toBe('1/2 passed');
  });
});

describe('unified diff parser', () => {
  it('extracts files and new-side line numbers', () => {
    const diff = parseUnifiedDiff(DIFF);
    expect(diff.files.map((f) => f.path)).toEqual(['src/config.ts', 'src/api/users.ts']);
    const config = diff.files[0]!;
    expect(config.additions).toBe(1);
    expect(config.hunks[0]!.newLineNumbers).toContain(11); // the added stripeKey line
  });
});
