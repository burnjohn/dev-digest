# Server Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

2026-06-20 — `ContainerOverrides` is the correct test-double injection point for all adapters — pass mocks via `new Container(config, db, { llm: { openai: new MockLLMProvider() }, github: new MockGitHubClient() })`. Using `vi.mock()` on an adapter module file is a code smell here: if you need it, the dependency should be constructor-injected instead. ref: server/src/adapters/mocks.ts:1

2026-06-22 — New adapter port pattern: (1) add interface to `adapters.ts` additive-only, (2) create concrete in `adapters/<category>/<name>.ts`, (3) import concrete ONLY in `container.ts`, (4) add private `_field` + lazy getter mirroring the `git` getter, (5) add `field?` slot to `ContainerOverrides`, (6) add `MockXClient` to `mocks.ts`. All six steps form one atomic unit — partial completion causes typecheck failures. ref: server/src/adapters/http/web-fetch.ts:1

2026-06-18 — Unit-testing a drizzle repo function with two sequential queries: mock `db.select()` with a call counter; each call returns a fresh chain where `.orderBy()` (first query) or `.groupBy()` (second query) resolves with the appropriate fixture data. All intermediate chain methods (`from`, `leftJoin`, `innerJoin`, `where`) return `this`. Pattern validated for `listRunsForPull`. ref: server/src/modules/reviews/repository/run.repo.severity.test.ts:53

## What Doesn't Work

2026-06-22 — Refactoring an inline SSRF guard into a container-wired adapter: the old inline helper (`safeFetchSkillUrl` in skills/routes.ts) had identical logic but was unreachable from other modules. Lifting it to `WebFetchAdapter` + `WebFetchClient` port lets the intent module reuse it via `container.webFetch.fetch()` without re-implementing SSRF guards. The route refactor must remove the unused import (`ValidationError`) or typecheck warns. ref: server/src/modules/skills/routes.ts:1

2026-06-22 — The Edit tool's `old_string`/`new_string` params silently substitute Unicode typographic quotes (curly `'`/`'`) for ASCII single-quote delimiters when the replacement block contains other Unicode characters (e.g. `·` middle-dot, curly apostrophe `'`). In `platform.ts` this produced TS1127 "Invalid character" errors across the entire `FEATURE_MODELS` array. Fix: use a Python byte-level `open(..., 'rb')`/`write` to replace only the target bytes without touching surrounding quote characters. ref: server/src/vendor/shared/contracts/platform.ts:51

2026-06-17 — `selectDistinctOn([agentRuns.prId])` for cost silently returns null when the most recent run errored (`cost_usd = null`). DISTINCT ON picks the newest row regardless of whether the value is null — so a trailing error run zeros out the entire COST column. Fix: use `sql\`sum(${t.agentRuns.costUsd})\`` with `.groupBy(t.agentRuns.prId)` — SQL SUM skips nulls, so error runs don't affect the total. ref: server/src/modules/pulls/routes.ts:122

## Codebase Patterns

2026-06-22 — The minimal `Logger` type (`{ info, warn, error, debug }`) for new server modules is NOT exported from `@devdigest/shared` — it lives in `server/src/modules/reviews/run-executor.ts` as `export type Logger`. Import it with `import type { Logger } from '../reviews/run-executor.js'`. ref: server/src/modules/reviews/run-executor.ts:31

2026-06-20 — Layer mapping for Onion Architecture: Domain=`src/vendor/shared/contracts/` (pure TS types, zero framework imports), Application=`modules/*/service.ts` (orchestration, no SQL), Infrastructure=`modules/*/repository.ts` + `src/adapters/` (Drizzle, Octokit, OpenAI SDK), Presentation=`modules/*/routes.ts` (Fastify handlers). Documented in `.claude/skills/onion-architecture/`. ref: server/src/platform/container.ts:1

