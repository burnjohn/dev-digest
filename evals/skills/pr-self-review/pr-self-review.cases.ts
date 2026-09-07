import type { SkillCase } from "../../src/index.js";

// pr-self-review's Phase 0/1 shell out to real commands (git diff, pnpm typecheck, …), but a
// "quality" case runs skillTask with NO tools — it measures the SKILL.md content in isolation.
// So each prompt inlines the diff plus pre-collected Phase 0/1 results (as if already gathered),
// the same pattern dependency-checker's cases.ts uses for its REPO_DATA block.

const CHECKS_PASSED = `Phase 0/1 already ran, treat these as given — do not ask to re-run them:

git branch --show-current: feat/webhook-charges
git diff --name-status main...HEAD: M server/src/routes/webhooks.ts
git status --porcelain: (clean, nothing uncommitted)

pnpm typecheck (server): exit=0, no errors
pnpm arch (server): exit=0, no new violations
pnpm exec vitest run --exclude '**/*.it.test.ts' (server): exit=0, 101/101 passed`;

export const cases: SkillCase[] = [
  {
    name: "hardcoded secret in the diff blocks the verdict",
    kind: "quality",
    prompt: `Self-review this diff before I open the PR.\n\n${CHECKS_PASSED}\n\nDiff:\n\`\`\`diff\n--- a/server/src/routes/webhooks.ts\n+++ b/server/src/routes/webhooks.ts\n@@ -10,6 +10,10 @@\n   fastify.post("/webhooks/stripe", async (request, reply) => {\n+    const STRIPE_KEY = "c3RyaXBlX2xpdmVfc2VjcmV0X2tleV9mb3JfcGF5bWVudHNfcHJvY2Vzc2luZw==";\n+    await fetch("https://api.stripe.com/v1/charges", {\n+      headers: { Authorization: \`Bearer \${STRIPE_KEY}\` },\n+    });\n     reply.send({ ok: true });\n   });\n\`\`\``,
    practices: [
      "the report includes a finding on the added STRIPE_KEY line identifying it as a hardcoded secret or credential",
      "that finding is classified as CRITICAL severity",
      "the final verdict line is BLOCKED, not PASS",
      "the secret finding is explicitly described as gating/blocking the verdict, not merely advisory",
    ],
    threshold: 0.65,
    maxTurns: 8,
  },
  {
    name: "a HIGH-severity finding alone does not block the verdict",
    kind: "quality",
    prompt: `Self-review this diff before I open the PR.\n\n${CHECKS_PASSED.replace("M server/src/routes/webhooks.ts", "A client/src/app/repos/[repoId]/pulls/_components/UserAvatar/UserAvatar.tsx").replace(/server\/src\/routes\/webhooks\.ts/, "server/src/routes/webhooks.ts (unrelated, unchanged in this diff)")}\n\nDiff:\n\`\`\`diff\n--- /dev/null\n+++ b/client/src/app/repos/[repoId]/pulls/_components/UserAvatar/UserAvatar.tsx\n@@ -0,0 +1,9 @@\n+export function UserAvatar({ url, name }: { url: string; name: string }) {\n+  return (\n+    <img src={url} alt={name} className="h-8 w-8 rounded-full" />\n+  );\n+}\n\`\`\`\n\nNote: no \`UserAvatar.test.tsx\` is included anywhere in this diff.`,
    practices: [
      "the report includes a finding that the new exported UserAvatar component has no accompanying test file in the diff",
      "that finding is classified as HIGH severity, not CRITICAL",
      "the final verdict does not say BLOCKED — it uses wording like PASS or REPORTED that indicates the PR can proceed",
      "the report explicitly states or implies that HIGH-severity findings are reported/advisory rather than blocking",
    ],
    threshold: 0.65,
    maxTurns: 8,
  },
  {
    name: "a failed deterministic check blocks even when the diff itself looks clean",
    kind: "quality",
    prompt: `Self-review this diff before I open the PR.\n\nPhase 0/1 already ran, treat these as given — do not ask to re-run them:\n\ngit branch --show-current: fix/review-status-label\ngit diff --name-status main...HEAD: M server/src/routes/reviews.ts\ngit status --porcelain: (clean, nothing uncommitted)\n\npnpm typecheck (server): exit=2\nserver/src/routes/reviews.ts:42:11 - error TS2322: Type 'string' is not assignable to type 'ReviewStatus'.\npnpm arch (server): not run (typecheck failed first)\npnpm exec vitest run (server): not run (typecheck failed first)\n\nDiff:\n\`\`\`diff\n--- a/server/src/routes/reviews.ts\n+++ b/server/src/routes/reviews.ts\n@@ -39,6 +39,6 @@\n   const status = request.body.status;\n-  await reviewService.setStatus(reviewId, status as ReviewStatus);\n+  await reviewService.setStatus(reviewId, status);\n   reply.send({ ok: true });\n\`\`\``,
    practices: [
      "the final verdict line is BLOCKED, not PASS",
      "the report attributes the block to the failed pnpm typecheck check, citing server/src/routes/reviews.ts and the TS2322 error",
      "the report does not claim to have completed a routed-skill review pass (Phase 3 onward) given the Phase 1 failure",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
  {
    name: "code relocated unchanged from main is not reported as a new finding",
    kind: "quality",
    prompt: `Self-review this diff before I open the PR.\n\n${CHECKS_PASSED.replace("M server/src/routes/webhooks.ts", "A client/src/app/repos/[repoId]/pulls/_components/PRTable/PRTable.tsx\nM client/src/app/repos/[repoId]/pulls/page.tsx")}\n\nPRTable.tsx is a brand-new file in this diff (every line reads as added), but it is a pure extraction: \`git grep -F "rows.map((r, i) => <tr key={i}>" main -- 'client/src/app/repos/**/*.tsx'\` confirms this exact block already existed, unchanged, in client/src/app/repos/[repoId]/pulls/page.tsx on main — this diff only moves it into its own file. Treat that as already verified; do not ask to re-check it.\n\nDiff:\n\`\`\`diff\n--- /dev/null\n+++ b/client/src/app/repos/[repoId]/pulls/_components/PRTable/PRTable.tsx\n@@ -0,0 +1,10 @@\n+export function PRTable({ rows }: { rows: PullRequestRow[] }) {\n+  console.log("rendering rows", rows);\n+  return (\n+    <table>\n+      <tbody>\n+        {rows.map((r, i) => <tr key={i}>{r.title}</tr>)}\n+      </tbody>\n+    </table>\n+  );\n+}\n--- a/client/src/app/repos/[repoId]/pulls/page.tsx\n+++ b/client/src/app/repos/[repoId]/pulls/page.tsx\n@@ -20,10 +20,7 @@\n-      <table>\n-        <tbody>\n-          {rows.map((r, i) => <tr key={i}>{r.title}</tr>)}\n-        </tbody>\n-      </table>\n+      <PRTable rows={rows} />\n\`\`\``,
    practices: [
      "the report does NOT raise a finding about the index-as-key (key={i}) pattern in the rows.map call, since that line is confirmed unchanged from main",
      "the report DOES raise a finding about the console.log left in the added PRTable.tsx, since that line is genuinely new",
      "if the extraction itself is mentioned, it is noted as informational context (e.g. lines moved from page.tsx) rather than as a blocking or advisory finding in its own right",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
