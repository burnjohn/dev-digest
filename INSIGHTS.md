# Insights — repo-wide

Non-obvious findings accumulated by past sessions in this scope. Read before non-trivial work
here. Every entry should be actionable cold: a session that reads it without any other context
should know what to do or avoid.

Append with the `engineering-insights` skill (`/engineering-insights`), never by hand — the skill
dates entries, keeps the section order, and refuses duplicates. Existing entries are append-only:
correct them with a dated note below, never by rewriting.

Entry format: `` - `YYYY-MM-DD` — finding → evidence ``

## What Works

## What Doesn't Work

- `2026-08-01` — `instanceof` cannot be trusted for ANY class constructed inside `server/src/vendor/shared/` — not just `ZodError`. Each package resolves its own copy of the dependency, so the prototype chains differ and the check silently returns false; nothing throws and no type error appears, which is why the failure surfaces only as a wrong branch being taken further downstream. Match by shape (a discriminating field, e.g. an `issues` array) instead → `server/src/app.ts:140`
- `2026-08-01` — `./scripts/dev.sh` cannot boot under pnpm 11: any `pnpm <script>` first runs a deps-status check that re-runs `pnpm install`, which hard-fails with `ERR_PNPM_IGNORED_BUILDS` (server: cpu-features, esbuild, protobufjs, ssh2; client: esbuild, sharp) and kills the script under `set -e`. `npm_config_verify_deps_before_run=false` does not disable the check, and `pnpm install --allow-build=x,y` allows nothing — it writes a `pnpm-workspace.yaml` stub containing the literal placeholder `set this to true or false` → `scripts/dev.sh:84`

## Codebase Patterns

## Tool & Library Notes

- `2026-08-01` — Matching zod version strings are NOT a defence against the dual-instance problem: `server/`, `client/`, and `reviewer-core/` each declare `zod: ^3.24.1` and each has its own lockfile, so they still resolve to distinct module copies. Do not "fix" a cross-boundary `instanceof` by aligning versions — it is already aligned → `zod@^3.24.1` in server/package.json:38
- `2026-08-01` — A skill's ```! dynamic-context block must use the same path form as its `allowed-tools` pattern: `${CLAUDE_SKILL_DIR}` expands to an absolute path, which a relative grant like `Bash(node .claude/skills/...)` does not match, so every invocation prompts for approval instead of rendering silently. Use the project-relative path in both places → `.claude/skills/engineering-insights/SKILL.md:11`
- `2026-08-01` — Those ignored build scripts are not actually needed to run the app: tsx ships its own esbuild (no `node_modules/@esbuild/*` present, yet `tsx --version` works), so the whole stack boots by calling the local binaries directly and skipping pnpm — `server/node_modules/.bin/tsx src/db/migrate.ts`, then `tsx watch src/server.ts`, then `client/node_modules/.bin/next dev` → `tsx@4.22.4`
- `2026-08-02` — `docker exec` without `-i` silently discards stdin, so a heredoc of SQL runs as an empty session and reports success — psql prints nothing and the INSERT count is missing. Always `docker exec -i devdigest-postgres psql` when piping SQL → `docker exec -i devdigest-postgres psql $DATABASE_URL`
- `2026-08-03` — chrome-devtools MCP failing every call with 'The browser is already running for ~/.cache/chrome-devtools-mcp/chrome-profile' means a stale Chrome from a previous session holds the profile lock — pkill -f 'chrome-devtools-mcp/chrome-profile' (kills only the MCP-profile Chrome, not the user's main browser), then retry → observed 2026-08-03

## Recurring Errors & Fixes

## Session Notes

### 2026-08-01

- Stack is up but API is on :3011, not :3001 — a `docker-flowise-1` container holds 3001; started with API_PORT=3011 and NEXT_PUBLIC_API_BASE=http://localhost:3011

## Open Questions