2026-06-20 — `src/platform/` is NOT an architectural layer — it is cross-cutting infrastructure (Container, RunBus, JobRunner, AppError, AppConfig) that any layer may import without violating the inward-only dependency rule. Treating it as a layer and avoiding imports from it is a mistake. ref: server/src/platform/container.ts:1

2026-06-20 — Cross-module data access: a service must never import another module's `repository.ts` directly. Instead, shared repositories are pre-built as properties on `Container` (e.g. `container.agentsRepo`). To add cross-module data access, add a property to `Container` first, then use it via `this.container.X`. ref: server/src/platform/container.ts:1

2026-06-20 — `getContext(container, req)` is the mandatory first call in every Fastify route handler — it extracts `workspaceId` + `userId` from the auth context. Never read `workspaceId` from `req.headers` manually in a handler; always go through `getContext`. ref: server/src/modules/_shared/context.ts:1

2026-06-18 — `agent_runs` stores only total `findingsCount` and `blockers` — no per-severity breakdown. To get critical/warning/suggestion counts per run, use: `findings` JOIN `reviews` (on `reviews.id = findings.reviewId`), filter `inArray(t.reviews.runId, runIds)`, group by `(reviews.runId, findings.severity)`. Second query pattern, merge into result map. ref: server/src/modules/reviews/repository/run.repo.ts:51

2026-06-17 — `nullish()` (not `nullable()` or `optional()`) is the convention for optional DTO fields in `platform.ts`. Use `z.number().nullish()` for fields that may be absent from older DB rows — accepts both `null` and `undefined` from Drizzle. ref: server/src/vendor/shared/contracts/platform.ts:157

## Tool & Library Notes

2026-06-17 — `sql` template tag from `drizzle-orm` is NOT included in the common named-export bundle used in this file (`and, desc, eq, inArray`). When adding raw SQL expressions (e.g. `sql\`sum(...)\``), add `sql` to the import explicitly: `import { and, desc, eq, inArray, sql } from 'drizzle-orm'`. Missing it gives a "sql is not defined" runtime error, not a TS error. ref: server/src/modules/pulls/routes.ts:3

2026-06-17 — Drizzle `selectDistinctOn([col])` requires the first `orderBy()` column to match the DISTINCT ON column. For "latest row per group": `.selectDistinctOn([t.agentRuns.prId], {...}).orderBy(t.agentRuns.prId, desc(t.agentRuns.ranAt))`. Without the matching prId in orderBy, Postgres throws "SELECT DISTINCT ON expressions must match initial ORDER BY expressions". ref: server/src/modules/pulls/routes.ts:1

## Recurring Errors & Fixes

2026-06-22 — `RunLogger.info(msg, data?)` takes message as the FIRST argument (not pino-style `(obj, msg)`). Calling it as `runLog.info({ prId }, "msg")` produces TS2345 "Argument of type '{}' is not assignable to parameter of type 'string'". Fix: swap to `runLog.info("msg", { prId })`. ref: server/src/platform/run-logger.ts:55

2026-06-22 — `RunLogger` has no `warn` method — only `info`, `tool`, `result`, `error`. Using `runLog.warn(...)` gives TS2339 "Property 'warn' does not exist". For non-fatal advisory log lines (e.g. intent computation fallback), use `runLog.info(...)`. ref: server/src/platform/run-logger.ts:36

2026-06-22 — `RegExpMatchArray` captures typed as `string | undefined` in strict TypeScript: accessing `match[1]`, `match[2]`, etc. directly gives TS2532 "Object is possibly 'undefined'" even when the regex group is mandatory. Fix: use `match[N] ?? fallback` (e.g. `match[1] ?? '0'`) or destructure with a default. This affects any regex `.matchAll()` loop in strict mode. ref: server/src/modules/intent/references.ts:163

2026-06-22 — `run.repo.severity.test.ts` has 9 pre-existing `TS18048: 'result' is possibly 'undefined'` errors in `pnpm typecheck` output. They are NOT introduced by contract edits — they predate the intent-layer branch. Do not treat them as a blocker when verifying T2 or other tasks. ref: server/src/modules/reviews/repository/run.repo.severity.test.ts:88

