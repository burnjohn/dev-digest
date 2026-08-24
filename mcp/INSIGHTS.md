# INSIGHTS — `mcp/` (`@devdigest/mcp`)

Append-only log of non-obvious findings for the MCP server package.
Format and gates: `.claude/skills/engineering-insights`.

---

## Tool & Library Notes

### 2026-08-23 — the SDK's zod range rejects the repo's `^3.24.1`, even though it resolves fine
`@modelcontextprotocol/sdk@1.30.0` declares `zod: ^3.25 || ^4.0` as **both** a dependency and a peer
dependency, so the *range* `^3.24.1` is invalid even though npm would resolve it to a working
version. `mcp/` pins `^3.25.0` while `server/` and `reviewer-core/` stay on `^3.24.1`; the tsconfig
`zod` path pin plus type-only `@devdigest/shared` imports keep them independent. The zod v3 line
works — do not migrate this package to v4 to "fix" it.

### 2026-08-23 — `McpServer` has no public way to read back its own tools or `instructions`
There is no `listTools()` / `getInstructions()` on the server side (only on `Client`) — verified in
the SDK's `.d.ts` and its compiled `dist/esm/server/mcp.js`. Reading them without a live transport
round trip needs a narrow cast onto the private `_registeredTools` / `_instructions` fields, which
are ordinary JS properties at runtime (`private` is TS-only). This is what
`scripts/measure-startup-tokens.ts` does.

### 2026-08-23 — testing the SDK's exception→`isError` translation needs a real round trip
The `CallToolRequestSchema` handler in `mcp.js` is what catches a thrown error and turns it into
`{isError: true}` via `createToolError(error.message)`. Calling `_registeredTools[name].handler`
directly bypasses that entirely — the raw handler *rejects* instead of returning a result. Use
`InMemoryTransport.createLinkedPair()` with a real `Client`: a genuine round trip with no sockets,
no real timers, and compatible with an injected virtual clock.

### 2026-08-23 — a thrown `ApiError`'s message reaches the model verbatim
`createToolError(error instanceof Error ? error.message : String(error))` means whatever
`api/errors.ts` writes **is** what the model sees — no `Error:` prefix, no SDK wrapping. So the
actionable first sentence in each catalogue message is load-bearing, and `api/errors.ts` is
effectively model-facing copy.

### 2026-08-23 — `AbortSignal.timeout()` rejects with `TimeoutError`, not `AbortError`
A `fetch` aborted by `AbortSignal.timeout(ms)` throws a `DOMException` named `TimeoutError`; only a
manual `AbortController.abort()` produces `AbortError`. Error-translation code distinguishing "the
server is down" from "the request timed out" must check both names — see
`api/errors.ts::fromFetchFailure`.

---

## Codebase Patterns

### 2026-08-23 — `rings.test.ts`'s string scans are single `it()` blocks that die on the first hit
The URL-literal and environment-accessor checks iterate every file under `src/**` inside one `it()`,
so they short-circuit on the first offender in directory order — and they scan **comments too**. A
doc comment explaining *why* a token is banned counts as a violation. `instructions.ts`, `index.ts`
and `server.ts` each had to be reworded to describe the rule without spelling the literal token.

### 2026-08-23 — a banned literal that a spec requires is threaded as a parameter, not exempted
The frozen `instructions` string and several error messages must contain a URL, which the M0/M2 ring
rule forbids. The established fix is to make the value config and pass it in: `webUiUrl` into
`resolve/messages.ts`, and `buildInstructions(apiBaseUrl)` instead of a constant. The rendered
default stays byte-identical, so approved copy is unchanged — and a non-default
`DEVDIGEST_API_URL` now produces instructions that tell the truth. Exempting the ring instead would
have invited a third exemption next time.

### 2026-08-23 — an optional field on a `Deps` interface is a silent-degradation vector
`ResolverDeps.webUiUrl` was made optional to avoid breaking a concurrent task's construction sites.
Result: `run_agent_on_pr`'s flattened `Deps` had no such field at all, so the composition root could
not populate it, everything typechecked, every test passed, and users on the most likely error path
silently got the weaker message. Only a **composition-root** test asserting a *sentinel* value
(`http://example.test`, never the real default) catches this — a unit test of the consumer passes
either way, and asserting the default passes even when the wiring is broken.

