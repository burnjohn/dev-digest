# `@devdigest/mcp` — local stdio MCP server

Five tools, one process, one purpose: give an MCP client (Claude Code, Claude
Desktop, or any other MCP-speaking client) programmatic access to DevDigest's
AI pull-request review — list the configured reviewer agents, run one on a
PR, read its findings back later, read a repo's extracted coding
conventions, and a not-yet-wired blast-radius stub. It talks plain HTTP to
`@devdigest/api` (`server/`, port `3001`) as its only integration — it opens
no database connection and runs no HTTP server of its own. The whole surface
is stdio in, stdio out.

Two facts govern everything else in this document:

- **It does NOT start with the app.** Neither `./scripts/dev.sh` nor
  `docker-compose.yml` knows this package exists — see §2.
- **It needs the DevDigest API at `:3001`, but only at call time**, never at
  startup — see §6.

## 1. Prerequisites

- **Node ≥ 22** (verified against `24.19.0`).
- **npm — not pnpm.** `mcp/` is a standalone package, the same as
  `reviewer-core/` and `e2e/`; every command below runs from inside `mcp/`.
- **Docker**, for the Postgres container the API needs (§3.1). This package
  itself never touches Postgres.
- **An MCP client** that can spawn a local stdio server (Claude Code, Claude
  Desktop, …).

## 2. This server is not part of `./scripts/dev.sh` — and that is deliberate

`./scripts/dev.sh` starts Postgres, the API (`:3001`) and the web client
(`:3000`), and nothing else. `docker-compose.yml` runs Postgres only. Neither
file mentions `mcp/`. `.claude/launch.json` structurally cannot express this
server either — every entry there requires a `port`, and stdio has none.
There is no "add a port" fix; the shape itself does not fit a process that
talks over pipes, not a socket.

The positive version: **your MCP client spawns this process on demand and
owns its whole lifetime.** You never run `npm start` yourself except to
debug (§3.6, §8) — the client starts the process when it connects to the
server and kills it when it disconnects or the session ends.

## 3. Bring-up from a clean clone

### 3.1 Stack

```sh
./scripts/dev.sh --no-client   # Postgres + the API on :3001; runs pnpm db:migrate for you
```

Migrations are **not** applied on boot (`server/INSIGHTS.md`, 2026-08-09
seed) — `--no-client` is what actually runs `pnpm db:migrate`, so a fresh
clone that "can't find any repos" almost always needs this step, not a code
change.

### 3.2 Install

```sh
cd mcp && npm install
```

### 3.3 Typecheck + test

```sh
npm run typecheck && npm test
```

210 tests before this task, one hermetic lane — no Docker, no network, no
keys (§10).

### 3.4 Register the server

Two equivalent paths to the same result — pick one. **Neither has run yet
in this checkout**: `.mcp.json` at the repo root is parent-session work
(plan `05-mcp-server.md` §7.P2), created after every implementer task lands.
If it is missing, use path (b) or create (a) by hand from what is below.