2026-06-18 — `POST /settings/test-connection` with provider `anthropic` calls `llm.listModels()` → `GET https://api.anthropic.com/v1/models`. If a student tests their key with `curl .../v1/messages` and it works, but test-connection returns "Invalid response body... Premature close", the issue is a network/VPN/ISP block on the `/v1/models` endpoint specifically — not an invalid key. Fix: reproduce with `curl https://api.anthropic.com/v1/models -H "x-api-key: KEY" -H "anthropic-version: 2023-06-01"` to confirm, then disable VPN or switch to mobile hotspot. ref: server/src/modules/settings/routes.ts:92

2026-06-22 — `classifyIntent` in `classifier.ts` ALWAYS renders the PR title and `## Changed files` block (paths + hunk headers) regardless of whether body/issue/references are present. The body, issue, and references sections are conditional (rendered only when non-empty). T4/T6 callers do not need to guard for sparse input — the function handles R9 graceful degradation internally. ref: server/src/modules/intent/classifier.ts:58

2026-06-22 — `wrapUntrusted` must be imported from `../../platform/prompt.js` (the server-side re-export shim), NOT directly from `@devdigest/reviewer-core`. Importing from reviewer-core directly works in tests but breaks the module resolution chain in production because the server's tsconfig path alias for `@devdigest/reviewer-core` points to `reviewer-core/src/index.ts`, which re-exports it — but platform/prompt.ts is the established convention in this codebase. ref: server/src/platform/prompt.ts:1

2026-06-22 — `Intent` from `@devdigest/shared` is both a Zod schema object (value) and a TypeScript type (via `z.infer`). `import { Intent } from '@devdigest/shared'` imports the schema object (needed for `completeStructured({ schema: Intent })`). `type Intent` is accessed as `import('@devdigest/shared').Intent` in type positions. Do NOT import as `import type { Intent }` when passing as a value to `completeStructured`. ref: server/src/modules/intent/classifier.ts:17

2026-06-22 — `IntentService` exposes three public methods: `getOrCompute` (returns stored intent without LLM if `repo.getIntent` resolves), `recompute` (always calls the LLM + upserts), and `computeForRun` (accepts a pre-loaded `UnifiedDiff` so T6 avoids double diff-loading; returns raw `Intent` not `PrIntentRecord`). The `compute` private method is the single orchestration path shared by all three. ref: server/src/modules/intent/service.ts:44

2026-06-22 — Application-layer services (e.g. `IntentService`, `ConventionsService`) have no per-request logger — the container exposes no logger getter. Only `RunLogger` exists as a per-run logger (constructed in `run-executor.ts`). Services that accept an optional `Logger` (classifier, references) should receive `undefined` unless the caller is in a run context and can pass a `RunLogger`. ref: server/src/modules/intent/service.ts:29

## Session Notes

2026-06-22 — T6 (intent-layer plan): wired intent compute-once + inject into `run-executor.ts`. Key discoveries: `RunLogger.info(msg, data?)` takes message-first (not pino-style obj-first); `RunLogger` has no `warn` — use `info` for non-fatal advisory messages. `intentBlock` threaded as an optional parameter to `runOneAgent` (cleaner than instance field for a stateless per-run value). Zero new typecheck errors beyond 9 pre-existing baseline; all 106 hermetic unit tests pass. Files: server/src/modules/reviews/run-executor.ts.

2026-06-22 — T5 (intent-layer plan): created `server/src/modules/intent/routes.ts` (thin Fastify plugin — GET lazy-compute, POST recompute with rate-limit) and registered it in `server/src/modules/index.ts` as `intent`. One import + one key added; nothing else in index.ts touched. Zero new typecheck errors beyond 9 pre-existing baseline; all 106 hermetic unit tests pass. Files: server/src/modules/intent/routes.ts, server/src/modules/index.ts.

