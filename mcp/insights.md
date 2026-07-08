# insights.md — mcp

> Append-only. Add new entries at the bottom of the correct section.
> Discovery bar: "Would a fresh agent save ≥10 minutes from reading this?" If not, skip.
> Format: `**YYYY-MM-DD [Category]** — actionable sentence. \`file:line\``
> See `.claude/skills/engineering-insights/` for full criteria and format rules.

## Patterns
<!-- Reusable approaches that worked in this module. -->
- **2026-07-02 [Pattern]** — When adding a new `api-client.ts` export (`fetchBlast`, etc.), update the `vi.mock` factory in EVERY test file that already mocks `api-client.js` (including `server.validation.test.ts` and any per-tool test file). A missing entry in the factory leaves that function `undefined` in test scope, causing silent call failures rather than a clear error. Grep for `vi.mock.*api-client` to find all files. `mcp/test/`

## Mistakes
<!-- Failure modes, antipatterns, wrong assumptions. Prioritize this section. -->
- **2026-06-30 [Mistake]** — The plan (Step 4) says to handle "if `brief.blast` is absent/empty" and return `available:false`. In reality, `PrBrief.blast` is a **required** field per the Zod schema in `server/src/vendor/shared/contracts/brief.ts:39` — a non-null `PrBrief` always has `blast`. The `available:false` path is only reached when `fetchBrief` returns `null` (live PRs without seed data). Do not add optional-chaining guards on `brief.blast` — the type system already guarantees its presence.  `server/src/vendor/shared/contracts/brief.ts:39`, `mcp/src/format.ts`
- **2026-06-30 [Mistake]** — `ReviewRecord` from `@devdigest/shared` has NO `findings_breakdown` field. The breakdown (`{ critical, warning, suggestion }`) must be computed by counting `r.findings` by `severity`. Only `RunSummary` (the local type in `api-client.ts`) has a `findings_breakdown` field — those are different objects. Never assume a `ReviewRecord` carries a pre-built breakdown. `server/src/vendor/shared/contracts/review-api.ts:23`, `mcp/src/format.ts`

## Decisions
<!-- Architectural or design choices with the reasoning behind them. -->
- **2026-06-30 [Decision]** — `detailedReviewSummary` distributes the global `limit` across all reviews by sorting all findings together by severity and then re-assigning them to per-review buckets. This gives CRITICAL findings priority across all agents rather than a naive per-agent `slice(0, limit)` that could fill the budget with one agent's low-priority findings before showing another agent's criticals.  `mcp/src/format.ts`

## Quirks
<!-- Dependency gotchas, env constraints, non-obvious tool or library behavior. -->
- **2026-06-30 [Quirk]** — `@modelcontextprotocol/sdk@1.29.0` tool input schema must be a **ZodRawShape** (`Record<string, ZodType>`), NOT a wrapped `z.object({...})`. The SDK type is `ZodRawShapeCompat = Record<string, AnySchema>`. Passing `z.object({...})` as inputSchema would fail. For zero-arg tools use `{}` (empty object literal). Confirmed in `dist/esm/server/zod-compat.d.ts:5` and `mcp.d.ts`. `mcp/src/tools/`
- **2026-06-30 [Quirk]** — `CallToolResult` must be imported from `@modelcontextprotocol/sdk/types.js` (the `.js` extension is required for ESM resolution even in TypeScript). The export map entry `"./*"` routes `types.js` to `dist/esm/types.js`. The `server` subpath does NOT re-export `CallToolResult`. `mcp/src/result.ts`
- **2026-06-30 [Quirk]** — In `@modelcontextprotocol/sdk@1.29.0`, `McpServer.tool()` is `@deprecated` — use `registerTool(name, { description, inputSchema, annotations }, handler)` instead. Handler functions may have fewer parameters than `ToolCallback` requires (`(args, extra) => ...`) — TypeScript accepts functions with fewer positional params (e.g. `() => Promise<CallToolResult>` is valid for a zero-arg tool). `mcp/src/server.ts`, `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.d.ts:150`
- **2026-06-30 [Quirk]** — Pino logger must write to `pino.destination(2)` (fd 2 = stderr) to avoid corrupting the stdio MCP protocol on stdout. `pino-pretty` can be used conditionally via `pino.transport({ target: 'pino-pretty', options: { destination: 2 } })` — wrap in try/catch since it may not be installed. If the try fails, fall back to `pino({}, pino.destination(2))`. `mcp/src/index.ts`
- **2026-07-01 [Quirk]** — When a `registerTool` Zod input fails (e.g. a malformed `.uuid()` arg), `@modelcontextprotocol/sdk@1.29.0` returns a normal `CallToolResult` with `isError:true` and text `MCP error -32602: Input validation error ... path:[field]`. It does NOT throw / reject `client.callTool`, and the tool handler is never invoked. To test this gate end-to-end use `InMemoryTransport.createLinkedPair()` + `Client` — calling a tool's `descriptor.handler` directly bypasses the Zod gate entirely. `mcp/test/server.validation.test.ts`
- **2026-07-01 [Quirk]** — `GET /repos/:id/pulls` is a HEAVY endpoint: it aggregates `findings_breakdown` + `cost_usd` per PR, so a repo with ~56 PRs took **10 055 ms** on a cold cache (observed in live smoke). The api-client's default 10 s per-request timeout fired first and — before the fix — the abort was misclassified as `network_error` ("API is unreachable") even though the API was healthy. Fix: `fetchRepoPulls` uses a 30 s timeout, and `TimeoutError` maps to a distinct `timeout` code ("running but busy — try again"), never "unreachable". A client-side timeout is NOT reachability failure. Also: `TimeoutError` is not retryable by `defaultIsRetryable` (no status/code), so `withRetry` makes exactly one attempt on timeout. `mcp/src/api-client.ts`

## Open Questions
<!-- Unresolved. Convert to an entry in the appropriate section when answered. -->

---
Last updated: 2026-07-02 · Entries: 10
