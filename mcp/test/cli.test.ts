import { describe, it, expect } from 'vitest';
import { heuristicReview } from '../src/review.js';

/**
 * A3 — unit test for the pre-push CLI's offline heuristic review (L04).
 * SDK-free (does not import the MCP server), so it runs even before the
 * orchestrator installs @modelcontextprotocol/sdk.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,2 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_abcdef0123456789",
+  console.log("debug");
   redisUrl: x,`;

describe('heuristicReview', () => {
  it('flags a hard-coded secret as high severity on the right line', () => {
    const findings = heuristicReview(DIFF);
    const secret = findings.find((f) => f.title.includes('secret'));
    expect(secret).toBeTruthy();
    expect(secret!.severity).toBe('high');
    expect(secret!.file).toBe('src/config.ts');
    expect(secret!.line).toBe(11);
  });

  it('flags a leftover debug statement as low severity', () => {
    const findings = heuristicReview(DIFF);
    expect(findings.some((f) => f.title.includes('Debug'))).toBe(true);
  });

  it('returns no findings for a clean diff', () => {
    const clean = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const b = 2;`;
    expect(heuristicReview(clean)).toEqual([]);
  });
});
