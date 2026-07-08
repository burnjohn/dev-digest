# Development Plan: Local MCP Server for DevDigest

**Date:** 2026-06-30
**Status:** Ready for implementation
**Scope:** New top-level package `mcp/` — standalone stdio process
**Affects modules:**

- `mcp/` (new) — the entire MCP server lives here
- `server/`, `client/`, `reviewer-core/`, DB schema — **no changes** (read-only consumer of the existing REST API)
- `server/src/vendor/shared/` — **read-only** dependency via tsconfig path alias (types reused, never redefined)

---

## 1. Context

A local MCP (Model Context Protocol) server is a thin HTTP proxy that exposes five tools to Claude Desktop and Claude Code over **stdio**. It runs as a subprocess spawned by the MCP client, communicates exclusively over stdio using the official `@modelcontextprotocol/sdk` (v1.29.0), and wraps the existing DevDigest Fastify REST API at `http://localhost:3001`.

It touches no database directly, imports nothing from `@devdigest/reviewer-core`, and adds no routes to the Fastify server. The package lives at `mcp/` as a first-class peer of `server/`, `client/`, and `reviewer-core/`.

The five tools and their verified endpoint mappings:

| Tool | Endpoint(s) | Handler reference |
| --- | --- | --- |
| `list_agents` | `GET /agents` | `server/src/modules/agents/routes.ts:74` |
| `run_agent_on_pr` | `GET /repos/:id/pulls` (validate) → `POST /pulls/:id/review` → poll `GET /pulls/:id/runs` → `GET /pulls/:id/reviews` | `pulls/routes.ts:26`, `reviews/routes.ts:34`, `:108`, `:136` |
| `get_findings` | `GET /pulls/:id/reviews` | `reviews/routes.ts:136` |
| `get_conventions` | `GET /repos/:id/conventions` | `conventions/routes.ts:46` |
| `get_blast_radius` | `GET /pulls/:id/brief` (stub) | `reviews/routes.ts:150` |

---

## 2. Architecture Fit

```text
Claude Desktop / Claude Code
        │  stdio (JSON-RPC 2.0)
        ▼
  mcp/src/index.ts          ← McpServer + StdioServerTransport (entry point)
        │
  mcp/src/server.ts         ← registers all 5 tools via server.tool(...)
        │
  mcp/src/tools/*.ts        ← PRESENTATION: thin handlers (Zod + annotations + format)
        │
  mcp/src/workflows/*.ts    ← APPLICATION: multi-step orchestration (run_agent_on_pr only)
        │
  mcp/src/api-client.ts     ← INFRASTRUCTURE: fetch wrapper (withTimeout/withRetry + error → MCP)
        │
  mcp/src/format.ts         ← concise projection helpers + pagination
        │
  mcp/src/config.ts         ← reads DEVDIGEST_API_URL (plain env var, not a secret)
        │  http
        ▼
  http://localhost:3001      ← existing Fastify server (UNMODIFIED)
```

This is a separate OS process, not a Fastify plugin. It is never registered in `server/src/modules/index.ts`. The only shared artifact it consumes is `@devdigest/shared` (response types), resolved at compile time via a tsconfig path alias — no publishing or npm link needed.

**Onion architecture note.** The `backend-onion-architecture` skill governs `server/` modules; an MCP stdio server is a **transport adapter**, not a domain module, so it intentionally has **no** service/repository/domain layers — all business logic lives across the HTTP boundary inside `server/`. We still honor onion's core principles:

- **Dependency direction is outward only:** `tools → api-client → HTTP`. Handlers never know about DB, Drizzle, or the server `container`.
- **Single I/O boundary:** all network I/O is confined to `api-client.ts`; `format.ts` and every tool handler are pure, side-effect-free transforms.
- **No reach into another package's internals:** no imports from `server/src/` or `reviewer-core/` — only `@devdigest/shared` types.

**Onion audit (skill `backend-onion-architecture`, 2026-06-30).** The design passes the Dependency Rule, R4 (env read confined to the `config.ts` composition root; `DEVDIGEST_API_URL` is not a secret), R5 (shared read-only), R6 (import isolation), AP-2 (raw `fetch` confined to `api-client.ts`), and AP-5 (errors centralized via `enrichMessage`/`errorResult`). One finding (AP-1, *business logic in the presentation boundary*): `run_agent_on_pr` carries genuine multi-step orchestration (validate → post → poll → fetch → assemble). Per the audit, that orchestration is extracted into an **application layer** (`mcp/src/workflows/run-agent-on-pr.ts`); the tool handler stays thin. The other four tools are trivial (one api-client call + projection) and do **not** get a workflow layer — consistent with the skill's rule "do not add Onion layers pre-emptively."

