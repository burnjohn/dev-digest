# Insights — repo-wide

Non-obvious findings accumulated by past sessions in this scope. Read before non-trivial work
here. Every entry should be actionable cold: a session that reads it without any other context
should know what to do or avoid.

Append with the `engineering-insights` skill (`/engineering-insights`), never by hand — the skill
dates entries, keeps the section order, and refuses duplicates. Existing entries are append-only:
correct them with a dated note below, never by rewriting.

Entry format: `` - `YYYY-MM-DD` — finding → evidence ``

## What Works

- `2026-08-05` — Cheapest proof that a mirrored edit landed identically in both vendor/shared copies: 'git diff <server-file> <client-file>' prints the same index blob hashes for both when they are in sync (7308b5f..e12b68c on both index.ts files after adding one barrel line), and 'md5 a b' plus a bare 'diff' exiting 0 confirms new files are byte-identical — no sync script exists, so this is the only guard against a half-applied mirror → used in Task 3 of per-repo-github-tokens, commit 4297f4a

## What Doesn't Work

- `2026-08-01` — `instanceof` cannot be trusted for ANY class constructed inside `server/src/vendor/shared/` — not just `ZodError`. Each package resolves its own copy of the dependency, so the prototype chains differ and the check silently returns false; nothing throws and no type error appears, which is why the failure surfaces only as a wrong branch being taken further downstream. Match by shape (a discriminating field, e.g. an `issues` array) instead → `server/src/app.ts:140`
- `2026-08-01` — `./scripts/dev.sh` cannot boot under pnpm 11: any `pnpm <script>` first runs a deps-status check that re-runs `pnpm install`, which hard-fails with `ERR_PNPM_IGNORED_BUILDS` (server: cpu-features, esbuild, protobufjs, ssh2; client: esbuild, sharp) and kills the script under `set -e`. `npm_config_verify_deps_before_run=false` does not disable the check, and `pnpm install --allow-build=x,y` allows nothing — it writes a `pnpm-workspace.yaml` stub containing the literal placeholder `set this to true or false` → `scripts/dev.sh:84`
- `2026-08-06` — Implementation briefs that ASSERT what existing code contains: 6 of 6 such assertions were wrong in one 12-task plan — Icon.Key does not exist (only Lock), the CSS vars are --warn/--warn-bg not --success/--danger, @testing-library/user-event is not installed at all, no page uses Next 15's async `params` Promise (they use useParams()), AddRepoView has no i18n, and platform.ts's Repo shape had to be diffed across both vendor/shared copies. The plan's architecture survived review; only its claims about current code failed → name the file for the implementer to read instead of describing its contents, docs/superpowers/plans/2026-08-05-per-repo-github-tokens.md, observed 2026-08-06

## Codebase Patterns

- `2026-08-05` — client/src/vendor/shared is a hand-maintained COPY, not a symlink — a new shared contract must be added to BOTH server/src/vendor/shared/contracts/ (canonical) and client/src/vendor/shared/contracts/, updating both barrels; the copies have already drifted, so never assume one edit serves both → `diff -rq server/src/vendor/shared client/src/vendor/shared` reports adapters.ts, contracts/eval-ci.ts, knowledge.ts, productionize.ts and trace.ts differing, and there is no sync script; client/CLAUDE.md's "symlinked from server" is wrong, observed 2026-08-05 ×2 (2026-08-05)
- `2026-08-05` — SecretKey is an OPEN union — `| (string & {})` at server/src/vendor/shared/adapters.ts:280-285 — so namespaced secret keys like GITHUB_TOKEN:<uuid> are already type-legal and per-entity secrets need no shared-contract edit → verified while designing per-repo GitHub tokens, docs/superpowers/specs/2026-08-05-per-repo-github-tokens-design.md
- `2026-08-05` — Adding a contract that .extend()s a base from the dual-copy vendor/shared: diff the BASE file across both copies before extending, not just after copying your new file — a drifted base yields two differently-typed contracts that both typecheck cleanly and split the contract silently, since each package resolves its own copy and neither tsc run can see the other. RepoWithToken/RepoCreate .extend() Repo/RepoInput from contracts/platform.js, and that only worked because platform.ts and index.ts happen to be byte-identical between the copies while 5 sibling files (adapters.ts, eval-ci.ts, knowledge.ts, productionize.ts, trace.ts) are drifted → verified adding contracts/github-tokens.ts in Task 3 of per-repo-github-tokens, 'diff server/src/vendor/shared/contracts/platform.ts client/src/vendor/shared/contracts/platform.ts' exits 0, commit 4297f4a
- `2026-08-08` — AGENTS.md is the canonical handbook in every scope (root, server, client, reviewer-core, e2e) and CLAUDE.md beside it is a committed relative symlink to it — chose symlink over a one-line '@AGENTS.md' import file because Claude Code loads only CLAUDE.md and the symlink keeps exactly one file to edit with no import indirection; edit AGENTS.md, never CLAUDE.md, and any new package needs both (ln -s AGENTS.md CLAUDE.md, then git add so it lands as git mode 120000). Windows clones would need Developer Mode for this and should switch to the @AGENTS.md import instead → 'git ls-files -s | grep CLAUDE.md' shows 120000 for all five; https://code.claude.com/docs/en/memory states 'Claude Code reads CLAUDE.md, not AGENTS.md' and endorses 'ln -s AGENTS.md CLAUDE.md'

