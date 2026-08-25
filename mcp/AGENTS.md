# AGENTS.md — `mcp/` (`@devdigest/mcp`)

Local **stdio** MCP server exposing DevDigest review to MCP clients (Claude Code first,
Claude Desktop second). Five tools. Reaches DevDigest **over HTTP to the API on :3001** —
it does not import server services and never touches Postgres.

**This package uses `npm`, not pnpm.** Every command runs from inside `mcp/`.
Done condition for any change here: `npm run typecheck && npm test`.

- Architecture and the reasoning behind every decision: [`specs/mcp-server.md`](specs/mcp-server.md)
- How to bring it up and operate it: [`README.md`](README.md)
- What is actually enforced: [`test/rings.test.ts`](test/rings.test.ts)

---

## The seven non-negotiables

### 1. The ring model — and it is enforced, not advised

Paths relative to `mcp/src/`. Outer may import inner; **inner may never import outer.**

```
  M5  composition root  │ server.ts (buildServer) · index.ts (stdio, process)
  M4  driving adapters  │ tools/*.ts · tools/_register.ts
  M3  driven adapter    │ api/client.ts · api/routes.ts · api/errors.ts
  M2  application       │ resolve/** · run/** · shaping/**
  M1  kernel            │ config.ts
  M0  contracts + ports │ schemas/** · ports.ts
```

| Ring | MAY import | MUST NOT import |
|---|---|---|
| **M0** `schemas/**`, `ports.ts` | `zod`, each other, `import type` from `@devdigest/shared` | everything else — the SDK, `fetch`, node builtins, any other ring |
| **M1** `config.ts` | `zod`, M0 | the SDK, `fetch`, M2–M5. **The only file that may read the environment** |
| **M2** `resolve/**`, `run/**`, `shaping/**` | M0, `import type` from `@devdigest/shared` | the SDK, `fetch`, M3 (depend on **`ApiPort`**, never `ApiClient`), the environment, M4, M5 |
| **M3** `api/**` | M0, M1 types, `import type` from `@devdigest/shared` | the SDK, `tools/**`, M2, M5. The **only** ring where `fetch` and a URL literal may appear |
| **M4** `tools/**` | M0, M2, `@modelcontextprotocol/sdk` | `fetch`, any URL literal, `api/client.ts`, the environment |
| **M5** `server.ts`, `index.ts` | everything | nothing. `index.ts` alone may touch the transport or the process |

Plus: no ring reaches sideways (`resolve/` does not import `run/`; `shaping/` imports neither),
and no cycles. `test/rings.test.ts` pins all of it — **94 assertions**. If your change fails it,
the change is wrong, not the test.

**`onion-architecture` applies here as scoped by [`specs/mcp-server.md`](specs/mcp-server.md).**
`fastify-best-practices`, `drizzle-orm-patterns` and `postgresql-table-design` **never** apply —
there is no HTTP server here and no database ring. The spec's "what does not transfer" table
says why for each.

### 2. Nothing writes to stdout

**stdio IS the transport.** One stray `console.log` corrupts the JSON-RPC frame stream and the
server dies with an unhelpful parse error on the client side. Every diagnostic goes to
`console.error`. Enforced by `rings.test.ts`.

### 3. `@devdigest/shared` is type-only, and the zod minor is deliberately different

Every import of `@devdigest/shared` under `src/**` is `import type`. The tsconfig alias points at
`../server/src/vendor/shared/index.ts` and pins `zod` to this package's own copy.

`mcp/` runs `zod@^3.25` while `server/` stays on `^3.24.1`, because the MCP SDK declares
`zod: ^3.25 || ^4.0` as both a dependency and a peer dependency. Both typecheck because **nothing
crosses the boundary at runtime**. Do not "align" them, and do not migrate anything to zod v4.

### 4. MCP output schemas are narrow projections, never domain contracts

`ReviewRecord` carries `run_id`, `agent_id`, `grounding`, `created_at`, `accepted_at`,
`dismissed_at` — fields no model needs and every one of them a token. Every `inputSchema`,
`outputSchema` and response parser is a narrow projection under `src/schemas/**`, written against
this package's own zod. This is a deliberate divergence from the server's "contracts are domain
types" rule; the source of truth is still `@devdigest/shared` and nothing is re-derived from it.

### 5. Idempotency is in-flight only — a repeat review is not free

The key is `(pull_id, agent_id)` and it matches **only a run that is still `running`**. Two
branches, `attach` or `start`, and there is no third. A `done`, `failed` or `cancelled` run is
**never** reused, whatever commit it ran against — so calling `run_agent_on_pr` again on an
unchanged commit runs a fresh, fully-billed review.

That is an accepted cost, not a bug to fix in passing. Do not add a `reuse` branch, a
completed-run cache, or a head-sha comparison: nothing records which commit a finished run
reviewed, so any such branch could only guess. The spec records what changing it would take.

### 6. `get_blast_radius` is a deliberate stub

It is registered, it makes **no** HTTP call, and it returns `isError: true` with
`{implemented: false, retry: false, reason, use_instead}`. Wiring it to `repo-intel` is the
course exercise — doing it here removes the exercise. A successful "empty" result was rejected
on purpose: it invites the model to state the blast radius is empty, which is a worse failure
than a visible one.

### 7. This package is never wired into the app's startup

`scripts/dev.sh`, `docker-compose.yml` and `.claude/launch.json` do not mention `mcp/` and must
not start to. An MCP client spawns this server itself, over stdio, and owns its lifetime — it has
no port, so `.claude/launch.json` cannot even express it. **If a task asks you to add this package
to any of those, report BLOCKED** and point at `README.md`'s "not part of `./scripts/dev.sh`"
section.

The dependency runs the other way: the server talks HTTP to the API, so the API must be up before
any *tool call* succeeds — but the server itself starts fine without it and fails per call.

---

## Two traps that have already cost time

- **`rings.test.ts`'s string scans are single `it()` blocks that throw on the first offending
  file.** A doc comment containing the literal `http://` or the environment-variable accessor
  counts as a violation even when it is explaining why the thing is banned. Describe the rule
  without spelling the token — `instructions.ts`, `index.ts` and `server.ts` all had to.
- **The frozen model-facing strings are byte-asserted.** `instructions` is 557 bytes and the five
  descriptions are 298 / 780 / 874 / 352 / 983 (`list_agents` / `run_agent_on_pr` /
  `get_findings` / `get_conventions` / `get_blast_radius`). They are approved copy: a "small clarification"
  fails the build rather than being silently absorbed. `instructions` is a *function* of the API
  base URL for the ring reason above, and its rendered default must stay byte-identical.

## Testing

**One lane.** `npm test` — hermetic, no Docker, no API, no keys, no network. There is no
`.it.test.ts` split here because there is no database ring; the spec derives that rather than
exempting it. `Deps` interfaces are the mock seam: pass an object literal implementing `ApiPort`,
never a global `fetch` stub and never a cast. `api/**` is the one ring where a `fetch` stub is the
right tool, because it is the adapter under test.