**(a) `.mcp.json` at the repo root** (committed, project-scoped):

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "node",
      "args": ["mcp/node_modules/tsx/dist/cli.mjs", "mcp/src/index.ts"],
      "env": { "DEVDIGEST_API_URL": "http://localhost:3001" },
      "timeout": 120000
    }
  }
}
```

**Why `timeout` is there, and why it is not a bug fix.** It is Claude Code's
per-server *tool-call* wall-clock cap, in milliseconds, and it is set here
purely so it can never fall below `DEVDIGEST_MCP_RUN_BUDGET_MS` (default
`90000`). Nothing truncates the wait today without it — an unset
`MCP_TOOL_TIMEOUT` defaults to roughly 28 hours, a stdio server has no
per-request timer at all, and the stdio idle timeout is 30 minutes — so this
is a pin against a *future* raised budget, not a repair of a current one.
Three properties of the field worth knowing before you touch the number:

- A value below `1000` is **ignored** and falls through to `MCP_TOOL_TIMEOUT`.
  There is no way to ask for a sub-second cap here.
- A value of `1000` or more also acts as a **floor on the idle timeout**, so
  it can only ever extend how long a call is allowed to sit quiet, never
  shorten it.
- Progress notifications do **not** extend it. It is wall clock.

**The invariant: keep `timeout` > `DEVDIGEST_MCP_RUN_BUDGET_MS`.** Invert
that and the client kills the call before the budget fires, which is exactly
the failure `run_agent_on_pr`'s `{status:"running"}` fallback exists to
prevent — see risk R5 in the table in §5.

**This is the launch command that actually works, run from the repo root**
— verified directly, not assumed: `node mcp/node_modules/tsx/dist/cli.mjs
mcp/src/index.ts` exits `0` with `0` bytes on stdout and `0` bytes on stderr
on an idle run, and completes a clean two-frame protocol round trip under
§8's C1 check below. It is recorded here because it was *proven*, not
because it was the plan's first guess (plan `05-mcp-server.md` §9, risk R2)
— if a future `tsx` upgrade changes its CLI entry path, re-run C1 and correct
this file, not just `.mcp.json`.

**It is cwd-sensitive.** The paths above are written relative to the repo
root because that is where an MCP client sets `cwd` for a project-scoped
server. Run the *identical string* from inside `mcp/` instead of the repo
root and it fails cleanly:

```
Error: Cannot find module '...\DevDigest\mcp\mcp\node_modules\tsx\dist\cli.mjs'
```

**The doubled `mcp\mcp` segment is the tell.** It means the process launched
with the wrong working directory, not that the install is broken — fix the
`cwd`, not the paths.

**The `npm --prefix` fallback is struck, not just unneeded.** A form like
`"command": "npm", "args": ["--silent", "--prefix", "./mcp", "run", "start"]`
was considered and rejected: npm can write to stdout, and stdout **is** the
transport for a stdio server — one non-protocol byte from `command` corrupts
every JSON-RPC frame after it. Do not fall back to it, even if the `node` +
`tsx` form above ever stops working; re-verify the `tsx` CLI path instead.

**(b) `claude mcp add`**, if you would rather generate the entry than
hand-edit JSON:

```sh
claude mcp add --scope project --env DEVDIGEST_API_URL=http://localhost:3001 devdigest \
  -- node mcp/node_modules/tsx/dist/cli.mjs mcp/src/index.ts
