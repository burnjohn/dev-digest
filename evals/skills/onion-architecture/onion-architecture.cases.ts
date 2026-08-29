import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

// Converted from the previous harness's evals.json (6 cases, 17 planted violations), which lived
// under .claude/skills/onion-architecture/evals/ — the skill's own payload directory, where the
// package README forbids case data from living. Prompts and planted violations are carried over
// verbatim; only the shape changed.
//
// These run on the CONTENT tier: skillTask injects SKILL.md as the system prompt and grants no
// tools, so every fixture file is inlined into the prompt rather than read from disk.

const readFixture = fixtureReader(import.meta.url);

/**
 * Inline a case's files at the paths they would occupy in the real tree. The fixtures are stored
 * under an `eval-N-<slug>/` bucket so the six cases can coexist; that bucket is stripped from the
 * displayed path, because the prompts tell the model these files sit under `server/src/` and a
 * visible `eval-1-webhooks/` prefix would contradict them.
 */
function inlineFiles(paths: string[]): string {
  return paths
    .map((p) => {
      const shown = p.replace(/^fixtures\//, "").replace(/^eval-\d+-[^/]+\//, "");
      const body = readFixture(p.replace(/^fixtures\//, ""));
      return `--- ${shown} ---\n${body}`;
    })
    .join("\n\n");
}

export const cases: SkillCase[] = [
  {
    name: "webhooks-module — flags all 3 planted violations",
    kind: "quality",
    prompt: "You're reviewing a PR against DevDigest's backend (server/, a Fastify 5 + Drizzle/Postgres API). The PR adds a new 'webhooks' module (outbound event delivery to a workspace's configured endpoint). Below are its files, given at the paths they'd occupy under server/src/. Review them for backend code-placement / architecture problems ONLY: which layer a piece of logic belongs in, whether imports respect the codebase's module boundaries, whether dependency injection follows the accepted convention. Do NOT comment on naming, formatting, missing tests, or plain business-logic bugs. For each problem: name the exact file, point at the specific import or line, and explain in 1-2 sentences why it's misplaced." + "\n\n" + inlineFiles(["fixtures/eval-1-webhooks/server/src/modules/webhooks/routes.ts","fixtures/eval-1-webhooks/server/src/modules/webhooks/service.ts","fixtures/eval-1-webhooks/server/src/modules/webhooks/repository.ts","fixtures/eval-1-webhooks/server/src/modules/webhooks/helpers.ts","fixtures/eval-1-webhooks/server/src/modules/webhooks/constants.ts","fixtures/eval-1-webhooks/server/src/modules/webhooks/types.ts"].map(String)),
    practices: [
      "the review reports this specific violation, naming the file: routes.ts imports drizzle-orm + db/schema.js and runs an inline SELECT in the GET /webhooks/:id/status handler instead of going through a repository (R5 must not import drizzle-orm/db)",
      "the review reports this specific violation, naming the file: service.ts constructor takes the whole Container instead of a narrow Deps interface (R2 must not hold Container)",
      "the review reports this specific violation, naming the file: service.ts reads process.env.WEBHOOK_SIGNING_SECRET directly instead of going through SecretsProvider/platform config (process.env only allowed in platform/config.ts and adapters/secrets/local.ts)",
    ],
    // Every violation here was deliberately planted, so missing one is a real miss and the bar is
    // all of them. UNMEASURED: this threshold is an argument, not a measurement — run
    // `pnpm eval:repeat skills/onion-architecture -n 2` before trusting it.
    threshold: 1.0,
    maxTurns: 4,
  },

  {
    name: "labels-module — flags all 3 planted violations",
    kind: "quality",
    prompt: "You're reviewing a PR against DevDigest's backend (server/, a Fastify 5 + Drizzle/Postgres API). The PR adds a new 'labels' module (syncs a repo's GitHub labels into a local cache). Below are its files, given at the paths they'd occupy under server/src/. Review them for backend code-placement / architecture problems ONLY: which layer a piece of logic belongs in, whether imports respect the codebase's module boundaries, whether dependency injection follows the accepted convention. Do NOT comment on naming, formatting, missing tests, or plain business-logic bugs. For each problem: name the exact file, point at the specific import or line, and explain in 1-2 sentences why it's misplaced." + "\n\n" + inlineFiles(["fixtures/eval-2-labels/server/src/modules/labels/routes.ts","fixtures/eval-2-labels/server/src/modules/labels/service.ts","fixtures/eval-2-labels/server/src/modules/labels/repository.ts","fixtures/eval-2-labels/server/src/modules/labels/helpers.ts","fixtures/eval-2-labels/server/src/modules/labels/constants.ts","fixtures/eval-2-labels/server/src/modules/labels/types.ts"].map(String)),
    practices: [
      "the review reports this specific violation, naming the file: service.ts imports REFRESH_JOB_KIND from ../repo-intel/constants.js — one module reaching into another module's constants.ts, which is a forbidden cross-module import",
      "the review reports this specific violation, naming the file: service.ts imports the Drizzle schema (`import type * as schema from '../../db/schema.js'`) and infers LabelRow via $inferSelect directly, instead of adding the row type to db/rows.ts (R2 must not import db/schema*)",
      "the review reports this specific violation, naming the file: repository.ts imports platform/container.ts to call container.github() (R3 persistence must not import platform/container; the repository should not reach for adapters itself)",
    ],
    // Every violation here was deliberately planted, so missing one is a real miss and the bar is
    // all of them. UNMEASURED: this threshold is an argument, not a measurement — run
    // `pnpm eval:repeat skills/onion-architecture -n 2` before trusting it.
    threshold: 1.0,
    maxTurns: 4,
  },

  {
    name: "adapters-platform-tags — flags all 3 planted violations",
    kind: "quality",
    prompt: "You're reviewing a PR against DevDigest's backend (server/, a Fastify 5 + Drizzle/Postgres API). The PR adds three unrelated pieces in the same change: a manifest-reading adapter, a workspace usage-quota helper, and a 'tags' module (freeform workspace-scoped labels). Below are the files, given at the paths they'd occupy under server/src/. Review them for backend code-placement / architecture problems ONLY: which layer a piece of logic belongs in, whether imports respect the codebase's module boundaries, whether the transport layer's contracts are correctly declared. Do NOT comment on naming, formatting, missing tests, or plain business-logic bugs. For each problem: name the exact file, point at the specific import or line, and explain in 1-2 sentences why it's misplaced." + "\n\n" + inlineFiles(["fixtures/eval-3-adapters-platform/server/src/adapters/parsers/manifest.ts","fixtures/eval-3-adapters-platform/server/src/platform/quota.ts","fixtures/eval-3-adapters-platform/server/src/modules/tags/routes.ts","fixtures/eval-3-adapters-platform/server/src/modules/tags/service.ts","fixtures/eval-3-adapters-platform/server/src/modules/tags/repository.ts","fixtures/eval-3-adapters-platform/server/src/modules/tags/constants.ts"].map(String)),
    practices: [
      "the review reports this specific violation, naming the file: adapters/parsers/manifest.ts imports MANIFEST_FILENAMES from ../../modules/repo-intel/constants.js — a driven adapter (R4) must be feature-agnostic and must not import modules/**",
      "the review reports this specific violation, naming the file: platform/quota.ts imports db/client.js and db/schema.js and queries Postgres directly from what is presented as pure platform kernel code (R1 platform/*.ts must not import db/** or drizzle-orm)",
      "the review reports this specific violation, naming the file: modules/tags/routes.ts's GET /tags and POST /tags handlers return repository rows / entities straight to the client with no schema.response declared and no DTO mapping through helpers.ts",
    ],
    // Every violation here was deliberately planted, so missing one is a real miss and the bar is
    // all of them. UNMEASURED: this threshold is an argument, not a measurement — run
    // `pnpm eval:repeat skills/onion-architecture -n 2` before trusting it.
    threshold: 1.0,
    maxTurns: 4,
  },

  {
    name: "run-progress-module — flags all 2 planted violations",
    kind: "quality",
    // Authoring notes carried over from evals.json:
    //   service — a rule already covered by v1.0.0, kept here as a regression sanity-check both skill versions should still catch
    //   service — the rule new in v1.1.0, which v1.0.0 has no basis to flag
    prompt: "You're reviewing a PR against DevDigest's backend (server/, a Fastify 5 + Drizzle/Postgres API). The PR adds a 'run-progress' module: lightweight polling-friendly checkpoints for a long-running review/index run, alongside the existing SSE event stream. Below are its files, given at the paths they'd occupy under server/src/. Review them for backend code-placement / architecture problems ONLY: which layer a piece of logic belongs in, whether imports respect the codebase's module boundaries, whether dependency injection follows the accepted convention. Do NOT comment on naming, formatting, missing tests, or plain business-logic bugs. For each problem: name the exact file, point at the specific import or line, and explain in 1-2 sentences why it's misplaced." + "\n\n" + inlineFiles(["fixtures/eval-4-run-progress/server/src/modules/run-progress/routes.ts","fixtures/eval-4-run-progress/server/src/modules/run-progress/service.ts","fixtures/eval-4-run-progress/server/src/modules/run-progress/repository.ts","fixtures/eval-4-run-progress/server/src/modules/run-progress/constants.ts"].map(String)),
    practices: [
      "the review reports this specific violation, naming the file: service.ts constructor takes the whole Container instead of a narrow Deps interface (R2 must not hold Container)",
      "the review reports this specific violation, naming the file: service.ts imports { runBus } from '../../platform/infra/sse.js' directly and calls runBus.publish(...) instead of receiving RunBus via Deps",
    ],
    // Every violation here was deliberately planted, so missing one is a real miss and the bar is
    // all of them. UNMEASURED: this threshold is an argument, not a measurement — run
    // `pnpm eval:repeat skills/onion-architecture -n 2` before trusting it.
    threshold: 1.0,
    maxTurns: 4,
  },

  {
    name: "review-comments-module — flags all 3 planted violations",
    kind: "quality",
    // Authoring notes carried over from evals.json:
    //   service — pre-existing rule, regression sanity-check
    //   service — pre-existing rule, regression sanity-check
    //   query-helpers — R3-shaped code under a filename that doesn't match either the R2 or R3 path pattern in the pre-v1.2.0 matrix; the harder-to-spot violation this eval exists to test
    prompt: "You're reviewing a PR against DevDigest's backend (server/, a Fastify 5 + Drizzle/Postgres API). The PR adds a 'review-comments' module: threaded discussion on a review finding, plus a workspace-wide unresolved-discussions summary. Below are its files, given at the paths they'd occupy under server/src/. Review them for backend code-placement / architecture problems ONLY: which layer a piece of logic belongs in, whether imports respect the codebase's module boundaries, whether dependency injection follows the accepted convention. Do NOT comment on naming, formatting, missing tests, or plain business-logic bugs. For each problem: name the exact file, point at the specific import or line, and explain in 1-2 sentences why it's misplaced." + "\n\n" + inlineFiles(["fixtures/eval-5-review-comments/server/src/modules/review-comments/routes.ts","fixtures/eval-5-review-comments/server/src/modules/review-comments/service.ts","fixtures/eval-5-review-comments/server/src/modules/review-comments/repository.ts","fixtures/eval-5-review-comments/server/src/modules/review-comments/query-helpers.ts","fixtures/eval-5-review-comments/server/src/modules/review-comments/helpers.ts","fixtures/eval-5-review-comments/server/src/modules/review-comments/mapper.ts","fixtures/eval-5-review-comments/server/src/modules/review-comments/constants.ts","fixtures/eval-5-review-comments/server/src/modules/review-comments/types.ts"].map(String)),
    practices: [
      "the review reports this specific violation, naming the file: service.ts constructor takes the whole Container instead of a narrow Deps interface (R2 must not hold Container)",
      "the review reports this specific violation, naming the file: service.ts reads process.env.COMMENT_MODERATION_WEBHOOK directly instead of via SecretsProvider/config",
      "the review reports this specific violation, naming the file: query-helpers.ts imports drizzle-orm and db/schema.js and builds query fragments (commentVisibilityFilter, unresolvedThreadCountExpr), imported and used only by service.ts, not repository.ts",
    ],
    // Every violation here was deliberately planted, so missing one is a real miss and the bar is
    // all of them. UNMEASURED: this threshold is an argument, not a measurement — run
    // `pnpm eval:repeat skills/onion-architecture -n 2` before trusting it.
    threshold: 1.0,
    maxTurns: 4,
  },

  {
    name: "notifications-digest-module — flags all 3 planted violations",
    kind: "quality",
    // Authoring notes carried over from evals.json:
    //   notifications/service — pre-existing rule, regression sanity-check
    //   notifications/service — pre-existing rule, regression sanity-check
    //   notifications/service — the same violation class as importing another module's constants.ts, but only named as an explicit example starting in v1.3.0; the harder-to-spot violation this eval exists to test
    prompt: "You're reviewing a PR against DevDigest's backend (server/, a Fastify 5 + Drizzle/Postgres API). The PR adds a 'notifications' module that sends a daily digest of comment activity to a workspace's Slack channel. The 'comments' module's service.ts is given as read-only context (it already exists in the codebase, it is not part of this PR) so you can see what the new module imports from it. Review the notifications module's files for backend code-placement / architecture problems ONLY: which layer a piece of logic belongs in, whether imports respect the codebase's module boundaries, whether dependency injection follows the accepted convention. Do NOT comment on naming, formatting, missing tests, or plain business-logic bugs. For each problem: name the exact file, point at the specific import or line, and explain in 1-2 sentences why it's misplaced." + "\n\n" + inlineFiles(["fixtures/eval-6-notifications-digest/server/src/modules/notifications/routes.ts","fixtures/eval-6-notifications-digest/server/src/modules/notifications/service.ts","fixtures/eval-6-notifications-digest/server/src/modules/notifications/repository.ts","fixtures/eval-6-notifications-digest/server/src/modules/notifications/constants.ts","fixtures/eval-6-notifications-digest/server/src/modules/comments/service.ts","fixtures/eval-6-notifications-digest/server/src/modules/comments/repository.ts"].map(String)),
    practices: [
      "the review reports this specific violation, naming the file: notifications/service.ts constructor takes the whole Container instead of a narrow Deps interface (R2 must not hold Container)",
      "the review reports this specific violation, naming the file: notifications/service.ts reads process.env.DIGEST_SLACK_WEBHOOK directly instead of via SecretsProvider/config",
      "the review reports this specific violation, naming the file: notifications/service.ts imports { CommentService } from '../comments/service.js' and instantiates + calls it directly (this.commentService.listRecentAcrossWorkspace(...)) instead of exposing comments as a container port",
    ],
    // Every violation here was deliberately planted, so missing one is a real miss and the bar is
    // all of them. UNMEASURED: this threshold is an argument, not a measurement — run
    // `pnpm eval:repeat skills/onion-architecture -n 2` before trusting it.
    threshold: 1.0,
    maxTurns: 4,
  },
];