Layer mapping (MCP ↔ onion):

| Onion layer | MCP file(s) | Responsibility |
| --- | --- | --- |
| Presentation | `tools/*.ts` | Zod input schema, annotations, thin handler, error → `CallToolResult` |
| Application | `workflows/run-agent-on-pr.ts` | the only non-trivial orchestration (validate/post/poll/fetch) |
| Infrastructure (I/O boundary) | `api-client.ts` | all HTTP; never throws; returns a discriminant |
| Pure helpers | `format.ts` | projections + pagination, side-effect free |
| Layer-neutral utils | `result.ts` | `errorResult`/`jsonResult`/`apiErrorResult` — imported by both tools and workflows (sits outside the layer boundary so neither direction is violated) |
| Composition root | `index.ts`, `server.ts`, `config.ts` | wire McpServer + transport + logger; all env reads (`DEVDIGEST_API_URL`, `LOG_PRETTY`) live in `config.ts` |

---

## 3. Skills & Patterns Applied

**TypeScript Expert (mandatory):**

- `"type": "module"`; `moduleResolution: "Bundler"`, `module: "ESNext"`, `strict: true`, `noUncheckedIndexedAccess: true` — mirror `server/tsconfig.json`.
- Path alias `"@devdigest/shared": ["../server/src/vendor/shared/index.ts"]` — the only alias; **no** alias for `@devdigest/reviewer-core` (forbidden import).
- Run via `tsx` (no build step in dev). `import type` for all types consumed from `@devdigest/shared`.

**Zod (mandatory):**

- Every tool's input schema is a Zod object passed directly to `server.tool()` — SDK v1.29.0 supports Zod schemas; `zod-to-json-schema` is **not** needed.
- `z.string().uuid().describe("…")` on all UUID args; keep `.describe()` strings short (token economy).
- `z.safeParse()` at API response parse boundaries — never `z.parse()` in a handler.

**Security (mandatory):**

- `DEVDIGEST_API_URL` is not a secret; it is the **one** permitted `process.env` read (in `config.ts`). No secrets/credentials/tokens anywhere.
- Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) set explicitly per tool.
- **Logs to stderr only** — `process.stdout` is reserved for MCP stdio framing; any `console.log`/`process.stdout.write` corrupts the protocol.

---

## 4. Project Constraints

- **C1 — Shared types are read-only via alias.** `server/src/vendor/shared/` is never modified; never redefine a type that exists in shared. Response shapes not exported from shared (e.g. `RunSummary`) are defined **locally in `mcp/`**, not added to shared.
- **C2 — No `@devdigest/reviewer-core`.** Not in `mcp/tsconfig.json` paths, not in `mcp/package.json` deps.
- **C3 — No DB access.** No `drizzle-orm`, no `postgres` driver, no schema import. All data via `http://localhost:3001`.
- **C4 — Logs to stderr only.** Use `console.error` or Pino configured to fd 2.
- **C5 — `withTimeout` wraps the 120s polling loop** in `run_agent_on_pr`. Copy `withTimeout`/`withRetry` verbatim from `server/src/platform/resilience.ts` into `mcp/src/platform/resilience.ts` — do **not** import from `server/` (process-isolated).
- **C6 — Error-leads-forward, never stack traces.** Every caught error returns `{ isError: true, content: [{ type: "text", text: "<actionable message>" }] }`.
- **C7 — No monorepo workspace.** `pnpm install` runs inside `mcp/` separately; cross-package code flows through tsconfig path aliases.
- **C8 — No global mutable per-session state.** Module-level constants only: config (read once), schema instances, logger.

---

## 5. Implementation Steps

### Step 1 — Bootstrap the `mcp/` package skeleton

**Dependencies:** none
**Owned paths:** `mcp/package.json`, `mcp/tsconfig.json`, `mcp/.env.example`, `mcp/README.md`