```

`--scope project` is what writes to the committed `.mcp.json` rather than
your private, per-machine config — the same file (a) hand-edits, so the two
paths converge on one file.

`claude mcp add` has **no flag for `timeout`**, so an entry generated this
way lands without one. Add `"timeout": 120000` to it by hand afterwards, for
the reason (a) spells out.

### 3.5 Restart the client

An MCP registration does not take effect mid-session — restart your client
(Claude Code, etc.) from the repo root after (a) or (b). Expect a one-time
**approval prompt** for a new project-scoped server the first time this
happens; that prompt is normal and not a sign anything is broken.

### 3.6 Verify the handshake

Run C1–C3 from §8's numbered walkthrough, in that order — each catches
something the previous one structurally cannot (§8 explains why).

To poke individual tools by hand instead — a form per tool, or a one-line
shell call — see §3.7.

### 3.7 Driving the tools by hand — the MCP Inspector

`@modelcontextprotocol/inspector` is already a devDependency (`2.3.0`), so
nothing needs installing beyond §3.2. It ships three clients — `--web`
(the launcher's default), `--cli` and `--tui`. Each one **is** an MCP
client: it spawns its own copy of this server over stdio and owns that
process's lifetime, exactly like Claude Code does.

**Every command in this section runs from inside `mcp/`, not the repo
root** — the inverse of §3.4, where the paths are repo-root-relative
because that is where a client sets `cwd` for a project-scoped server. Same
cwd sensitivity, opposite direction.

**Web UI** — a form per tool, response rendered:

```sh
cd mcp && npm run inspect
```

Opens a browser: Connect → Tools → List Tools (expect all five) → pick one,
fill in arguments, Run.

**CLI** — one call, one JSON blob, no browser:

```sh
cd mcp && node_modules/.bin/mcp-inspector --cli node node_modules/tsx/dist/cli.mjs src/index.ts --method tools/list
```

```sh
cd mcp && node_modules/.bin/mcp-inspector --cli node node_modules/tsx/dist/cli.mjs src/index.ts --method tools/call --tool-name list_agents
```

Arguments are `key=value` pairs — **not** a JSON string — and numbers coerce
correctly:

```sh
cd mcp && node_modules/.bin/mcp-inspector --cli node node_modules/tsx/dist/cli.mjs src/index.ts --method tools/call --tool-name get_findings --tool-arg repo=owner/name pr=42
```

There is no need to hand-roll a `call.mjs` harness for this; `--cli` is that
harness, and it speaks the real protocol rather than an approximation of it.

**Why `npm run inspect` does not contradict the struck `npm --prefix` form
(§3.4).** The rule is narrower than "never launch through npm": nothing may
write to the stdout that *is* the transport. In §3.4 npm would **be** the
process the MCP client spawns, so every byte it prints lands in the JSON-RPC
frame stream. Here npm's stdout belongs to your terminal — the inspector
spawns `node … tsx src/index.ts` itself, and *that* pipe never sees npm at
all.

Two traps, both of which bite on first use:

- **Do not run `node node_modules/.bin/mcp-inspector`.** That path is an sh
  wrapper, and Node dies on it with `SyntaxError: missing ) after argument
  list` — which reads like a broken install and is not one. Invoke it
  without `node` (as above), or go direct to
  `node node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js`.
- **`isError: true` is a process-level failure to the CLI.** It appends
  `{"error":{"code":"tool_is_error",…}}` and exits non-zero. That is the
  expected outcome for `get_blast_radius` (§4's deliberate stub) and for any
  "repo is not imported" answer — a correct tool result, reported as a
  failing command.

**This does not replace C1 (§8).** The Inspector is a real client, so it
hides raw stdout exactly like Claude Code does; C1's piped frames remain the
only check in this document that can see a stray non-protocol byte. Use C1
to prove the byte stream, the Inspector to exercise the tools.

## 4. The five tools

| Tool | Arguments | Returns | What it's for |
|---|---|---|---|
| `list_agents` | *(none)* | `{agents: [{id, name, model, enabled}]}` | The id source — call first to get a valid `agent` value for `run_agent_on_pr`; agent ids are uuids and cannot be guessed. |
| `get_conventions` | `repo` | `{conventions: [{rule, status}]}` | The house rules DevDigest extracted from a repo's code. Read-only — reviews nothing, starts no run. |
| `get_findings` | `repo`, `pr`, `agent?`, `response_format?`, `severity?`, `file?`, `all_runs?` | `{agents[{agent_name, run_id, created_at, reviewed, verdict, score, counts, findings[]}], counts, shown, total, note?}` | Re-read a review's findings at zero model cost, grouped by agent — or by RUN with `all_runs:true`. **Never starts a review.** |
| `run_agent_on_pr` | `repo`, `pr`, `agent`, `response_format?` | Same shape as `get_findings`, **or** `{run_id, status:"running", poll_with:"get_findings"}` if the wait budget (default 90s) expires first | The one write tool. See the call-out below before you call it twice. |
| `get_blast_radius` | `repo`, `pr` | `isError: true`, `{implemented:false, retry:false, reason, use_instead}` | A registered placeholder. See the call-out below. |

Every argument is a flat primitive — `repo` is always `"owner/name"`, `pr` is
always the pull request number. Findings are capped at 20 per call, most
severe first; `response_format:"detailed"` adds each finding's rationale,
suggested fix and confidence — `concise` (the default) omits that free text
on purpose, since it is LLM-authored and about to be read by another model.

### `get_blast_radius` is a deliberate stub, not a bug

It makes **no HTTP call** and holds no API client at all. Calling it always
returns `isError: true` with a message that opens "Not implemented" —
**never** a successful empty result. That asymmetry is intentional (decision
D8 in `specs/mcp-server.md`): a successful-but-empty result invites a model
to state *"the blast radius is empty"* as a fact, which is a worse failure
than a visibly failed call. Do not "fix" this by wiring it up to return
`{}` on success — wiring the underlying `repo-intel` service in at all is
future work, not a bug in this tool.

### A repeat `run_agent_on_pr` is not free

`run_agent_on_pr` is idempotent **only for a run that is still in flight.**
Call it twice, back to back, for the same `repo` + `pr` + `agent` while the
first call is still running, and the second attaches to the same run and
returns the **same** `run_id` — no second review starts, no second bill.

But once that run has **finished**, calling `run_agent_on_pr` again — even
seconds later, even if the PR's commit has not changed — starts a **brand
new, fully-billed review.** Nothing in DevDigest today records which commit
a finished run reviewed, so there is no way to detect "this would be a
repeat" after the fact. This is a traded-away cost (decision D-H), not an
oversight: the alternative was an additive `head_sha` column and a
migration, and the owner chose to keep this package free of schema changes
instead.

**`get_findings` is the free re-read path.** It returns the last persisted
review for a PR at zero model cost and never starts anything — reach for it
before calling `run_agent_on_pr` again on a PR you've already reviewed.

**It shows one run per agent by default — the latest.** Every group names the
`run_id` and `created_at` it came from, so which run you are looking at is
always on the response rather than implied. Pass `all_runs:true` to get one
group per stored run instead, e.g. to compare a re-review against the run
before it. One number moves when you do: a finding that survived several runs
is counted once per run, so `total` grows without anything new being found.

## 5. Configuration

All four variables below are read and validated in exactly **one** file,
`mcp/src/config.ts` — no other file under `mcp/src/` touches `process.env`
(`mcp/test/rings.test.ts` enforces this by scanning every source file).

| Var | Default | Where you set it | Effect of a bad value |
|---|---|---|---|
| `DEVDIGEST_API_URL` | `http://localhost:3001` | `.mcp.json`'s `env` block (wins over the shell — see below), or the shell your MCP client itself runs in | A non-loopback host **without** the opt-out below → **the process exits at startup**, before the transport ever connects (`ConfigError` thrown inside `loadConfig`). |
| `DEVDIGEST_WEB_UI_URL` | `http://localhost:3000` | the shell (see below — `.mcp.json`'s `env` block does **not** set this one) | Same startup failure if non-loopback and not opted out; otherwise only changes the web-UI address embedded in a couple of error messages (`repo not imported`, `agent disabled`). |
| `DEVDIGEST_MCP_RUN_BUDGET_MS` | `90000` | the shell | Set it *too high* and your MCP **client's own** tool-call timeout kills the call before this budget ever fires — `run_agent_on_pr` never gets the chance to return its own `{status:"running"}` fallback (plan `05-mcp-server.md` §9, risk R5). **The remedy is in `.mcp.json`, not here:** raise that server entry's `timeout` (§3.4a) to stay above whatever you set this to. |
| `DEVDIGEST_MCP_ALLOW_REMOTE` | unset | the shell | `=1` disables the loopback guard for **both** URLs above. Only set it if you actually intend to point this local agent at a non-local DevDigest instance — a mis-set value here silently removes the guard, it does not add one. |

**The non-obvious consequence of `.mcp.json`'s shape.** Its `env` block
(§3.4a) sets only `DEVDIGEST_API_URL`. A client-spawned process normally
inherits your whole shell environment, but `.mcp.json`'s `env` entries
**override** the shell for the keys they name. In practice:

- To change the API address, **edit `.mcp.json`.** Exporting
  `DEVDIGEST_API_URL` in your shell before launching the client has no
  effect — `.mcp.json` wins.
- The other three variables are **absent** from `.mcp.json`'s `env` block,
  so they DO reach the server from whatever shell your MCP client was itself
  launched from. Export them there.

Readers burn real time on this asymmetry: one file, two different rules,
depending on which variable you're touching.

## 6. When something does not work

Symptom-first — find the row that matches what you actually see before you
start guessing.

| Symptom | Cause | Fix |
|---|---|---|
| Client connected, tools listed, but a **call** fails with `DevDigest API is not answering at `http://localhost:3001`. Start it with `cd server && pnpm dev`, then retry.` | The API is down. **The MCP server itself is fine** — it never probes the API at startup; failure lands per-call, not at connect time. | `cd server && pnpm dev` (or `./scripts/dev.sh --no-client`), then retry the same call. No client restart needed. |
| Client reports the server **failed to start** | Two unrelated causes land here: (1) wrong `cwd` — the doubled `mcp\mcp` tell, §3.4; or (2) a rejected config value — a non-loopback `DEVDIGEST_API_URL`/`DEVDIGEST_WEB_UI_URL` without `DEVDIGEST_MCP_ALLOW_REMOTE=1` throws in `loadConfig` before the transport exists. | Read **stderr**, not stdout — every diagnostic here goes to stderr on purpose (stdout is the protocol). The message tells you which of the two it is. |
| Client connected, tools listed, but the **model** never calls one | Not a bring-up problem — nothing is broken. With tool search on, the model only reaches for a tool it has searched for; it will not call one unprompted just because it exists. | Ask by name — "use `list_agents`", "run the security agent on PR 42". |

**Turning the server off without touching `.mcp.json`.** `.mcp.json` is
committed, so editing or emptying it to "temporarily" disable the server
shows up in `git status` and reads like an intended change for everyone. Add
this to `.claude/settings.local.json` instead (untracked, per-clone,
already gitignored in this repo):

```json
{ "disabledMcpjsonServers": ["devdigest"] }
```

then restart your client. **Do not** comment out or empty `.mcp.json` itself
to achieve the same thing.

## 7. Startup token cost

```
deferred_startup_tokens = 149 (measured 2026-08-23, cd mcp && npm run measure)
```

That is what a session actually pays. With Claude Code's tool search on,
what loads at session start is the server name, each of the five tools'
bare **name**, and the server `instructions` string (557 UTF-8 bytes) —
every tool's `description` and `inputSchema`/`outputSchema` stay deferred
until the model searches for that specific tool. (`defer_loading` in
`.claude.json` is a documented no-op — GitHub issue #26844, closed
not-planned; the lever that actually controls this is the server-author flag
`alwaysLoad`, which this server never sets.)

`npm run measure` (`mcp/scripts/measure-startup-tokens.ts`) also prints
`full_schema_tokens` — the counterfactual size **if `alwaysLoad` were set**:
every tool's name, title, description and both schemas, loaded
unconditionally at every session start whether or not the model ever
searches for this server:

```
full_schema_tokens = 1511 (measured 2026-08-23, cd mcp && npm run measure)
```

`full_schema_tokens` runs roughly **10×** `deferred_startup_tokens`. That
gap is the whole argument for tool search and deferred loading — and it is
why this server must never set `alwaysLoad`.

**The tokenizer caveat, stated in full, not as a footnote.** `cl100k_base`
is an OpenAI tokenizer, not Claude's. Both numbers above are an exact,
reproducible proxy for tracking **drift** — whether a future `instructions`
rewrite or a sixth tool grows what this server loads — and must never be
read as, or compared against, an actual Anthropic token count or a Claude
context budget.

`mcp/test/startup-cost.test.ts` pins `deferred_startup_tokens` under a
committed ceiling (175 — the measured 149 plus roughly 15% headroom), so a
future `instructions` rewrite that quietly grows this number fails CI
instead of taxing every session it ever loads into, forever.

## 8. End-to-end verification walkthrough

Each step names what you should see. Steps 1–2 need no MCP client at all —
run them first if you want to prove the plumbing before touching Claude
Code.

1. **Bring up the stack.**

   ```sh
   ./scripts/dev.sh --no-client
   ```

   Expect: Postgres up, `pnpm db:migrate` runs (migrations are **not**
   applied on boot), then the API listening on `:3001`.

2. **C1 — raw protocol, no client, no live API.** From the **repo root**,
   pipe three JSON-RPC frames — `initialize`, `notifications/initialized`,
   `tools/list` — into the server over stdin:

   ```sh
   node mcp/node_modules/tsx/dist/cli.mjs mcp/src/index.ts < frames.jsonl
   ```

   Expect **exactly two** JSON-RPC response frames on stdout: the
   `initialize` result (carrying the 557-byte `instructions` string) and the
   `tools/list` result naming all five tools. **Any non-JSON byte on stdout
   is the bug** — this is the only check in this whole walkthrough that can
   see stdout directly; a GUI client hides it entirely.

   **Verified behaviour, recorded here because it is non-obvious:** the
   process reads stdin to EOF and **exits on its own — no Ctrl-C needed**
   (observed: exit `0`, `0` stderr bytes, ~0.6s wall time end to end,
   ~10 KB of JSON on stdout). A live client instead holds the pipe open for
   the whole session; the quick, unprompted exit is specific to a one-shot
   piped check like this one, not a sign a real connection would drop.

3. **C2 — the client sees it.** Register the server (§3.4) and restart your
   MCP client from the repo root. Approve the first-run prompt (§3.5 —
   expected, not a failure). Run `/mcp` (Claude Code) and expect `devdigest`
   listed as connected, with five tools.

4. **C3 — one real call, with the API up.** Ask the model to call
   `list_agents` (or invoke it manually if your client supports that).
   Expect the seeded reviewer agents back. **C1 and C2 both pass even with
   the API down — only C3 proves the HTTP leg actually works.**

5. **The API-down case, on purpose.** Ctrl-C the API process from step 1,
   then ask for `list_agents` again. Expect exactly:

   > DevDigest API is not answering at `http://localhost:3001`. Start it
   > with `cd server && pnpm dev`, then retry.

   Restart the API (`cd server && pnpm dev`), call `list_agents` again with
   **no client restart** — it succeeds. The MCP server connection itself
   never dropped; only the one HTTP call failed and recovered.

6. **D-H, while in flight — confirming the design, not hunting a bug.** With
   the API up, start a review:

   ```
   run_agent_on_pr(repo="owner/name", pr=<n>, agent=<id from list_agents>)
   ```

   While it is still running, call it **again** with the identical `repo`,
   `pr` and `agent`. Expect the **same** `run_id` — it attached to the
   in-flight run instead of starting a second one. Cross-check independently
   of the tool's own answer (reading only the tool's response only proves
   self-consistency):

   ```sh
   curl -s http://localhost:3001/pulls/<pull_id>/runs/active
   ```

   Expect exactly **one** entry for that agent, not two.