## Tool & Library Notes

- `2026-08-01` — Matching zod version strings are NOT a defence against the dual-instance problem: `server/`, `client/`, and `reviewer-core/` each declare `zod: ^3.24.1` and each has its own lockfile, so they still resolve to distinct module copies. Do not "fix" a cross-boundary `instanceof` by aligning versions — it is already aligned → `zod@^3.24.1` in server/package.json:38
- `2026-08-01` — A skill's ```! dynamic-context block must use the same path form as its `allowed-tools` pattern: `${CLAUDE_SKILL_DIR}` expands to an absolute path, which a relative grant like `Bash(node .claude/skills/...)` does not match, so every invocation prompts for approval instead of rendering silently. Use the project-relative path in both places → `.claude/skills/engineering-insights/SKILL.md:11`
- `2026-08-01` — Those ignored build scripts are not actually needed to run the app: tsx ships its own esbuild (no `node_modules/@esbuild/*` present, yet `tsx --version` works), so the whole stack boots by calling the local binaries directly and skipping pnpm — `server/node_modules/.bin/tsx src/db/migrate.ts`, then `tsx watch src/server.ts`, then `client/node_modules/.bin/next dev` → `tsx@4.22.4`
- `2026-08-02` — `docker exec` without `-i` silently discards stdin, so a heredoc of SQL runs as an empty session and reports success — psql prints nothing and the INSERT count is missing. Always `docker exec -i devdigest-postgres psql` when piping SQL → `docker exec -i devdigest-postgres psql $DATABASE_URL`
- `2026-08-03` — chrome-devtools MCP failing every call with 'The browser is already running for ~/.cache/chrome-devtools-mcp/chrome-profile' means a stale Chrome from a previous session holds the profile lock — pkill -f 'chrome-devtools-mcp/chrome-profile' (kills only the MCP-profile Chrome, not the user's main browser), then retry → observed 2026-08-03
- `2026-08-05` — pnpm@11.6.0 refuses to RUN a script when the project has ignored build scripts: `cd server && pnpm db:migrate` exits 1 with ERR_PNPM_IGNORED_BUILDS (esbuild, ssh2, cpu-features, protobufjs) from its pre-run deps check, before the migration is even attempted — which kills ./scripts/dev.sh at the migrate step with nothing started → bypass with `./node_modules/.bin/tsx src/db/migrate.ts`; fix permanently by filling in the allowBuilds stub pnpm auto-generates at server/pnpm-workspace.yaml, or `pnpm approve-builds`, observed 2026-08-05
- `2026-08-06` — `./scripts/e2e.sh` POISONS a concurrently-running `next dev`: NEXT_PUBLIC_* is inlined at COMPILE time and e2e compiles the client with its own `NEXT_PUBLIC_API_BASE=http://localhost:${E2E_API_PORT}` (default 3101) into the SHARED `client/.next` cache, so a dev server on another port silently starts serving chunks that point at the now-dead e2e API — the UI shows 'Cannot reach the DevDigest engine at http://localhost:3101' while curl to the real API works fine → after any e2e run, `rm -rf client/.next` and restart the dev server; scripts/e2e.sh:32,42, observed 2026-08-06

## Recurring Errors & Fixes

## Session Notes

### 2026-08-01

- Stack is up but API is on :3011, not :3001 — a `docker-flowise-1` container holds 3001; started with API_PORT=3011 and NEXT_PUBLIC_API_BASE=http://localhost:3011 ×2 (2026-08-05, and :3000 is taken by another app too — web moved to :3010, which also requires WEB_PORT=3010 on the API for CORS)

## Open Questions