2026-06-22 — T4 (intent-layer plan): created `server/src/modules/intent/service.ts` — `IntentService` with `getOrCompute`/`recompute`/`computeForRun`. Zero new typecheck errors beyond 9 pre-existing baseline; all 106 hermetic unit tests pass. Files: server/src/modules/intent/service.ts.

2026-06-22 — T3 (intent-layer plan): created `server/src/modules/intent/classifier.ts` — pure application helper that builds a header-only LLM prompt, calls `llm.completeStructured` with the `Intent` schema, and logs token-savings metrics. Zero new typecheck errors beyond the 9 pre-existing baseline. Files: server/src/modules/intent/classifier.ts.

2026-06-22 — T11 (intent-layer plan): created `server/src/modules/intent/references.ts` — pure parser + async resolver for repo-file, github, and url reference kinds. TypeScript required null-coalescing on all regex capture groups (`match[N] ?? fallback`) to satisfy TS2532/TS2345 strict checks; zero new typecheck errors introduced beyond the 9 pre-existing baseline errors. Files: server/src/modules/intent/references.ts.

2026-06-22 — T2 (intent-layer plan): flipped `review_intent` defaultProvider/defaultModel to `openrouter`/`deepseek/deepseek-v4-flash` in both shared contract and client mirror. Edit tool introduced curly-quote corruption requiring byte-level Python fix. Pre-existing `run.repo.severity.test.ts` typecheck errors confirmed not caused by this change. Files: server/src/vendor/shared/contracts/platform.ts, client/src/lib/utils/featureModels.ts.

2026-06-22 — T10 (intent-layer plan): extracted `safeFetchSkillUrl` from skills/routes.ts into `WebFetchAdapter` + `WebFetchClient` port. Added `EXTERNAL_FETCH_ENABLED` boolean to config (mirrors `EMBEDDINGS_ENABLED` pattern). All 17 hermetic tests pass; 9 pre-existing typecheck errors in run.repo.severity.test.ts remain (not introduced here). Files: server/src/adapters/http/web-fetch.ts, server/src/vendor/shared/adapters.ts, server/src/platform/container.ts, server/src/adapters/mocks.ts, server/src/platform/config.ts, server/src/modules/skills/routes.ts.

2026-06-20 — Created `onion-architecture` skill (8 rule files) to formally document the layered architecture already present in the codebase. Key discovery: the project is already ~80% Onion-compliant but has no documents enforcing it. Files: .claude/skills/onion-architecture/SKILL.md, rules/layers.md, rules/dependency-rule.md, rules/di-container.md.

2026-06-18 — Added `findings_critical/warning/suggestion` to `RunSummary`: second query in `listRunsForPull` via `findings → reviews JOIN`, grouped by `(runId, severity)`. No migration needed — `findings.severity` column already existed. Files: server/src/modules/reviews/repository/run.repo.ts, server/src/vendor/shared/contracts/trace.ts.

2026-06-17 — COST column showed '–' for PRs with a trailing errored run → replaced `selectDistinctOn` with `sql\`sum\`` + `groupBy`. Root cause: DISTINCT ON returns the newest row even when its cost is null. Files: server/src/modules/pulls/routes.ts.

2026-06-17 — Run Cost Badge: added `last_run_cost_usd` to PR list response. Used `selectDistinctOn` subquery to get most recent agent run cost per PR in a single query (no N+1). No migration needed — `agent_runs.cost_usd` column already existed in the schema. Files: server/src/modules/pulls/routes.ts, server/src/vendor/shared/contracts/platform.ts.

## Open Questions

2026-06-22 — Smart/curly apostrophes (U+2019) inside single-quoted TS string literals in `platform.ts` cause "Invalid character" TS1127 parse errors that block typecheck across all packages. The T2 implementer's session note (line 48) confirms this happened during that session too. Pattern to watch: any time `platform.ts` is edited with an AI tool that autocorrects punctuation, inspect the raw bytes before committing. ref: server/src/vendor/shared/contracts/platform.ts:54