7. **D-H, after it finished — the accepted cost.** Once the run from step 6
   has finished, call `run_agent_on_pr` again with the same three arguments.
   Expect a **different** `run_id` this time — a finished run is never
   reused, whatever commit it reviewed. This is D-H's traded-away cost,
   confirmed on purpose: `get_findings(repo, pr)` is the free re-read path
   for exactly this case, and it needs no client restart either.

8. **The stub.** Call `get_blast_radius(repo, pr)`. Expect `isError: true`
   and a message that opens "Not implemented" — never a successful empty
   result — and confirm your client does not silently retry it (`retry:
   false` is in the structured content precisely so it doesn't).

9. **The published number matches reality.**

   ```sh
   cd mcp && npm run measure
   ```

   Expect `deferred_startup_tokens` to match the number published in §7
   above. If it does not, **this README is stale, not the measurement** —
   re-run, update §7, and check whether `startup-cost.test.ts`'s ceiling
   still holds.

## 9. Architecture in one paragraph

`mcp/` is a six-ring onion the same shape as `server/`'s, scaled down to
~15 source files: contracts + ports (`ports.ts`, `schemas/**`) at the
center; a `config.ts` kernel that is the **only** file allowed to read
`process.env`; an application ring (`resolve/**`, `run/**`, `shaping/**`)
that depends on the `ApiPort` **interface** and never on the concrete
adapter; exactly one driven adapter (`api/**` — the only ring where `fetch`
and a URL literal may legally appear); a driving-adapter ring (`tools/**`,
this package's `routes.ts`) that registers all five tools through one gate
(`tools/_register.ts`) enforcing the SEP-986 name charset, the 2048-byte
description budget, and flat (never nested) tool arguments; and a
composition root (`server.ts` + `index.ts`) that is the only place allowed
to name everything — and `index.ts` alone is the only file that may touch
the transport or the process. The whole import matrix is pinned by
`mcp/test/rings.test.ts` (94 assertions) rather than by a linter, the same
"checkable by grep" trade `server/`'s own `onion-architecture` skill makes
deliberately. The full ring diagram, the import matrix, and the reasoning
behind decisions like the `get_blast_radius` stub and the in-flight-only
idempotency choice live in
[`specs/mcp-server.md`](specs/mcp-server.md) — this paragraph is the map,
that document is the territory.

## 10. Testing

One lane: `npm test` (vitest), fully hermetic — no Docker, no live API, no
keys, no network call of any kind. There is no `.it.test.ts` split because
there is no database ring that would need one: nothing under `mcp/src/**`
may import `drizzle-orm` or `postgres`, and `mcp/test/rings.test.ts` turns
that absence into a grep test rather than a convention someone has to
remember. 213 tests across 10 files as of this task, including the
import-matrix guard (`rings.test.ts`) and this task's own
`startup-cost.test.ts` (§7).

```sh
cd mcp && npm run typecheck && npm test
```