### 2026-08-23 — `agent_runs` records no ORIGIN, so an unexplained run cannot be pinned on a caller
A run started from the studio UI and one started through `run_agent_on_pr` both land via
`POST /pulls/:id/review` with `source: 'local'` — nothing distinguishes them. A run appearing
while an MCP session is open is therefore NOT evidence that a tool started it; check
`readOnlyHint`/the tool's call graph before blaming it, and diff `select count(*) from agent_runs`
around a single call if you need proof.

### 2026-08-23 — a per-PR read that merges per-agent rows will misattribute the verdict
`GET /pulls/:id/reviews` returns one review PER AGENT, so any projection that flattens them must
not take scalar fields off `reviews[0]`: `get_findings` served five CRITICAL findings from the API
Contract Reviewer under the Performance Reviewer's `approve`/100. Group per agent and let
`verdict`/`score` exist only inside a group — `projectFindings` (one run in, one run out) is the
only caller for which the flat shape is correct.

---

## What Doesn't Work

### 2026-08-23 — ordering the items inside groups is not enough; the GROUPS need a total order too
`order.ts` guarantees a byte-identical response, but a grouped projection reintroduces
non-determinism one level up: the groups came out in whatever order the API listed the reviews.
Only the shuffle test caught it (`projectFindingsByAgent` … "orders identically however the
reviews are shuffled") — sort groups with a comparator that ends on a unique key like `agent_id`.

### 2026-08-23 — a string comparison for "is this file the entry point" silently fails on Windows
The ESM equivalent of `require.main === module` must be
`pathToFileURL(process.argv[1]).href === import.meta.url`. A hand-rolled
`` `file://${process.argv[1]}` `` never matches on Windows — `import.meta.url` is
`file:///C:/...` (triple slash, forward slashes) while `argv[1]` is `C:\...`. The guarded code just
never runs, with no error.

### 2026-08-23 — the `npm --prefix` launch form is unsafe and was struck from the docs
stdout **is** the transport, and npm writes to it. The verified form is
`node mcp/node_modules/tsx/dist/cli.mjs mcp/src/index.ts` **from the repo root** — exit 0, 0 bytes
stdout, 0 bytes stderr, exits on stdin EOF. It is cwd-sensitive: run from inside `mcp/` it fails
with a doubled `mcp\mcp` path segment, which is the diagnostic tell.

### 2026-08-23 — npm 11 leaves esbuild's postinstall unrun, and that is not a problem
`npm install` reports that esbuild's install script was gated by `allow-scripts`. esbuild ships its
platform binary as an optional dependency, so `tsx` and `vitest` both work anyway. Confirm with
`npx vitest run --passWithNoTests` and `npx tsx -e "console.log('ok')"` rather than reaching for
`npm approve-scripts`. The `npm audit` critical is `vitest <3.2.6`, inherited from the repo-wide
`^2.1.8` pin — not something this package introduced.

---

## Session Notes

### 2026-08-23 — the ring model held across five parallel authors; file ownership is what leaked
Five implementers built this package concurrently with no communication, coordinating only through
the ring model and `rings.test.ts`. **Not one import-matrix cell was breached.** But an architecture
review still found four placement violations — application logic in `tools/`, shaping in `tools/`,
value schemas declared outside `schemas/**` — because `Owned paths` partitioned by *task* while the
ring that owned the code belonged to a *different* task in a *different* wave. `rings.test.ts` scans
import specifiers, so it structurally cannot see a placement violation. **When a wave is partitioned
by file ownership, the ring boundary and the ownership boundary must coincide, or the ring loses
every tie.**

### 2026-08-23 — a task's owned paths must include the tests that assert on its interface
Two integration breaks this session came from the same omission: a task owned a source file but not
the test file whose fixtures assert that file's shape (`ApiPort` gaining `listRepos`; `McpConfig`
gaining `webUiUrl` against a `toEqual` fixture). The owner then cannot run its own done condition
green, and correctly refuses to fix a file it does not own. Include the asserting test files in the
same task.
