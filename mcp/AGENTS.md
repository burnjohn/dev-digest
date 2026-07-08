# mcp/AGENTS.md

Local **stdio MCP server** — `@devdigest/mcp` (L04). A thin HTTP wrapper exposing 5 tools to MCP
clients (Claude Desktop / Claude Code) over stdio. Consumes the DevDigest REST API on `:3001` —
no DB, no LLM, no auth. Root conventions in [../AGENTS.md](../AGENTS.md).

## What it is

A standalone Node/TS process — **not** a `server/` Fastify module and **not** registered in
`server/src/modules/index.ts`. The MCP client spawns it as a subprocess; it speaks JSON-RPC over
stdin/stdout and forwards to `http://localhost:3001`.

Tools: `list_agents` · `run_agent_on_pr` (blocking, ≤120 s) · `get_findings` · `get_conventions` ·
`get_blast_radius` (live — backed by the repo-intel index via `GET /pulls/:id/blast`).

## Commands

```sh
pnpm install                                         # own lockfile — no workspace
DEVDIGEST_API_URL=http://localhost:3001 pnpm dev     # tsx src/index.ts (stdio)
pnpm typecheck                                       # tsc --noEmit
pnpm test                                            # vitest run (hermetic)
```

Prerequisite: the API must be running (`cd server && pnpm dev`) and seeded (`cd server && pnpm db:seed`)
for `get_conventions` / `get_blast_radius` to return data.

## Architecture — layers

Transport adapter: no service/repository/domain layers. Dependency direction is **outward only**.

| Layer | Files | Rule |
|---|---|---|
| Presentation | `tools/*.ts` | Zod input (ZodRawShape) + annotations + a thin handler |
| Application | `workflows/run-agent-on-pr.ts` | the only multi-step orchestration (validate → post → poll → fetch) |
| Infrastructure | `api-client.ts` | the ONLY place that calls `fetch`; never throws (returns a discriminant) |
| Pure helpers | `format.ts` | projections + pagination, side-effect free |
| Layer-neutral | `result.ts` | `errorResult`/`jsonResult`/`apiErrorResult` — imported by both tools and workflows |
| Composition root | `server.ts`, `index.ts`, `config.ts` | wire McpServer + transport; all env reads live in `config.ts` |

## Hard rules

- **stdout is sacred** — it carries the MCP protocol. NEVER `console.log` / `process.stdout.write`.
  Logs go to stderr (Pino → `pino.destination(2)`).
- **One I/O boundary** — all HTTP lives in `api-client.ts`; tools/workflows/format never call `fetch`.
- **No DB, no `@devdigest/reviewer-core`** — this package imports neither. Data flows only through the REST API.
- **Types from `@devdigest/shared`** via `import type`; never redefine a shared type. Response shapes not
  in shared (e.g. `RunSummary`) are defined **locally** in `api-client.ts` — do NOT add them to shared.
- **One env read** — `process.env` is touched only in `config.ts` (`DEVDIGEST_API_URL`, `LOG_PRETTY`).
  Neither is a secret.
- **Error-leads-forward** — handlers return `{ isError: true, content: [...] }` with an actionable
  message (via api-client's `enrichMessage`), never a thrown exception or stack trace.
- **`run_agent_on_pr` blocks** — orchestration is wrapped in `withTimeout(..., 120_000)` and polls
  `GET /pulls/:id/runs` every 2 s. Keep it in `workflows/`; keep the tool handler thin.

## SDK gotchas — `@modelcontextprotocol/sdk@1.29.0`

- Tool `inputSchema` is a **ZodRawShape** (`Record<string, ZodType>`), NOT `z.object({...})`; zero-arg tools use `{}`.
- Register via `server.registerTool(name, { description, inputSchema, annotations }, handler)` — `tool()` is deprecated.
- `CallToolResult` imports from `@modelcontextprotocol/sdk/types.js`.
- A malformed input (failed `.uuid()`) returns `isError:true` (it does NOT throw); the handler is never
  reached. Test the gate end-to-end with `InMemoryTransport.createLinkedPair()` + `Client` — calling a
  tool's `descriptor.handler` directly bypasses it.

## Testing

Hermetic Vitest — mock `api-client.ts` (`vi.mock('../src/api-client.js')`); `format.ts` is tested as
pure functions; the `run_agent_on_pr` polling/timeout uses `vi.useFakeTimers()`. SDK input-validation is
tested end-to-end through the in-memory client↔server transport. Shared fixtures live in `test/setup.ts`.

## Session Protocol

**Start of session:** Read `insights.md` and briefly summarize the entries relevant to the current task.
**End of session:** Run `/engineering-insights` to capture discoveries. Do not skip after sessions > 30 min with a real problem or decision.

## See also

- [README.md](README.md) — integration guide, Claude Desktop / Claude Code config, tool reference
- [../docs/plans/2026-06-30-mcp-server.md](../docs/plans/2026-06-30-mcp-server.md) — the development plan
- [insights.md](insights.md) — accumulated gotchas
- [../AGENTS.md](../AGENTS.md) — root conventions