- `mcp/package.json`: `"@devdigest/mcp"`, `private`, `"type": "module"`, `"main": "src/index.ts"`. Scripts: `dev` (`tsx src/index.ts`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`). Deps: `@modelcontextprotocol/sdk@^1.29.0`, `zod@^3.24.1`, `pino@^9`. DevDeps: `tsx`, `typescript@^5.7`, `vitest@^2`, `@types/node@^22`.
- `mcp/tsconfig.json`: settings from §3; `paths` with `@devdigest/shared` only (NO reviewer-core).
- `mcp/.env.example`: `DEVDIGEST_API_URL=http://localhost:3001`.
- `mcp/README.md`: package description, stdio note, env var docs, the 5 tool names.

**Verify:** valid JSON; tsconfig has only the shared alias; no reviewer-core in deps.
**Commit:** `chore(mcp): bootstrap package skeleton with tsconfig and README`

### Step 2 — `config.ts` + local `resilience.ts`

**Dependencies:** Step 1
**Owned paths:** `mcp/src/config.ts`, `mcp/src/platform/resilience.ts`

- `config.ts`: `apiUrl: process.env['DEVDIGEST_API_URL'] ?? 'http://localhost:3001'` (only env read in the package); export inferred `Config` type.
- `resilience.ts`: copy `withTimeout`, `withRetry`, `TimeoutError`, `RetryOptions` verbatim from `server/src/platform/resilience.ts`; no cross-package import.

**Verify:** typecheck passes; no secret reads; no cross-package imports.
**Commit:** `feat(mcp): add config and resilience primitives`

### Step 3 — `api-client.ts` HTTP wrapper

**Dependencies:** Step 2
**Owned paths:** `mcp/src/api-client.ts`

- `apiFetch<T>(path, options?)`: full URL = `config.apiUrl + path`; `withRetry(() => withTimeout(fetch(...), 10_000), { retries: 2 })`. **Never throws** — returns a discriminant `{ ok: true; data: T } | { ok: false; code: string; message: string }`. Non-2xx → parse `ApiErrorBody` with `safeParse`; network failure → `code: 'network_error'`.
- Exported functions: `fetchAgents()`, `fetchRepoPulls(repoId)`, `postReview(prId, agentId)`, `fetchRuns(prId)`, `fetchReviews(prId)`, `fetchConventions(repoId)`, `fetchBrief(prId)`.
- **`RunSummary` (local type — verified against `server/src/modules/reviews/repository/run.repo.ts:77`).** The `GET /pulls/:id/runs` rows have these fields (note: the run id key is **`run_id`**, and there is **no `verdict`** field — verdict lives on the review, not the run):

  ```ts
  type RunSummary = {
    run_id: string;
    agent_id: string;
    agent_name: string | null;
    provider: string;
    model: string;
    status: string;          // poll until 'done' | 'error'
    error: string | null;
    duration_ms: number | null;
    tokens_in: number | null;
    tokens_out: number | null;
    findings_count: number | null;
    grounding: unknown;
    ran_at: string | null;
    score: number | null;
    blockers: unknown;
    cost_usd: number | null;
    findings_breakdown: { critical: number; warning: number; suggestion: number } | null;
  };
  ```

- `enrichMessage(code, message)` — actionable hints: `not_found`+"agent" → `"; call list_agents to see valid agent IDs"`; `not_found`+"PR/pull" → `"; verify the pr_id is correct"`; `not_found`+"repo" → `"; verify the repo_id is correct"`; `validation_error` → `"; check that all UUID arguments are valid v4 UUIDs"`; network → `"DevDigest API is unreachable at <config.apiUrl>; ensure the server is running"`.

**Verify:** typecheck clean; no import from `server/src/` (only `@devdigest/shared`); all error-body parsing uses `safeParse`.
**Commit:** `feat(mcp): add api-client with fetch + error enrichment`

### Step 4 — `format.ts` projections and pagination

**Dependencies:** Step 3
**Owned paths:** `mcp/src/format.ts`

Pure functions (no I/O). The review param type is `ReviewRecord` from `@devdigest/shared` (confirmed in Step 3 — `fetchReviews` returns `ReviewRecord[]`; the server-internal `ReviewDto` is not the shared type). `projectAgent`/`projectConvention` take `Agent`/`Convention` from shared.

- `projectAgent(agent)` → `{ id, name, description, provider, model, enabled }` (drops system_prompt, output_schema, version, strategy, ci_fail_on, repo_intel).
- `projectConvention(c)` → `{ rule, category, status, evidence_path }`. **Filter by `status`** (`accepted`/`verified`) at the call site — the conventions table uses a `status` enum, **not** a boolean `accepted` flag (confirm exact enum values in `server/src/db/schema/knowledge.ts` during this step).
- `projectBlast(brief)` → `brief === null` ⇒ `{ available: false, reason: "blast radius computed in a later lesson" }`; else `{ available: true, summary, changed_symbols_count, downstream_count, top_downstream: first 5 }`.
- `paginateFindings(reviews, limit=20 /*max 50*/)` → flatten + sort by severity (CRITICAL → WARNING → SUGGESTION); `{ items, has_more, total }`.
- `conciseReviewSummary(reviews)` → per-review `{ agent_name, verdict, score, findings_breakdown }` — **no finding bodies**. **`ReviewRecord` has no `findings_breakdown` field (confirmed Step 4)** → compute it by counting `review.findings` by severity (`CRITICAL`/`WARNING`/`SUGGESTION`). `verdict` ∈ `request_changes|approve|comment|null`; `agent_name` is nullish.
- `detailedReviewSummary(reviews, limit)` → concise shape + `top_findings` per review, paginated.

**Verify:** strict TS passes; `paginateFindings` enforces max 50; `projectBlast(null)` returns the `available:false` shape.
**Commit:** `feat(mcp): add format helpers for concise projections and pagination`

### Step 5 — Five tool handler files

**Dependencies:** Steps 3, 4
**Owned paths:** `mcp/src/tools/list-agents.ts`, `run-agent-on-pr.ts`, `get-findings.ts`, `get-conventions.ts`, `get-blast-radius.ts`, `mcp/src/workflows/run-agent-on-pr.ts` (application-layer orchestration — onion audit AP-1), plus `mcp/src/result.ts` (layer-neutral `errorResult`/`jsonResult`/`apiErrorResult` — imported by both tools and workflows).

Each handler returns `CallToolResult` and follows error-leads-forward (`if (!result.ok) return errorResult(enrich(result))`).

**`list_agents`** — input `z.object({})`; annotations `{ readOnlyHint: true, idempotentHint: true }`. Handler: `fetchAgents()` → map `projectAgent` → JSON text.

**`run_agent_on_pr`** — input:
```ts
z.object({
  repo_id:  z.string().uuid().describe("Repo UUID — used to validate the PR belongs to this repo"),
  pr_id:    z.string().uuid().describe("PR UUID to review"),
  agent_id: z.string().uuid().describe("Agent UUID from list_agents"),
})
```
Annotations `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false }`. The tool handler is **thin** (presentation): parse args → call `runAgentOnPr(args)` in `mcp/src/workflows/run-agent-on-pr.ts` → return its `CallToolResult`. The **workflow function** (application layer) performs the orchestration, all inside `withTimeout(..., 120_000)`:
1. **Validate repo↔PR:** `fetchRepoPulls(repo_id)`; assert `pr_id` matches some `pull.id` in the returned `PrMeta[]`. **Note: `PrMeta.id` is `string | null | undefined` (nullish)** — the membership check must guard against nullish ids (`pulls.some(p => p.id === pr_id)`). If not present → `errorResult("PR <pr_id> does not belong to repo <repo_id>; verify the identifiers")`.
2. `postReview(pr_id, agent_id)`; on error → `errorResult(enriched)`. Extract `run_id` from first `runs[]` entry; empty ⇒ `errorResult("No run was created — the agent may be disabled or a review may already be running")`.
3. Poll `fetchRuns(pr_id)` every 2s; find the row where `run.run_id === run_id`; exit when `status` is `done`|`error`.
4. On `TimeoutError` → `errorResult("Review timed out after 120s. It may still be running — call get_findings(pr_id) later.")`.
5. Fetch `fetchReviews(pr_id)`, match by `run_id`, and return `{ run_id, status, verdict, score, findings_breakdown, top_findings: ≤10 }` (verdict + finding bodies come from the review record, not the run summary).

**`get_findings`** — input:
```ts
z.object({
  pr_id: z.string().uuid().describe("PR UUID"),
  response_format: z.enum(["concise","detailed"]).default("concise")
    .describe("concise=per-agent summary; detailed=adds finding bodies"),
  limit: z.number().int().min(1).max(50).default(20).describe("Max findings in detailed mode"),
})
```
Annotations `{ readOnlyHint: true, idempotentHint: true }`. Handler: `fetchReviews(pr_id)` → concise ⇒ `conciseReviewSummary`; detailed ⇒ `detailedReviewSummary(reviews, limit)`.

**`get_conventions`** — input `z.object({ repo_id: z.string().uuid() })`; annotations `{ readOnlyHint: true, idempotentHint: true }`. Handler: `fetchConventions(repo_id)` → filter `status ∈ {accepted, verified}` → `projectConvention` → JSON text.

**`get_blast_radius`** — input `z.object({ pr_id: z.string().uuid() })`; annotations `{ readOnlyHint: true, idempotentHint: true }`. Handler: `fetchBrief(pr_id)` → `projectBlast` → JSON text. Never fabricates.

**Tool descriptions (registered in Step 6 — final wording):**

- **list_agents:** *Lists the review agents configured in this DevDigest workspace. Use it first to obtain a valid `agent_id` before calling `run_agent_on_pr`. Returns each agent's id, name, description, provider, model and enabled flag; disabled agents are included so you can see the full configuration. Read-only — it never starts a review.*
- **run_agent_on_pr:** *Runs one review agent on a pull request and blocks until the review finishes (up to 120 seconds), then returns the completed result. Call `list_agents` first for a valid `agent_id`. Use this to PRODUCE a new review; to read an existing one without re-running, use `get_findings` instead. Returns the run status, verdict, score, findings breakdown and the top findings.*
- **get_findings:** *Returns reviews already completed for a pull request, without starting a new run. Use this when a review has run and you only need its verdict; use `run_agent_on_pr` to create a new one. Concise mode (default) returns a per-agent verdict, score and findings breakdown; detailed mode adds the finding bodies, paginated. Read-only.*
- **get_conventions:** *Returns the coding conventions extracted for a repository — evidence-backed rules mined from the codebase. Only accepted/verified conventions are returned; pending and rejected candidates are omitted. Use this to learn a repo's house style before reasoning about a review. Read-only; takes a `repo_id`.*
- **get_blast_radius:** *Returns the blast radius of a pull request: which symbols changed, what downstream code depends on them, and which endpoints are affected. It is currently backed by pre-computed seed data only; for live PRs without it the tool returns `available:false` and never fabricates an answer. Use `get_findings` for verdicts and this tool only for impact mapping. Read-only; takes a `pr_id`.*

**Verify:** all five compile; no import from `server/`/`reviewer-core/`; `run_agent_on_pr` wrapped in `withTimeout(120_000)` and performs repo↔PR validation; `get_blast_radius` never fabricates; every error path returns `isError:true`.
**Commit:** `feat(mcp): implement all five MCP tool handlers`

### Step 6 — `server.ts` + `index.ts`

**Dependencies:** Step 5
**Owned paths:** `mcp/src/server.ts`, `mcp/src/index.ts`

- `server.ts`: `createDevDigestMcpServer()` → `new McpServer({ name: "devdigest", version: "1.0.0" })`; register tools in order list_agents, run_agent_on_pr, get_findings, get_conventions, get_blast_radius with the descriptions and annotations above.
- `index.ts`: import `StdioServerTransport`; create Pino logger to fd 2; `main()` → `server.connect(new StdioServerTransport())`; handle SIGINT/SIGTERM → `server.close()` + exit. No `console.log` anywhere.

**Verify:** typecheck passes; no stdout writes; `server.connect()` is the last call in `main()`.
**Commit:** `feat(mcp): wire McpServer and StdioServerTransport in index.ts`

### Step 7 — Unit tests

**Dependencies:** Steps 4, 5
**Owned paths:** `mcp/test/setup.ts`, `mcp/vitest.config.ts`, `mcp/test/format.test.ts`, `mcp/test/tools/*.test.ts`

- Mock `api-client.ts` via `vi.mock`. `vitest.config.ts` aliases `@devdigest/shared` to the shared source (mirrors tsconfig).
- `format.test.ts`: `projectAgent` strips fields; `projectBlast(null)` ⇒ available:false; `paginateFindings` limit/has_more; `conciseReviewSummary` omits bodies.
- Tool tests: list_agents (happy + network error); run_agent_on_pr (completes after 2 polls / 120s timeout via `vi.useFakeTimers()` / empty runs / **PR-not-in-repo validation failure**); get_findings (concise / detailed pagination / empty); get_conventions (filters non-accepted + repo-not-found hint); get_blast_radius (null brief / seeded brief / API error).

**Verify:** `pnpm test` green; no test imports from `server/src/`; timeout test uses fake timers.
**Commit:** `test(mcp): add hermetic unit tests for all five tools and format helpers`

### Step 8 — Integration config & docs

**Dependencies:** Step 6
**Owned paths:** `mcp/README.md` (update), `mcp/.claude/mcp.json.example`

- README quick-start; `claude_desktop_config.json` snippet (`command: "tsx", args: ["<abs>/mcp/src/index.ts"], env: { DEVDIGEST_API_URL }`); Claude Code `.mcp.json` block; tool reference table; prerequisite (API on :3001, `pnpm db:seed` for blast/conventions data); stderr-only logging note.

**Verify:** README describes stdio (no HTTP/auth); examples use `tsx`; example config has no hardcoded absolute paths.
**Commit:** `docs(mcp): add integration guide and client config examples`

---

## 6. Acceptance Criteria

- [ ] `cd mcp && pnpm typecheck` exits 0.
- [ ] `cd mcp && pnpm test` exits 0.
- [ ] `DEVDIGEST_API_URL=http://localhost:3001 tsx mcp/src/index.ts` produces nothing on stdout; emits a startup log on stderr.
- [ ] Claude Desktop/Code can invoke `list_agents` and receive seeded agents.
- [ ] `run_agent_on_pr` validates the PR belongs to `repo_id`, then returns a completed run result (or a timeout message) within 120s.
- [ ] `run_agent_on_pr` with a PR not belonging to `repo_id` returns `isError:true` with the membership message.
- [ ] `get_findings` concise omits finding bodies; detailed includes them with `has_more`.
- [ ] `get_conventions` returns only accepted/verified conventions.
- [ ] `get_blast_radius` returns `{ available:false, reason }` for a live PR; blast data for a seeded PR.
- [x] Invalid UUID to any tool → `isError:true` with an actionable message (no stack trace). **Confirmed:** the SDK `registerTool` Zod gate returns `isError:true` with a message naming the tool + field (`pr_id` / `Invalid uuid`); the handler is never reached and it does NOT throw. Verified end-to-end via `test/server.validation.test.ts` (in-memory client↔server).
- [ ] No file in `mcp/` imports from `server/src/` (only `@devdigest/shared` via alias).

---

## 7. Testing Plan

This package has no DB, no Fastify server, no LLM. The only external boundary is `api-client.ts`, which is mocked; `format.ts` functions are tested as pure functions.

| Test | File | Type | Covers |
| --- | --- | --- | --- |
| `projectAgent` strips fields | `test/format.test.ts` | pure | projection |
| `projectBlast(null)` ⇒ available:false | `test/format.test.ts` | pure | L01 stub |
| `paginateFindings` limit + has_more | `test/format.test.ts` | pure | pagination |
| `conciseReviewSummary` omits bodies | `test/format.test.ts` | pure | token economy |
| `list_agents` happy / network error | `test/tools/list-agents.test.ts` | mocked | success + error-leads-forward |
| `run_agent_on_pr` completes after 2 polls | `test/workflows/run-agent-on-pr.test.ts` | mocked + fake timers | polling loop |
| `run_agent_on_pr` 120s timeout | same | mocked + fake timers | timeout cap + retry hint |
| `run_agent_on_pr` empty runs | same | mocked | disabled-agent edge case |
| `run_agent_on_pr` PR not in repo | same | mocked | repo↔PR validation |
| `get_findings` concise / detailed | `test/tools/get-findings.test.ts` | mocked | response_format branch |
| `get_conventions` filters non-accepted | `test/tools/get-conventions.test.ts` | mocked | status filter |
| `get_blast_radius` null / seeded / error | `test/tools/get-blast-radius.test.ts` | mocked | stub + projection |
| invalid UUID → `isError` + valid UUID passes | `test/server.validation.test.ts` | integration (in-memory client↔server) | AC10 — SDK input-validation gate, end-to-end |

**Manual smoke** (requires `pnpm db:seed` + `pnpm dev` in `server/`): start the MCP server; send a raw `tools/call` for `list_agents` via stdin (confirm no stdout noise); in Claude Desktop ask for agents / run an agent on a seeded PR / get blast radius of a seeded PR; confirm all logs appear in the MCP log pane (stderr), not in the conversation.

---

## 8. Out of Scope

- Remote / Streamable-HTTP transport and any MCP-layer auth.
- Real blast-radius computation (`get_blast_radius` is a stub returning `available:false` for live PRs — real computation is a later lesson).
- SSE streaming progress for `run_agent_on_pr` (polling first; `GET /runs/:id/events` is a named future optimization).
- Any changes to `server/`, `client/`, `reviewer-core/`, `e2e/`, or DB schema/migrations.
- Finding accept/dismiss actions via MCP (not in the 5-tool spec).
- A compiled `.js` build, npm publishing, and multi-user/workspace auth (inherits whatever workspace the running DevDigest instance uses).
