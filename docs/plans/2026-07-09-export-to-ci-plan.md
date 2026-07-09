# Development Plan: Export to CI (Feature B — CI Agent-Runner Pipeline, Producer + Ingest)

**Date:** 2026-07-09
**Requirements:** [docs/feature-requirements/2026-07-09-ci-agent-runner-pipeline.md](../feature-requirements/2026-07-09-ci-agent-runner-pipeline.md) (SPEC-2026-07-09-ci-agent-runner-pipeline, Status: approved, 48 ACs — AC-13 re-scoped 2026-07-09, see §1)
**Research:** [docs/plans/2026-07-09-research-export-to-ci.md](2026-07-09-research-export-to-ci.md) (R1–R7, cited throughout)
**Execution mode:** multi-agent, **hard cap 5 parallel implementers per wave**
**Model routing (/implement):** implementer subagents run on **Sonnet** (`claude-sonnet-5`); the **final Architect + Reviewer/bug-review gate** runs on **Opus** (`claude-opus-4-8`). Intermediate gates (completeness, test-coverage) default to Sonnet. Spawn each agent with the explicit `model` param — it overrides the agent-definition frontmatter.
**Scope:** full-stack (server, client)
**Affects modules:** `server/src/modules/ci/` (new), `server/src/vendor/shared/`, `server/src/adapters/`, `server/src/platform/container.ts`, `server/src/db/schema/ci.ts`, `client/src/app/agents/[id]/`, `client/src/app/ci-runs/` (new), `client/src/lib/hooks/`, `client/src/vendor/ui/nav.ts`, `client/src/vendor/shared/`

---

## 1. Context

DevDigest already ships a standalone CI-side runner (`agent-runner/`, `ncc`-bundled to `dist/index.js`) that reviews a PR using the same `reviewer-core` pipeline as the in-app path, given a checked-in agent manifest + skills. Nothing on the server composes that manifest from a real `Agent`, generates the GitHub Actions workflow that invokes it, exposes an export/wizard flow, or ingests the runner's result back into workspace history. This plan builds exactly that missing producer (agent → installed CI workflow) and ingest (CI run → workspace-visible history) — the `server/src/modules/ci/` module plus the four client surfaces (Agent Editor CI tab + Export Wizard, CI Runs page, nav entry).

Two DB tables (`ci_installations`, `ci_runs`) and the shared contracts (`server/src/vendor/shared/contracts/eval-ci.ts`) already exist but are unused (zero rows, unregistered module) — this plan wires them up, growing both **additively only**, per the spec's explicit permission (§2, AC-28, AC-45).

**v1 posture (hard user directive): keep it simple.** Every AC below is implemented with the simplest solid mechanism that reuses an existing project pattern (`blast/` module shape, `reviews/routes.ts` review-all's rate-limit+fan-out+detached-logger, `useBlast` hook shape, the already-drafted `client/messages/en/ci.json` copy, the `settings` key/value table). No speculative abstraction. Where an AC could tempt a richer solution, the richer version is named in §9 Out of Scope as a future iteration.

**Notable design decisions:**

1. **Flat `.devdigest/` layout — v1 is one agent per repository.** User decision (2026-07-09, final — supersedes an earlier per-installation-subdirectory design considered during planning, which is why this reads as a decision rather than an open question): a repository may have **at most one** DevDigest agent installed at a time. Installing a **second, different** agent to a repo that already has one is **rejected** with a clear conflict error. Installing the **same** agent to many **different** repos still works (the reference scenario: Security Reviewer → `payments-api` + `billing-worker`, two independent installations). Re-exporting the same agent to the same repo still overwrites in place (AC-5). Multi-agent-per-repo is deferred — see §9 Out of Scope. The spec's AC-13 is re-scoped accordingly (§7).

   Because at most one config file can ever exist per repo, the **flat**, mockup-matching layout is correct and simpler than any per-installation path-scoping scheme:
   - `.devdigest/agents/<slug>.yaml` — the config file
   - `.devdigest/skills/<slug>.md` — one per linked+enabled skill
   - `.devdigest/memory.jsonl` — always present, always empty content (no persistent-memory feature exists yet anywhere in this codebase; `MemoryItem` is a contract-only stub, confirmed via `grep`)
   - `.devdigest/runner/index.js` — the runner bundle
   - `.github/workflows/devdigest-review.yml` — the single generated workflow. **No `DEVDIGEST_DIR` override** — the runner's default (`.devdigest` under its working directory, `agent-runner/src/index.ts:31`) is exactly right when there is only ever one manifest per repo.

   `<slug>` is derived from the agent's name (slugified) **once, at first export**, and stored on the installation row (`ci_installations.slug` — new, additive column). It is **never re-derived** on a later agent rename — that, plus the row's own stable `id`, is what makes AC-4/AC-5's "stable configuration-file identity" hold. The one-agent-per-repo rule is enforced both at the DB level (`UNIQUE(workspace_id, repo)` on `ci_installations` — scoped by workspace, since two different workspaces may independently track the same external GitHub repo string) and, as the actual user-facing behavior, at the service layer (Step 7) — never a naive last-writer-wins upsert.

2. **Last-checked-at reuses the existing `settings` table** (key/value per workspace, `server/src/db/schema/core.ts:34`, the same table `feature-models.ts` already reads/writes) — no new column, no new table.

3. **Producer preview is a separate, no-side-effect endpoint** (`POST /repos/:repoId/agents/:agentId/ci/preview`), distinct from the persisting `POST /repos/:repoId/agents/:agentId/export-ci`. The wizard's Preview/Configure steps call the former (cheap: no DB write, no GitHub call, no runner-bundle build); the Install step calls the latter (full flow). This is what makes AC-34/35/36/38's live-preview UX possible without persisting or committing anything until the user actually clicks Install.

4. **Download-as-archive (AC-39) needs no server-side zip route.** `POST .../export-ci` with `action: "files"` already returns `CiExport.files` (the full generated `CiFile[]`, including the runner bundle) as JSON and **still records the installation** (satisfying AC-39's "both choices record the same installation"). The client zips `files` in the browser (`jszip`) and triggers the download — no new server endpoint, no server-side zip-writing.

## 2. Architecture Fit

New Fastify module `server/src/modules/ci/`, mirroring `blast/`'s 3-layer shape (`backend-onion-architecture` skill) and registered statically in `server/src/modules/index.ts`. Two new adapter capabilities, both accessed via `container`, never imported directly in services:

- **`RunnerBundler` port** (new) — `{ build(): Promise<{ contents: string }> }` — builds the `agent-runner` `ncc` bundle fresh on every export/bulk-update (R1: staleness is a correctness/security regression, not cosmetic).
- **`GitHubClient`** (existing port, additive) — 4 new methods for discovering/downloading GitHub Actions workflow runs and artifacts (ingest side only; the commit/PR methods the producer side needs already exist).

```mermaid
flowchart LR
  subgraph Client
    CITab["AgentEditor CI tab<br/>+ Export Wizard"]
    Runs["CI Runs page"]
  end
  subgraph Server["server/src/modules/ci/"]
    Routes[routes.ts]
    ExportSvc[export-service.ts]
    IngestSvc[ingest-service.ts]
    InstRepo["repository/installations.repo.ts"]
    RunsRepo["repository/runs.repo.ts"]
  end
  subgraph Container["container (DI)"]
    GH[github&#40;&#41;]
    RB[runnerBundler]
  end
  CITab -->|hooks/ci.ts| Routes
  Runs -->|hooks/ci.ts| Routes
  Routes --> ExportSvc
  Routes --> IngestSvc
  ExportSvc --> InstRepo
  ExportSvc --> GH
  ExportSvc --> RB
  IngestSvc --> RunsRepo
  IngestSvc --> InstRepo
  IngestSvc --> GH
  ExportSvc -.commits.-> GHRepo["target repo<br/>(GitHub Actions)"]
  GHRepo -.uploads artifact.-> IngestSvc
```

## 3. Skills & Patterns Applied

- **`backend-onion-architecture`** — `ci/routes.ts` (presentation) → `ci/export-service.ts` / `ci/ingest-service.ts` (application) → `ci/repository/*.repo.ts` (infrastructure), mirroring `blast/`. Adapters (`container.github()`, `container.runnerBundler`) accessed only via container, never imported concretely in services. **R5 exception, stated once here**: this module's Step 1 edits `server/src/vendor/shared/` (adapters.ts, contracts/eval-ci.ts). Root `AGENTS.md`'s framing — *"DB schema is stable — add tables via new numbered migrations only... Shared types → `server/src/vendor/shared/` only"* — permits **additive** growth of that folder; it does not forbid touching it, unlike the stricter reading in `backend-onion-architecture` SKILL.md R5 ("never touch vendor/shared"). For this feature, the root framing governs: every edit in Step 1 is additive-only (new fields, new exported schemas, new adapter methods) — nothing existing is renamed, retyped, or removed.
- **`typescript-expert`** — `z.infer`-derived types throughout new contracts; discriminated handling of the bulk-update per-installation outcome array (`ok: boolean` discriminant, not error-truthiness — see the agent-runner insights.md 2026-07-08 Mistake entry on the same anti-pattern).
- **`security`** (OWASP Top 10:2025) — see §4 below; a dedicated subsection, not an afterthought.
- **`fastify-best-practices`** — routes stay thin (validate → call service → return); `config.rateLimit` per route; Zod schemas via `fastify-type-provider-zod` for both request and response.
- **`zod`** — additive `.nullish()`/`.default()` fields on existing frozen contracts (never repurposing a field); new contracts export both schema and `z.infer` type.
- **`drizzle-orm-patterns`** / **`postgresql-table-design`** — additive migration only; `UNIQUE(workspace_id, repo)` is upsert-friendly (`ON CONFLICT (workspace_id, repo) DO UPDATE`); FK columns (`workspace_id` ×2) get explicit indexes (Postgres does not auto-index FK columns); list-valued columns follow this codebase's one existing precedent (`reviews.ts:53-54`'s `jsonb().$type<string[]>()`), not a native array type this codebase has never used.
- **`react-best-practices`** / **`next-best-practices`** / **`frontend-architecture`** — feature components co-located under `_components/<Name>/`; all server state via TanStack Query, no `useEffect` fetching; all new UI strings via `next-intl` (`ci.json`, extended additively); reuse vendored UI only (`Modal`, `ExportWizardSteps`, `FormField`, `SelectInput`, `Toggle`, `Tabs` — no new UI primitives).

## 4. Project Constraints

**Engineering principles (gate criteria — every step's output is reviewed against these; an architecture-reviewer/plan-verifier pass MUST reject a step that violates either one, not merely note it):**

- **P1 — No load-bearing workaround.** If a workaround needs a paragraph of justification to explain why it's acceptable, the code is wrong — simplify the design instead of shipping the justified hack. If an implementer finds itself writing a long comment defending a hack, that is the signal to stop and simplify, not to ship the comment. (This plan itself follows P1: e.g. the one-agent-per-repo rule in §1 replaces an earlier, more elaborate per-installation-subdirectory design that would have needed exactly this kind of justifying paragraph.)
- **P2 — Fix the generator, not the symptom.** When something goes wrong during implementation (a failing test, a type error, an awkward integration seam), fix the root cause — the design or process that generates the code — never patch the symptom in place (e.g. don't special-case a test to tolerate a wrong return shape; fix the function's return shape).

**Runtime isolation** — this worktree runs its own isolated dev runtime so it can be live alongside the sibling `../devdigest-review` worktree. Read **§5 Runtime Isolation & Merge Compatibility** before starting any server, Docker, or test command that touches a live process — do not skip it because it looks like tooling boilerplate.

**Server (apply throughout):**
- New feature = Fastify plugin in `src/modules/ci/`, onion-layered; registered **statically** in `src/modules/index.ts` (no auto-discovery).
- Every `ci/repository/*.repo.ts` query filters by `workspace_id` — no exceptions, from the first commit that creates these files.
- Adapters via `app.container` only (`container.github()`, `container.runnerBundler`) — never `import { OctokitGitHubClient }` or `new NccRunnerBundler()` inside `export-service.ts`/`ingest-service.ts`.
- Route schemas: Zod + `fastify-type-provider-zod`, one schema drives validation and TS types.
- Expected failures throw `AppError`/`NotFoundError`/`ValidationError`/`ExternalServiceError` — never raw `Error`.
- Secrets (`OPENROUTER_API_KEY`) via `container.secrets.get(...)` only — never `process.env` in `server/`. (`agent-runner/` is explicitly exempt from this rule per its own `AGENTS.md` — this plan never edits `agent-runner/src/`.)

**DB:**
- Migration `0023` (or the next actually-free number — **verify at execution time**: `ls server/src/db/migrations/` may already show `0023` claimed by the sibling `../devdigest-review` worktree (Feature A), which independently branched from the same `0022` base. If so, use `0024` and note the shift in Step 1's commit message) adds columns only — never alters `ci_installations.repo`/`target_type`/`installed_at` or any existing `ci_runs` column.
- Real migrations path is `server/src/db/migrations/` (root `AGENTS.md`'s `server/drizzle/` reference is stale — confirmed via `drizzle.config.ts`'s `out` field, R7).
- Workflow: edit `schema/ci.ts` → `pnpm db:generate` → **review the generated SQL by hand** (must contain only `ALTER TABLE ... ADD COLUMN`, `CREATE INDEX`, `CREATE UNIQUE INDEX` — no `DROP`/`ALTER COLUMN` on pre-existing columns) → `pnpm db:migrate`.
- All new NOT NULL columns are safe to add without a backfill migration — both tables have zero rows in every real deployment (spec's own stated justification for AC-28/AC-45, extended here to the additional columns this plan introduces for AC-13's `slug` + `UNIQUE(workspace_id, repo)`, AC-14, AC-19/AC-20, AC-38, AC-40, AC-43/AC-44's `agent`/`duration_s`).
- List-valued columns (`ci_installations.triggers`) use `jsonb().$type<string[]>()`, matching this codebase's one existing list-column precedent (`reviews.ts:53-54`) — this codebase has **no** native Postgres array column anywhere; do not introduce the first one here.

**reviewer-core / agent-runner (frozen, read-only for this feature):**
- `reviewer-core/src/grounding.ts` is never touched.
- `agent-runner/src/*` is never touched — this plan only *reads* its env-var contract (R4) and *builds* its `dist/index.js` via a fresh `ncc` invocation (Step 2's `RunnerBundler`). No agent-runner source file is an owned path in any step below.

**Client:**
- All API calls via `apiFetch`/`api.*` from `src/lib/api.ts`.
- Server state via TanStack Query only.
- UI strings via `next-intl` — extend `client/messages/en/ci.json` and `client/messages/en/shell.json` additively; never hardcode.
- No Shadcn/Radix — reuse `client/src/vendor/ui/` primitives (`Modal`, `ExportWizardSteps`, `FormField`, `SelectInput`, `Textarea`, `Toggle`, `Tabs`, `Button`).
- **Client `@devdigest/shared` is a separate physical copy** (`client/src/vendor/shared/`) — every Step 1 contract/adapter edit must be mirrored there in the same step, or client typecheck breaks silently later (client insights.md, 2026-06-26/2026-07-03 Quirk entries).

**Security (OWASP-mapped, concrete to this feature):**
- **A01 Broken Access Control** — every new route resolves `{workspaceId}` via `getContext(container, req)` before touching data (AC-32); `ci/repository/*.repo.ts` scopes every query by `workspace_id`; installation/run lookups 404 (not 403-leak) on cross-workspace access, matching the `blast` module's existing pattern.
- **A05 Injection / Untrusted input** — the downloaded CI result artifact (`devdigest-result.json`, produced by a build process outside DevDigest's control) is `CiResultArtifact.safeParse`'d before any field is used; on failure it is discarded, never partially trusted (AC-21). Attribution to workspace/installation comes **only** from which installation the server itself queried — never from any field inside the artifact (AC-22).
- **A04 Cryptographic/secret handling** — the `OPENROUTER_API_KEY` value is read via `container.secrets.get(...)`, returned **once** in the export response body for the user to copy, never written into any committed file (only the secret **name** appears in the generated workflow YAML, as `${{ secrets.OPENROUTER_API_KEY }}`), and never logged (`req.log` calls in `export-service.ts` must not include the secret value in any logged object) — AC-30/AC-31.
- **A06 Insecure Design (rate limiting)** — `export-ci`, `bulk-update`, and `check` are each rate-limited to 2/min **per workspace** (custom `keyGenerator`, mirroring `reviews/routes.ts`'s `brief-generate` route exactly — not the Fastify default per-IP keying), satisfying AC-15/AC-26/AC-48.
- **A06 (command execution)** — `RunnerBundler`'s `ncc` invocation uses `execFile` (never `exec`/`spawn({shell:true})`) with a fixed argument list (no interpolated user input reaches the shell) — the agent-runner path and command are server-configured constants.
- **A08 Integrity** — skill names (free-text, workspace-authored) are slugified (lowercase, non-alphanumeric runs → `-`, trimmed, collision-suffixed) before becoming file paths committed via the GitHub API — defense in depth, even though GitHub's tree API does not resolve `..` as filesystem traversal. The agent's own slug is the same `slugify()` applied once and frozen (§1 design decision #1) — no dedupe needed there (at most one agent file per repo).
- **Accepted trust boundary, not a vulnerability**: the user-edited workflow YAML (`workflow_override`, AC-36) is committed verbatim to the *target* repository the workspace member already administers, and only ever executes in *that* repo's own GitHub Actions — never on DevDigest's infrastructure. This is the intended feature (AC-35/36), not an injection risk into DevDigest itself.
- **A03 Supply chain** — two new dependencies this plan introduces (`yaml`, already used by `agent-runner` at `^2.6.1`; `jszip`, MIT-licensed, ~9M weekly downloads, used for both server-side artifact unzip and client-side archive-download zip) — **user-confirmed accepted** — are added in Step 1 only, pinned, no other new dependencies anywhere in this plan.

---

## 5. Runtime Isolation & Merge Compatibility

This worktree (`devdigest-ci`, branch `feat/export-to-ci`) runs its **own isolated runtime** so it can stay live at the same time as the sibling `../devdigest-review` worktree (Feature A). Every implementer, on every step, must follow this before touching a server, Docker, or a test that needs either.

**Preferred isolated runtime for this worktree (local-only, if free):**

| Resource | Value |
|---|---|
| Client dev server | `CLIENT_PORT=3010` |
| API server | `API_PORT=3011` |
| Postgres | `POSTGRES_PORT=5442` |
| DB name | `DATABASE_NAME=devdigest_ci` |
| DB URL | `DATABASE_URL=postgres://postgres:postgres@localhost:5442/devdigest_ci` |
| Postgres container | standalone `docker run` (runbook below) — **NOT** `docker compose`: this repo's `docker-compose.yml` fixes `container_name: devdigest-postgres` + `5432:5432` with no parameterization, so `docker compose -p devdigest_ci up -d` cannot produce an isolated instance |

**Bring-up runbook (verified against this repo's actual config — the `docker compose -p devdigest_ci` shorthand does NOT isolate here):**

```sh
# 1) isolated Postgres — own container, port, volume, DB (compose can't do this here)
docker run -d --name devdigest-postgres-ci \
  -e POSTGRES_USER=devdigest -e POSTGRES_PASSWORD=devdigest -e POSTGRES_DB=devdigest_ci \
  -p 5442:5432 -v devdigest_ci_pgdata:/var/lib/postgresql/data pgvector/pgvector:pg16
# 2) worktree-local env (UNCOMMITTED — .env is gitignored)
#   server/.env : DATABASE_URL=postgres://devdigest:devdigest@localhost:5442/devdigest_ci  ·  API_PORT=3011
#   client/.env : NEXT_PUBLIC_API_BASE=http://localhost:3011
# 3) schema + demo data
cd server && pnpm db:migrate && pnpm db:seed
# 4) servers — client port is HARDCODED to 3000 in package.json (`next dev -p 3000`); override on the CLI, never edit the committed script
cd server && pnpm dev                      # API :3011 (tsx watch, reads API_PORT)
cd client && pnpm exec next dev -p 3010    # web :3010
```

> Creds are `devdigest:devdigest` (this repo's convention — matches `docker-compose.yml`), not the `postgres:postgres` placeholder in the isolation profile; the app config + `db:seed` expect the repo creds, and the DB URL encodes them. Integration `*.it.test.ts` need only the Docker **daemon** (Testcontainers spins its own ephemeral Postgres on a random port) — never this dev container. Hermetic tests + `typecheck` need nothing live.

**Hard rules:**

1. **These are local-only, env-driven values — never literals in committed code.** `3010`, `3011`, `5442`, `devdigest_ci`, and `devdigest_review` (the sibling worktree's identifier) must **never** appear hardcoded in committed application code, tests, shared configs, or docs. Read every runtime value from the existing env/config mechanisms this project already has (`.env`, `docker-compose.yml` overrides, `AppConfig`) — never a new hardcoded literal.
2. **The final merged feature must run on the default runtime** — client `3000`, API `3001`, Postgres `5432`. Any new configuration this plan introduces needs safe defaults compatible with those; the isolated ports above are a *local dev convenience for parallel worktrees*, not a product requirement.
3. **Never commit** `.env.local`, `.env.*.local`, temporary Docker Compose override files, or generated runtime profiles — these are worktree-local and out of git by convention; verify `git status` doesn't show one staged before any commit in this plan.
4. **Pre-flight before starting any server or Docker container:** check **both** the isolated ports (3010/3011/5442) **and** the defaults (3000/3001/5432 — the sibling worktree may be holding these). On any conflict: **STOP and report** — never silently fall back to testing against an already-running server, and never assume `localhost:3001`/`localhost:3000` belongs to *this* worktree just because something answers there.
5. **Before finalizing any step** (i.e., before reporting it done): run `git diff --name-only`, then `grep -R "3010\|3011\|5442\|devdigest_ci\|devdigest_review" <the changed files>` (excluding `.env.local`, `node_modules/`, `.git/`, and build caches). Strip any leak before committing. This grep sweep **is** the pre-finalize checklist for this plan — every step's Verify checklist implicitly includes it in addition to whatever is listed under that step.
6. **If runtime isolation is ever unclear** (e.g. it's ambiguous whether a port is free, or whether a running server belongs to this worktree or the sibling one) — **stop before starting any server or e2e run** and report exactly what's ambiguous. Do not guess.

**Final response format** — every implementer, for every step in §6, ends its own final report with exactly these fields (in addition to whatever this plan's per-step "Verify" checklist otherwise requires):

- Summary of what was implemented
- Files changed (owned paths actually touched)
- Tests run + results (hermetic / integration, pass/fail counts)
- Runtime resources used (ports, DB, Docker Compose project — or "none" if the step needed no live server)
- Confirmation that no worktree-specific value (§5 rule 1) was hardcoded into any changed file
- Confirmation of default-runtime compatibility (§5 rule 2)
- Known risks or open questions
- Confirmation that no other worktree's files/processes were used or modified

---

## 6. Implementation Steps

**Parallelization map** (hard cap: ≤5 concurrent implementers per wave):

```
Wave 1 (solo — shared foundation, MUST finish before anything else starts)
  Step 1

Wave 2 (5 parallel — all depend only on Step 1)
  Step 2   Step 3   Step 4   Step 5   Step 6

Wave 3 (4 parallel — depend on specific Wave-2 steps, see each step's Dependencies)
  Step 7   Step 8   Step 9   Step 10

Wave 4 (solo — integrates Wave 3's two server services into the public route surface)
  Step 11
```

Step 7 depends on Steps 2, 3, **and 4** (Step 4 for `RunsRepository`, used by `getAgentCiSurface`'s AC-29/AC-46 latest-status/7-day joins); Step 8 depends on Steps 2, **3**, and 4 (Step 3 for the shared `CI_RESULT_ARTIFACT_NAME` constant, Step 4 for `RunsRepository`/`ingest-helpers.ts`). Both are already satisfied by "Wave 3 starts only after all of Wave 2 finishes" — these are documentation-honesty fixes to the DAG, not a wave restructuring.

Until Step 11 lands, client steps (9, 10) built in Wave 3 will get real 404s if manually exercised against a live server — this is expected mid-flight in multi-agent execution and resolves once Step 11 completes (the established "mocked-API, parallel with server" convention already used elsewhere in this codebase — client insights.md 2026-07-03 Pattern entry).

**Before starting any step that runs a server, Docker, or a live test:** follow the §5 Runtime Isolation pre-flight. **Before reporting any step done:** run the §5 pre-finalize grep sweep and include the §5 Final response format in your report.

---

### Step 1: Shared foundation — contracts, DB schema, migration, adapter port interfaces

**Dependencies:** none
**Owned paths:**
`server/src/vendor/shared/adapters.ts` · `server/src/vendor/shared/contracts/eval-ci.ts` · `server/src/db/schema/ci.ts` · `server/src/db/migrations/` (new files only) · `client/src/vendor/shared/adapters.ts` · `client/src/vendor/shared/contracts/eval-ci.ts` · `server/package.json` · `client/package.json`

**What to do:**

1. In `server/src/vendor/shared/adapters.ts`, add a new port next to `GitClient`:
   ```ts
   export interface RunnerBundler {
     /** Builds the agent-runner `ncc` bundle fresh and returns its contents. */
     build(): Promise<{ contents: string }>;
   }
   ```
   Add 4 methods to the existing `GitHubClient` interface (after `getFileContents`):
   ```ts
   listWorkflowRuns(
     repo: RepoRef,
     workflowFile: string,
     opts?: { perPage?: number },
   ): Promise<{ id: number; status: string; conclusion: string | null; html_url: string; created_at: string }[]>;
   getWorkflowRun(repo: RepoRef, runId: number): Promise<{ id: number; status: string; conclusion: string | null; html_url: string }>;
   listRunArtifacts(repo: RepoRef, runId: number): Promise<{ id: number; name: string; expired: boolean }[]>;
   downloadArtifact(repo: RepoRef, artifactId: number): Promise<Buffer>;
   ```
2. In `server/src/vendor/shared/contracts/eval-ci.ts`, apply these additive changes only:
   - `CiTarget`, `CiFile`, `AgentManifest` — unchanged.
   - `CiExportInput` — add `workflow_override: z.string().nullish()`.
   - `CiInstallation` — add `slug: z.string()` (the frozen, first-export-derived path identity — §1 design decision #1), `workflow_version: z.number().int()`, `disconnected_at: z.string().nullable()`, `triggers: z.array(z.string())`, `post_as: z.enum(['github_review', 'pr_comment', 'none'])`, `latest_run_status: CiRunStatus.nullable()` (this last field is server-computed, never a DB column — declare `CiRunStatus` above `CiInstallation` if ordering requires it, or forward-reference via a type-only import within the same file).
   - `CiRunStatus` — add `'skipped_fork'` to the enum: `z.enum(['succeeded', 'failed', 'no_findings', 'running', 'skipped_fork'])`.
   - `CiRun` — add `critical: z.number().int().nullable()`, `warning: z.number().int().nullable()`, `suggestion: z.number().int().nullable()`, `repo: z.string().nullable()` (denormalized snapshot, see rationale in schema step below). **`agent`/`duration_s` are already present in this contract** (pre-existing fields, not added by this plan) — the schema step below adds the DB columns that back them, which were previously missing.
   - New contracts (append at the end of the Export-to-CI section):
     ```ts
     export const CiExportPreviewInput = z.object({
       triggers: z.array(z.string()).default(['opened', 'synchronize']),
       post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
     });
     export type CiExportPreviewInput = z.infer<typeof CiExportPreviewInput>;

     export const CiExportPreview = z.object({ files: z.array(CiFile) });
     export type CiExportPreview = z.infer<typeof CiExportPreview>;

     export const CiBulkUpdateOutcome = z.object({
       installation_id: z.string(),
       ok: z.boolean(),
       pr_url: z.string().nullable(),
       error: z.string().nullable(),
     });
     export type CiBulkUpdateOutcome = z.infer<typeof CiBulkUpdateOutcome>;

     export const CiBulkUpdateResult = z.object({ results: z.array(CiBulkUpdateOutcome) });
     export type CiBulkUpdateResult = z.infer<typeof CiBulkUpdateResult>;

     export const CiDisconnectResult = z.object({ installation: CiInstallation });
     export type CiDisconnectResult = z.infer<typeof CiDisconnectResult>;

     export const CiAgentSurface = z.object({
       installations: z.array(CiInstallation),
       active_count: z.number().int(),
       last_7_days: z.object({
         runs: z.number().int(),
         findings: z.number().int(),
         cost_usd: z.number().nullable(),
       }),
     });
     export type CiAgentSurface = z.infer<typeof CiAgentSurface>;

     export const CiRunsResponse = z.object({
       runs: z.array(CiRun),
       last_checked_at: z.string().nullable(),
     });
     export type CiRunsResponse = z.infer<typeof CiRunsResponse>;

     export const CiCheckResult = z.object({
       checked_at: z.string(),
       runs_updated: z.array(CiRun),
     });
     export type CiCheckResult = z.infer<typeof CiCheckResult>;
     ```
   - `server/src/vendor/shared/index.ts` already does `export * from './contracts/eval-ci.js'` and `export * from './adapters.js'` — **no barrel edit needed**; verify the client barrel (`client/src/vendor/shared/index.ts`) does the same before skipping its edit.
3. Mirror **every** change in step 2 verbatim into `client/src/vendor/shared/contracts/eval-ci.ts` and the `RunnerBundler`/`GitHubClient` additions into `client/src/vendor/shared/adapters.ts` (client never calls `RunnerBundler`/the 4 GitHub methods directly, but the type copy must stay in sync per the established client-mirror convention).
4. In `server/src/db/schema/ci.ts`, add to `ciInstallations`:
   - `workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' })` (import `workspaces` from `./core`)
   - `slug: text('slug').notNull()` — derived once at first export (`slugify(agent.name)`), then frozen; the repository/service layer (Steps 3/7), never the DB, is responsible for never overwriting it on conflict.
   - `triggers: jsonb('triggers').$type<string[]>().notNull().default(sql`'["opened","synchronize"]'::jsonb`)` — **this codebase has no native Postgres array column anywhere in `schema/`; do not introduce the first one here.** The one existing list-column precedent is `reviews.ts:53-54`'s `jsonb().$type<string[]>().default(sql\`'[]'::jsonb\`)` pattern — reuse that exact idiom (a `jsonb` column typed as `string[]` via Drizzle's `$type<>()`, not a real array type) for consistency with the codebase's only prior art. Downstream TypeScript code sees a plain `string[]` either way — the storage choice is invisible past the repository layer.
   - `postAs: text('post_as', { enum: ['github_review', 'pr_comment', 'none'] }).notNull().default('github_review')`
   - `workflowContents: text('workflow_contents').notNull().default('')`
   - `workflowVersion: integer('workflow_version').notNull().default(1)`
   - `disconnectedAt: timestamp('disconnected_at', { withTimezone: true })` (nullable)
   - Table-level: `uq: uniqueIndex('ci_installations_workspace_repo_uq').on(t.workspaceId, t.repo)` — **one installation per (workspace, repo)**, the DB-level backstop for the one-agent-per-repo rule (§1 design decision #1; the *user-facing* "reject a second different agent" behavior is enforced in Step 7's service, not by this constraint alone — a naive `ON CONFLICT DO UPDATE` would otherwise silently let a second agent hijack the row). Also `wsIdx: index('ci_installations_workspace_id_idx').on(t.workspaceId)` (kept even though the unique index above already starts with `workspace_id` and could theoretically serve lookups — an explicit plain index is clearer intent and matches this codebase's existing convention on every other workspace-scoped table).
   Add to `ciRuns`:
   - `workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' })`
   - `githubRunId: text('github_run_id').notNull()` — table-level `UNIQUE` index `ci_runs_github_run_id_uq`
   - `repo: text('repo')` (nullable, denormalized snapshot — survives the FK `SET NULL` when an installation's parent agent is cascade-deleted, see edge case table row "source agent deleted")
   - `agent: text('agent')` (nullable, denormalized snapshot — same rationale as `repo`. **This backs the `agent` field already declared on the frozen `CiRun` contract** — that field existed with no backing column before this fix; Step 4's `upsertByGithubRunId` and Step 8's ingest loop both write it.)
   - `durationS: integer('duration_s')` (nullable, whole seconds. **Backs the frozen `CiRun.duration_s` contract field** — same pre-existing-field, missing-column situation as `agent`. Column name matches the contract field exactly. `CiResultArtifact.duration_ms` is milliseconds; Step 8 converts `Math.round(duration_ms / 1000)` at the ingest boundary — nowhere else stores or reads milliseconds.)
   - `critical: integer('critical')`, `warning: integer('warning')`, `suggestion: integer('suggestion')` (all nullable)
   - Table-level: `wsIdx: index('ci_runs_workspace_id_idx').on(t.workspaceId)`
5. Run `cd server && pnpm db:generate`. **Before running**, `ls server/src/db/migrations/` to confirm the next free number (research found `0023` free at research time — re-verify; if the sibling `../devdigest-review` worktree has since claimed `0023`, use `0024`). Review the generated `.sql` — it must contain only `ALTER TABLE ci_installations ADD COLUMN ...` (including `slug`, and `triggers` as a `jsonb` column — never a native array type), `ALTER TABLE ci_runs ADD COLUMN ...` (including `agent` and `duration_s`), `CREATE UNIQUE INDEX ci_installations_workspace_repo_uq`, `CREATE UNIQUE INDEX ci_runs_github_run_id_uq`, `CREATE INDEX` statements — nothing else. Run `cd server && pnpm db:migrate` (against this worktree's own isolated DB per §5 — never a shared/default-port DB you don't own).
6. Add `"yaml": "^2.6.1"` and `"jszip": "^3.10.1"` to `server/package.json` dependencies (both used starting Step 3/4); add `"jszip": "^3.10.1"` to `client/package.json` dependencies (used starting Step 9). Run `pnpm install` in both `server/` and `client/`.

**Verify:**
- [ ] `cd server && pnpm typecheck` passes
- [ ] `cd client && pnpm typecheck` passes
- [ ] Generated migration SQL reviewed by hand — no `DROP`/no `ALTER COLUMN` on pre-existing columns; `triggers` is `jsonb`, not a native array type
- [ ] `pnpm db:migrate` applies cleanly against this worktree's own dev DB
- [ ] `server/src/vendor/shared/contracts/eval-ci.ts` and `client/src/vendor/shared/contracts/eval-ci.ts` are byte-identical for every changed/added export
- [ ] Existing `server/test/contracts.test.ts`-style fixture tests (if any touch `eval-ci.ts` types) still pass — check for a fixture that needs the new required fields added
- [ ] §5 pre-finalize grep sweep clean

**Commit:** `feat(ci): additive shared contracts + DB schema for CI export/ingest (0023)`

---

### Step 2: Adapter implementations — GitHubClient (4 methods), RunnerBundler, container wiring

**Dependencies:** Step 1
**Owned paths:** `server/src/adapters/github/octokit.ts` · `server/src/adapters/mocks.ts` · `server/src/adapters/runner-bundle/ncc.ts` (new) · `server/src/platform/container.ts`

**What to do:**

1. In `server/src/adapters/github/octokit.ts`, implement the 4 new `GitHubClient` methods using `this.octokit.rest.actions.*`, wrapped in the existing `withRetry`/`withTimeout` pattern (matching every other method in this file):
   - `listWorkflowRuns(repo, workflowFile, opts)` → `octokit.rest.actions.listWorkflowRuns({ owner, repo: name, workflow_id: workflowFile, per_page: opts?.perPage ?? 10 })`, mapped to the interface's return shape.
   - `getWorkflowRun(repo, runId)` → `octokit.rest.actions.getWorkflowRun({ owner, repo: name, run_id: runId })`.
   - `listRunArtifacts(repo, runId)` → `octokit.rest.actions.listWorkflowRunArtifacts({ owner, repo: name, run_id: runId })`, mapped to `{id, name, expired}[]`.
   - `downloadArtifact(repo, artifactId)` → `octokit.rest.actions.downloadArtifact({ owner, repo: name, artifact_id: artifactId, archive_format: 'zip' })`. **Verify empirically** (via a live call or the installed `octokit` version's typed return) whether this resolves to binary `data` directly or to a redirect `url` that must be `fetch()`'d separately — Octokit's behavior for this specific endpoint has varied across major versions. Return `Buffer.from(...)` either way. Note the finding as a code comment for the next reader.
2. In `server/src/adapters/mocks.ts`, extend `MockGitHubClient` with the same 4 methods, following the existing mock style (return configurable fixtures via `this.opts`, default to a small deterministic fixture set — e.g. one `completed`/`success` run and one `in_progress` run). Add public arrays to record calls where the existing mock does so for other methods (e.g. `public listedRuns: {repo: RepoRef; workflowFile: string}[] = []`).
3. Create `server/src/adapters/runner-bundle/ncc.ts`:
   ```ts
   export class NccRunnerBundler implements RunnerBundler {
     async build(): Promise<{ contents: string }> { ... }
   }
   ```
   Resolve `agent-runner`'s path relative to `import.meta.url` (not `process.cwd()`) so it is correct regardless of the server's launch directory: `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../agent-runner')`. Run the build via `execFile('pnpm', ['--dir', agentRunnerPath, 'run', 'build'], { timeout: 30_000 })` (never `exec`/shell — see §4 Security), then `fs.readFile(path.join(agentRunnerPath, 'dist', 'index.js'), 'utf8')`. On any failure (non-zero exit, missing output file), throw `new ExternalServiceError('Failed to build the CI runner bundle', { cause: err })`.
4. Add `MockRunnerBundler implements RunnerBundler` to `server/src/adapters/mocks.ts` — returns a fixed short fixture string (e.g. `'// mock runner bundle\n'`), records call count.
5. In `server/src/platform/container.ts`:
   - Add `runnerBundler?: RunnerBundler` to `ContainerOverrides`.
   - Add `private _runnerBundler?: RunnerBundler;`.
   - Add a lazy getter mirroring `get git()` exactly:
     ```ts
     get runnerBundler(): RunnerBundler {
       if (this.overrides.runnerBundler) return this.overrides.runnerBundler;
       this._runnerBundler ??= new NccRunnerBundler();
       return this._runnerBundler;
     }
     ```
   - Import `RunnerBundler` from `@devdigest/shared`, `NccRunnerBundler` from `../adapters/runner-bundle/ncc.js`.

**Verify:**
- [ ] `pnpm typecheck` passes
- [ ] Hermetic test: `container.runnerBundler` returns the override when supplied, else a real `NccRunnerBundler` instance (do not actually invoke `.build()` in a hermetic test — that would run a real `ncc` build; test only the container wiring)
- [ ] Hermetic test: `MockGitHubClient`'s 4 new methods return their configured fixtures and record calls
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` passes
- [ ] §5 pre-finalize grep sweep clean

**Commit:** `feat(ci): GitHubClient Actions/artifacts methods + RunnerBundler adapter`

---

### Step 3: CI producer domain layer — installations repository, compose helpers, manifest + workflow generators

**Dependencies:** Step 1
**Owned paths:** `server/src/modules/ci/repository/installations.repo.ts` (new) · `server/src/modules/ci/helpers.ts` (new) · `server/src/modules/ci/manifest.ts` (new) · `server/src/modules/ci/workflow.ts` (new)

**What to do:**

1. `installations.repo.ts` — `InstallationsRepository` class, constructor `(private db: Db)`, methods (every query scoped by `workspace_id`):
   - `findByRepo(workspaceId, repo): Promise<CiInstallationRow | undefined>` — the one-agent-per-repo lookup (§1). Returns the installation regardless of which agent it belongs to; **the caller (Step 7) decides** whether a found row's `agentId` matches the requested agent or is a conflict — this repository method does not itself enforce the business rule (R2/onion-architecture: business rules belong in the service, not the repository).
   - `listByAgent(workspaceId, agentId): Promise<CiInstallationRow[]>` (includes disconnected — caller filters as needed; one agent can still have many installations across many *different* repos, §1)
   - `listTracked(workspaceId): Promise<CiInstallationRow[]>` (`disconnected_at IS NULL`) — used by ingest's check loop
   - `upsertPublished(workspaceId, id, values: {agentId, repo, targetType, slug, triggers, postAs, workflowContents})`: `INSERT ... ON CONFLICT (workspace_id, repo) DO UPDATE SET agent_id = excluded.agent_id, triggers = excluded.triggers, post_as = excluded.post_as, workflow_contents = excluded.workflow_contents, workflow_version = ci_installations.workflow_version + 1 RETURNING *`. Note `slug` is **deliberately absent from the `DO UPDATE SET` list** — on conflict, Postgres keeps the existing row's `slug` untouched, which is the actual mechanism (not a comment, not a runtime check) that makes AC-4/AC-5's identity stability hold across a rename. This is the **only** place `workflow_version` increments, and only on a call that represents a successful publish (AC-45). Callers must have already confirmed (Step 7) that any pre-existing row's `agent_id` matches `values.agentId` before calling this for an existing repo — this method trusts its caller for that guarantee; it is not a second enforcement point.
   - `disconnect(workspaceId, id): Promise<CiInstallationRow | undefined>` — `UPDATE ... SET disconnected_at = now() WHERE id=? AND workspace_id=? RETURNING *`.
   - `getById(workspaceId, id): Promise<CiInstallationRow | undefined>`.
2. `helpers.ts`:
   - `CI_RESULT_ARTIFACT_NAME = 'devdigest-result'` — a single exported constant naming the GitHub Actions artifact the generated workflow uploads (this step, item 4 below) and the one Step 8's ingest downloads by. **Both sides import this same constant** — never a string literal duplicated in two files — so the upload name and the download-selection name cannot drift apart.
   - `slugify(name: string): string` — lowercase, `[^a-z0-9]+` → `-`, trim leading/trailing `-`, cap at ~60 chars; exported `dedupeSlug(existing: Set<string>, base: string): string` appends `-2`, `-3`, ... on collision — used for **skill** filenames within one export (AC-2's "one file per linked skill" needs stable, collision-free filenames). The agent's own `slug` uses `slugify()` directly with **no** dedupe pass — at most one agent file exists per repo (§1), so there is nothing to collide with.
   - `composeCiFiles(params): CiFile[]` — pure function assembling the flat file list for one installation: `.devdigest/agents/${slug}.yaml` (via `manifest.ts`), `.devdigest/skills/${skillSlug}.md` per linked+enabled skill (empty list is valid, AC-2 edge case), `.devdigest/memory.jsonl` (always `''`, `editable: false`), `.github/workflows/devdigest-review.yml` (via `workflow.ts`, unless `params.workflowOverride` is provided — then use it verbatim, `editable: true`), `.devdigest/runner/index.js` (from `params.runnerBundleContents`, `editable: false`). All non-workflow files get `editable: false` (AC-35).
3. `manifest.ts` — `agentManifestYaml(agent: {name, model, systemPrompt, strategy, ciFailOn}, skillSlugs: string[]): string`. Build a plain object matching `AgentManifest`'s shape with `provider` **hardcoded to `'openrouter'`** regardless of `agent.provider` (AC-3 — the runner only ever uses one provider; writing the agent's actual provider would misrepresent what runs), then `YAML.stringify(obj)` (import `{ stringify } from 'yaml'`, the same library `agent-runner` uses to parse — added in Step 1).
4. `workflow.ts` — `generateWorkflowYaml(params: { triggers: string[]; postAs: 'github_review'|'pr_comment'|'none' }): string` (no `installationId`/`DEVDIGEST_DIR` parameter — flat layout, §1). Produces a GitHub Actions workflow (as a YAML string, built the same way — `YAML.stringify` or a template literal, implementer's choice as long as the output is valid YAML) satisfying:
   - `on.pull_request.types` = `params.triggers` (never the `pull_request_target` variant — AC-6).
   - A job-level `if:` guard skipping the job entirely for fork PRs: `if: github.event.pull_request.head.repo.full_name == github.repository` (AC-7).
   - A first step: `run: node .devdigest/runner/index.js`, `env:` block setting `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}`, `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` (only meaningful when `postAs !== 'none'`, but harmless to always set — GitHub always provides this token automatically, no manual secret needed), `GITHUB_REPOSITORY`/`PR_NUMBER`/`GITHUB_EVENT_PATH` (all GitHub-Actions-automatic, do not set explicitly), `DEVDIGEST_POST_AS: ${postAs}` — **no `DEVDIGEST_DIR`** (default `.devdigest` is correct, R4's env-var contract).
   - **A second step, immediately after the runner step: `uses: actions/upload-artifact@v4`**, with `name: ${CI_RESULT_ARTIFACT_NAME}` (imported from `./helpers.js` — the shared constant, item 2 above), `path: devdigest-result.json` (matches the runner's default `DEVDIGEST_RESULT_PATH`, R4 — no override set), `if: always()` (upload even when the runner step exits non-zero on a `REQUEST_CHANGES` gate — ingest needs the result on a *failing* check too, not only a passing one), `if-no-files-found: ignore` (a true hard-crash run that wrote no result file at all must not fail the upload step itself — ingest then falls back to GitHub's own reported run outcome, AC-21). Precedent for this exact step shape: `.github/workflows/e2e-web.yml:117`. **Without this step, nothing Step 8 downloads ever exists** — the runner only ever writes its result to local disk (research R3); this upload is what makes the whole ingest half of the feature reachable outside a mocked test.
   - Only `OPENROUTER_API_KEY` is a secret the workspace member must add manually — matches the drafted `ci.json` copy `"secretNote": "Add {key} to the repo's Actions secrets..."`.

**Verify:**
- [ ] `pnpm typecheck` passes
- [ ] Hermetic tests: `slugify`/`dedupeSlug` collision cases; `composeCiFiles` with 0 skills, N skills, `workflowOverride` present vs absent, correct flat paths (`.devdigest/agents/<slug>.yaml`, `.devdigest/memory.jsonl`, `.github/workflows/devdigest-review.yml`); `agentManifestYaml` always writes `provider: openrouter` even when the input agent's provider is `'openai'`/`'anthropic'` (AC-3, direct assertion); `generateWorkflowYaml` output contains the fork-skip `if:` guard, the standard `pull_request` trigger (never `pull_request_target`), never inlines a raw secret value (only `${{ secrets.OPENROUTER_API_KEY }}`), and never sets `DEVDIGEST_DIR`
- [ ] Hermetic test: `composeCiFiles` given a fixed `slug` produces the same `.devdigest/agents/<slug>.yaml` path regardless of what the passed-in agent's *current* `name` is (i.e. the function takes `slug` as an explicit input, never re-derives it from `agent.name` itself) — direct AC-4/AC-5 coverage at this layer
- [ ] Hermetic test: `generateWorkflowYaml`'s output contains an `actions/upload-artifact@v4` step, positioned after the runner step, referencing `CI_RESULT_ARTIFACT_NAME` as its `name:`, with `if: always()` and `if-no-files-found: ignore` — direct coverage for the ingest half's reachability (AC-21, AC-43, AC-44)
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` passes
- [ ] §5 pre-finalize grep sweep clean

**Commit:** `feat(ci): producer domain layer — installations repo, manifest/workflow generators`

---

### Step 4: CI ingest domain layer — runs repository, status-mapping + artifact validation helpers

**Dependencies:** Step 1
**Owned paths:** `server/src/modules/ci/repository/runs.repo.ts` (new) · `server/src/modules/ci/ingest-helpers.ts` (new)

**What to do:**

1. `runs.repo.ts` — `RunsRepository` class, constructor `(private db: Db)`:
   - `upsertByGithubRunId(workspaceId, installationId, githubRunId, values: {prNumber, ranAt, status, findingsCount, critical, warning, suggestion, costUsd, durationS, githubUrl, repo, agent}): Promise<CiRunRow>` — `INSERT ... ON CONFLICT (github_run_id) DO UPDATE SET status=excluded.status, findings_count=excluded.findings_count, critical=excluded.critical, warning=excluded.warning, suggestion=excluded.suggestion, cost_usd=excluded.cost_usd, duration_s=excluded.duration_s, agent=excluded.agent, ... RETURNING *` (AC-19/AC-20 — this single upsert is what guarantees one GitHub run → one row, no matter how many checks observe it). `values.durationS`/`values.agent` map straight onto the `duration_s`/`agent` columns added in Step 1.
   - `list(workspaceId, filters: {agentId?, repo?, status?, sinceDays?}): Promise<CiRunRow[]>` — joins `ci_installations` (left join, since `ci_installation_id` can be null after cascade-delete) only to resolve `agentId`/`targetType` filters when the run's own denormalized `repo`/`agent` columns aren't enough; orders by `ran_at DESC NULLS LAST`.
   - `getLastCheckedAt(workspaceId): Promise<Date | null>` / `setLastCheckedAt(workspaceId, at: Date): Promise<void>` — implemented via direct `t.settings` queries (`key = 'ci_last_checked_at'`, `userId IS NULL`), `INSERT ... ON CONFLICT (workspace_id, user_id, key) DO UPDATE` on the existing `settings_ws_user_key_uq` index (`server/src/db/schema/core.ts:46`) — **no new column, no new table** (design decision #2 in §1).
2. `ingest-helpers.ts`:
   - `parseResultArtifact(zipBuffer: Buffer): Promise<CiResultArtifact | null>` — `JSZip.loadAsync(zipBuffer)`, read the single entry (name it defensively — don't assume a fixed filename inside the zip; take the first `.json` entry found), `JSON.parse`, `CiResultArtifact.safeParse` (import `JSZip` from `'jszip'`, added to `server/package.json` in Step 1). Return `null` on any parse/validation failure (zip corrupt, JSON malformed, schema mismatch) — never throw; the caller (Step 8) falls back to GitHub-reported outcome only (AC-21).
   - `mapGithubRunToStatus(run: {status, conclusion}, artifact: CiResultArtifact | null): CiRunStatus` — pure mapping function:
     - `run.status !== 'completed'` → `'running'`
     - `run.status === 'completed' && run.conclusion === 'skipped'` → `'skipped_fork'`
     - `run.status === 'completed' && artifact === null` → `run.conclusion === 'success' ? 'no_findings' : 'failed'` (AC-21 fallback)
     - `run.status === 'completed' && artifact !== null` → `run.conclusion === 'failure' ? 'failed' : (artifact.findings_count === 0 ? 'no_findings' : 'succeeded')`

**Verify:**
- [ ] `pnpm typecheck` passes
- [ ] Hermetic tests: `parseResultArtifact` with a valid zip fixture (build one in the test via `JSZip` itself), a corrupt-zip buffer, a valid-zip-but-schema-invalid JSON — all three cases asserted
- [ ] Hermetic tests: `mapGithubRunToStatus` covers all 5 branches above, including the AC-21 fallback branches
- [ ] `RunsRepository.upsertByGithubRunId` hermetic/integration test asserting a second upsert with the same `github_run_id` updates the same row (no new row) — direct AC-19/AC-20 coverage
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` passes
- [ ] §5 pre-finalize grep sweep clean

**Commit:** `feat(ci): ingest domain layer — runs repo (dedup upsert), artifact validation`

---

### Step 5: Client shared data layer — CI hooks + i18n additions

**Dependencies:** Step 1
**Owned paths:** `client/src/lib/hooks/ci.ts` (new) · `client/messages/en/ci.json` (additive edits)

**What to do:**

1. Create `client/src/lib/hooks/ci.ts` mirroring `client/src/lib/hooks/blast.ts`'s shape:
   - `useCiSurface(agentId)` — `GET /agents/:id/ci` → `CiAgentSurface`
   - `useExportCiPreview(repoId, agentId)` — mutation, `POST /repos/:repoId/agents/:agentId/ci/preview` with `CiExportPreviewInput` body → `CiExportPreview`
   - `useExportCi(repoId, agentId)` — mutation, `POST /repos/:repoId/agents/:agentId/export-ci` with `CiExportInput` body → `CiExport`; on success `queryClient.invalidateQueries({queryKey: ['ci-surface', agentId]})`. A 409 response (repo already installed to a different agent, AC-13) surfaces through the mutation's normal `error`/`ApiError` path — no special handling needed in the hook itself, the server's message is user-facing-quality prose (Step 7).
   - `useBulkUpdateCi(agentId)` — mutation, `POST /agents/:id/ci/bulk-update` → `CiBulkUpdateResult`; invalidates `['ci-surface', agentId]` on success
   - `useDisconnectCi(agentId)` — mutation, `POST /ci/installations/:id/disconnect` → `CiDisconnectResult`; invalidates `['ci-surface', agentId]`
   - `useCiRuns(filters: {agentId?, repo?, status?, sinceDays?})` — `GET /ci/runs?...` → `CiRunsResponse`, `refetchInterval` left to the consuming page (Step 10), not baked into the hook
   - `useCiCheck()` — mutation, `POST /ci/check` → `CiCheckResult`; invalidates `['ci-runs']` on success
   Use `queryKey` shapes `['ci-surface', agentId]` and `['ci-runs', filters]`, consistent with the project's `[domain, id?, ...filters]` convention.
2. Extend `client/messages/en/ci.json` **additively** (do not touch existing `runs`/`exportWizard`/`ciTab` keys — they stay as drafted; ignore `publishDialog`, superseded). Add the following new keys under existing top-level objects:
   - `ciTab.*`: `disconnect`, `disconnectConfirm`, `activeInstallations` (`"{count} active"`), `workflowVersion` (`"v{version}"`), `failOnLabel`, `failOnHint`, `last7Days` (`"{runs} runs · {findings} findings · {cost}"`), `updating`, `updateOutcome` (`"{ok} of {total} installations updated"`), `noInstallations`.
   - `runs.*`: add `edgeCases.neverRun`, `edgeCases.noMatch`, `edgeCases.checkFailed`, `status.skippedFork` (`"Skipped (fork)"`), `lastChecked` (`"Last checked {time}"`), `viewJob` (GitHub Actions job link label).
   - `exportWizard.*`: add `downloadArchive` (`"Download files (.zip)"`), `downloading`, `secretValueLabel`, `copySecret`, `copied`.
   Keep the JSON valid and alphabetically/logically grouped near its sibling keys.

**Verify:**
- [ ] `pnpm typecheck` passes
- [ ] `ci.json` remains valid JSON (`node -e "require('./client/messages/en/ci.json')"` or equivalent)
- [ ] No existing key was renamed or removed — diff review against the pre-edit file
- [ ] `pnpm test` (client) passes — no existing test depended on the exact prior `ci.json` shape
- [ ] §5 pre-finalize grep sweep clean

**Commit:** `feat(ci): client hooks + i18n additions for CI export/runs`

---

### Step 6: Client nav — CI Runs sidebar entry + command-palette key

**Dependencies:** none
**Owned paths:** `client/src/vendor/ui/nav.ts` · `client/messages/en/shell.json`

**What to do:**

1. In `client/src/vendor/ui/nav.ts`, add a `ci-runs` item to the `NAV` array (a new group or the existing `WORKSPACE`/`SKILLS LAB` group — `SKILLS LAB` fits better alongside `agents`/`evals`): `{ key: "ci-runs", label: "CI Runs", icon: "GitBranch", href: "/ci-runs", gKey: "r" }` (verify `"GitBranch"` exists in `client/src/vendor/ui/icons.tsx`'s registry before using it; fall back to `"Workflow"` or `"Rocket"` if not — check the registry file, do not guess). Add a matching `SHORTCUTS` entry (`{ keys: "g r", label: "Go to CI Runs", group: "Navigation" }`).
   `client/src/components/app-shell/helpers.ts`'s `activeKeyFor` **already** matches `/ci-runs` → `"ci-runs"` (line 38, confirmed pre-existing) — no edit needed there.
2. In `client/messages/en/shell.json`, add `nav["ci-runs"]` (exact key matching `NAV[].items[].key`, **not** `nav.ci_runs` or any other variant — the command palette (`useShellCommands.ts`) builds each entry via `t(\`nav.${it.key}\`)` and throws `MISSING_MESSAGE` at mount for any mismatch, crashing the whole app shell — this exact failure mode is documented in client insights.md 2026-07-07).

**Verify:**
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` (client) passes, including any existing `useShellCommands`/nav rendering test — run the full suite once, not just a filtered subset, to catch the palette-crash class of bug
- [ ] Manual/RTL check: the chosen icon name exists in `vendor/ui/icons.tsx`
- [ ] §5 pre-finalize grep sweep clean

**Commit:** `feat(ci): add CI Runs nav entry + command palette key`

---

### Step 7: CI producer service — preview, export, bulk-update, disconnect, agent CI surface

**Dependencies:** Step 2, Step 3, Step 4 (Step 4 for `RunsRepository`, used by `getAgentCiSurface`'s AC-29/AC-46 latest-status/7-day joins — see item 6 below)
**Owned paths:** `server/src/modules/ci/export-service.ts` (new)

**What to do:**

Implement `ExportService`, constructor `(private container: Container)`, lazily instantiating `InstallationsRepository`/`RunsRepository` from `container.db` (mirror `BlastService`'s lazy-repo pattern).

1. Shared private helper `resolveInstallationTarget(workspaceId, repo, agentId): Promise<{ id: string; slug: string; existing: CiInstallationRow | undefined }>` — used by **both** `previewFiles` and `exportInstallation` (P1/P2: one place enforces the one-agent-per-repo rule, not two copies of it):
   - `existing = await installationsRepo.findByRepo(workspaceId, repo)`.
   - If `existing` and `existing.agentId !== agentId` → throw `new AppError('repo_already_installed', 'This repository already has DevDigest installed for a different agent. Disconnect it first, or choose another repository.', 409)` (AC-13, re-scoped).
   - If `existing` (same agent) → return `{ id: existing.id, slug: existing.slug, existing }`.
   - Else → return `{ id: crypto.randomUUID(), slug: slugify(agent.name), existing: undefined }` (fresh identity, **not yet persisted** — AC-4).
2. `previewFiles(workspaceId, repoId, agentId, input: CiExportPreviewInput): Promise<CiExportPreview>` — resolve+validate repo (workspace-scoped, 404 if absent) and agent (workspace-scoped, 404 if absent), fetch linked+enabled skills (`container.agentsRepo.linkedSkills(agentId)`, filter `.skill.enabled`), call `resolveInstallationTarget` (surfaces the AC-13 conflict early, at Preview time, not only at Install). Compose files via `composeCiFiles` (Step 3) **using a placeholder empty string for the runner-bundle contents** (preview never needs the real bundle — it's not shown anyway, AC-37). Return `{ files }` with **no DB write, no GitHub call**.
3. `exportInstallation(workspaceId, repoId, agentId, input: CiExportInput): Promise<CiExport>` — the full flow:
   a. Resolve+validate repo and agent (same as preview).
   b. Validate `container.secrets.get('OPENROUTER_API_KEY')` is set — if not, throw `ValidationError('Configure an OpenRouter API key in Settings before exporting to CI')` **before any GitHub/build call**.
   c. `{ id, slug } = await resolveInstallationTarget(workspaceId, repo, agentId)` (throws the AC-13 conflict here too, before any further work).
   d. `await container.runnerBundler.build()` → `{ contents }`.
   e. Compose the full file list via `composeCiFiles`, passing `input.workflow_override ?? undefined` (server falls back to `generateWorkflowYaml` when absent).
   f. If `input.action === 'open_pr'`: `container.github()` → `commitFiles(repo, { branch: 'devdigest/ci', base: input.base, message: ..., files })` (fixed branch name — one installation per repo means one branch name is always sufficient, §1), then `findOpenPr(repo, branch)` — if null, `openPullRequest(repo, { title: `Add DevDigest CI review (${agent.name})`, head: branch, base: input.base, body: ... })` (AC-9/AC-10). If any GitHub call throws, propagate the error unchanged (do **not** catch-and-persist) — AC-12.
   g. If `input.action === 'files'`: skip GitHub entirely.
   h. **Only after (f)/(g) succeed**: `InstallationsRepository.upsertPublished(...)` with the explicit `id`/`slug` from step (c) — this is the single write that both creates-or-updates the row **and** increments `workflow_version` (AC-45), and it is the only step that can make AC-12's "no installation recorded on failure" true, since everything above it is side-effect-free on our own DB.
   i. Return `CiExport { installation: toCiInstallationDto(row), files, pr_url: prUrl ?? null }`. Include the **decrypted secret value** in a sibling field of the response the client reads once (add `secret_value: z.string()` to a thin response wrapper around `CiExport` used only by this route — do **not** add it to the persisted/reusable `CiExport` contract itself, since that type is also used for the ingest/list paths where re-exposing a secret would be a logging/leak risk; keep this as an inline route-level response shape, e.g. `CiExport.extend({ secret_value: z.string() })` defined locally in `ci/export-service.ts` or `ci/routes.ts`, not in the shared barrel).
4. `bulkUpdate(workspaceId, agentId): Promise<CiBulkUpdateResult>` — fetch `listByAgent(workspaceId, agentId)`, filter to non-disconnected. Build the runner bundle **once** (shared across all installations in this call). For each installation, **reuse its stored `workflowContents` verbatim** (never regenerate the workflow — see §1 design note on bulk-update semantics), regenerate config/skills/memory fresh from current agent state using that installation's own frozen `slug`, then: call `commitFiles` to the fixed `devdigest/ci` branch of that installation's own `repo` (**never** `openPullRequest` — AC-40's "SHALL NOT open a new pull request"; `commitFiles` creates the branch if missing and is safe to call even for a previously-archive-only installation). Run with a concurrency cap of 3 (mirror `reviews/routes.ts`'s `scheduleNext` pattern, but `await Promise.allSettled`-style so the route can return a combined result rather than fire-and-forget). Each installation's outcome (`ok`, `pr_url`, `error`) is captured independently — one installation's GitHub failure must not abort the others (AC-41). On `ok: true`, call `upsertPublished` for that installation (version bump); on `ok: false`, leave its row untouched.
5. `disconnect(workspaceId, installationId): Promise<CiDisconnectResult>` — `InstallationsRepository.disconnect(...)`, 404 if not found; no GitHub/file-system side effect whatsoever (AC-14).
6. `getAgentCiSurface(workspaceId, agentId): Promise<CiAgentSurface>` — `listByAgent` (all, including disconnected — but `active_count` counts only non-disconnected, AC-47) + `RunsRepository.list` (Step 4) scoped to this agent's installation ids with `sinceDays: 7` for the rollup (AC-29, "same rolling window as the run history's own recency filter" — hardcode 7 in both places, do not introduce a config knob) + per-installation `latest_run_status` via a small in-JS `Map` built from the same runs query (group by `ci_installation_id`, take the max `ran_at`) rather than a second SQL round trip.

**Verify:**
- [ ] `pnpm typecheck` passes
- [ ] Hermetic test (mock `container.github()`, `container.runnerBundler`, fake db): `exportInstallation` with action=`open_pr` calls `commitFiles` then `findOpenPr`/`openPullRequest` in that order, and only calls `upsertPublished` **after** those succeed
- [ ] Hermetic test: a `MockGitHubClient` configured to throw on `commitFiles` results in **no** `upsertPublished` call (direct AC-12 coverage)
- [ ] Hermetic test: two consecutive `exportInstallation` calls for the same `(agentId, repo)` reuse the same `installation.id`/`slug` and increment `workflow_version` by exactly 1 each time, **even when the agent's `name` was changed between the two calls** (AC-4, AC-5, AC-45 — the slug-freeze guarantee)
- [ ] Hermetic test: `exportInstallation`/`previewFiles` for a **different** `agentId` against a repo that already has an installation for another agent throws the 409 `AppError`, and — for `exportInstallation` — makes **no** `upsertPublished` call (direct AC-13 re-scoped coverage)
- [ ] Hermetic test: `bulkUpdate` with one installation's mock `commitFiles` throwing still returns a full 2-entry `results` array with the other installation's `ok: true` (AC-41)
- [ ] Hermetic test: `bulkUpdate` never calls `openPullRequest` (AC-40)
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` passes
- [ ] §5 pre-finalize grep sweep clean

**Commit:** `feat(ci): export service — preview, publish, bulk-update, disconnect, agent CI surface`

---

### Step 8: CI ingest service — check for new results, run history query

**Dependencies:** Step 2, Step 3 (for the shared `CI_RESULT_ARTIFACT_NAME` constant in `ci/helpers.ts`), Step 4
**Owned paths:** `server/src/modules/ci/ingest-service.ts` (new)

**What to do:**

Implement `IngestService`, constructor `(private container: Container)`.

1. `checkForNewResults(workspaceId): Promise<CiCheckResult>` — wrap the entire body in `withTimeout(..., 30_000)` (imported from `../../platform/resilience.js`); on a caught `TimeoutError`, rethrow as `new ExternalServiceError('CI check timed out after 30s')` (AC-27). Body:
   - `installations = await installationsRepo.listTracked(workspaceId)` (excludes disconnected, AC-17's "every installation still being tracked").
   - For each installation: `runs = await container.github().listWorkflowRuns(repo, 'devdigest-review.yml', {perPage: 10})` — **fixed workflow filename** (§1; no longer derived per-installation, since every installation now generates the same single workflow file name in its own repo).
   - For each `run`: if `run.status !== 'completed'` → upsert with `status: 'running'`, `findingsCount: null`, `costUsd: null` (AC-18). Else: `conclusion === 'skipped'` → upsert `status: 'skipped_fork'`. Else: `artifacts = await listRunArtifacts(...)`, find the one whose `name === CI_RESULT_ARTIFACT_NAME` (imported from `../ci/helpers.js`, Step 3 — the exact same constant the generated workflow uploads under; if no artifact matches, treat it identically to a download failure below), `buf = await downloadArtifact(...)`, `artifact = await parseResultArtifact(buf)` (Step 4), `status = mapGithubRunToStatus(run, artifact)` (Step 4), upsert with `findingsCount/critical/warning/suggestion/costUsd` from `artifact` when present, `durationS = artifact?.duration_ms != null ? Math.round(artifact.duration_ms / 1000) : null` (`CiResultArtifact.duration_ms` is milliseconds; `ci_runs.duration_s`/`CiRun.duration_s` is seconds — this is the one place the conversion happens), else all `null` (AC-21 fallback). Every upsert snapshots `repo` (from the installation's own `repo` field, **never** from the artifact — AC-22) and `agent` (from the agent's current `name` at check time, written into the new `ci_runs.agent` column from Step 1).
   - `await runsRepo.setLastCheckedAt(workspaceId, new Date())` **only if the whole loop completed without throwing** (a partial/timed-out check should not silently claim success).
   - Return `{ checked_at, runs_updated }` (the list of rows actually upserted this call).
2. `listRuns(workspaceId, filters): Promise<CiRunsResponse>` — `runsRepo.list(workspaceId, filters)` + `runsRepo.getLastCheckedAt(workspaceId)`.

**Verify:**
- [ ] `pnpm typecheck` passes
- [ ] Hermetic test: a `MockGitHubClient` whose `listWorkflowRuns` never resolves (a pending `Promise` that's never settled, or an artificially delayed one beyond the timeout) causes `checkForNewResults` to reject with `ExternalServiceError` within the test's own timeout budget — direct AC-27 coverage with the "stalled mock GitHub client" the spec's own Verify note calls for
- [ ] Hermetic test: a run with `conclusion: 'skipped'` maps to `status: 'skipped_fork'` end to end
- [ ] Hermetic test: `checkForNewResults` selects the artifact by `CI_RESULT_ARTIFACT_NAME` when `listRunArtifacts` returns multiple fixture artifacts, not just "the first one" — direct coverage that the shared-constant selection (not a positional guess) is what's actually implemented
- [ ] Hermetic test: an artifact's `duration_ms: 12345` is persisted as `duration_s: 12` (rounded seconds), never raw milliseconds
- [ ] Hermetic test: calling `checkForNewResults` twice with the same fixture run id upserts the same `ci_runs` row (no duplicate) — integration-level assertion complementing Step 4's repository-level unit test
- [ ] Hermetic test: `listRuns` never reads any identity field from a parsed artifact — assert the returned row's `repo`/`agent` match the installation fixture, not anything the (test-controlled) artifact fixture claims
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` passes
- [ ] §5 pre-finalize grep sweep clean

**Commit:** `feat(ci): ingest service — check loop with 30s timeout, run history query`

---

### Step 9: Client — Agent Editor CI tab + Export Wizard

**Dependencies:** Step 5
**Owned paths:** `client/src/app/agents/[id]/_components/AgentEditor/_components/CITab/**` (new folder) · `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` · `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`

**What to do:**

1. In `constants.ts`, add `{ key: "ci", labelKey: "editor.tabs.ci", icon: "GitBranch" }` (or whatever icon Step 6 confirmed exists) to `TABS`. The label key `editor.tabs.ci` **already exists** in `client/messages/en/agents.json` — no i18n edit needed for the tab label itself.
2. In `AgentEditor.tsx`, add a `tab === "ci"` branch rendering `<CITab agent={agent} />`.
3. `CITab.tsx` (`useTranslations("ci")`, `ciTab.*` + `exportWizard.*` keys):
   - `useCiSurface(agent.id)` — render `active_count` (AC-47), `last_7_days` summary (AC-29).
   - A **"Fail CI on"** control: reuse the exact `SelectInput` + `CI_FAIL_ON_VALUES` + `useUpdateAgent` pattern already implemented in `ConfigTab.tsx` (do not duplicate the constant — import `CI_FAIL_ON_VALUES` from `../ConfigTab/constants.ts`). This is a "staged" control by construction: it only ever calls the existing `PATCH /agents/:id` (via `useUpdateAgent`), which never touches any repo file — satisfying AC-42 with **zero new server code**, since that guarantee already holds for the existing endpoint.
   - Installations list: for each `installation` in `surface.installations`, show `repo`, `target_type` (label via `exportWizard.targets.*`), `latest_run_status` badge (reuse the severity/status badge convention already used elsewhere — e.g. `RunHistory`'s icon+label pattern), `workflow_version` (`ciTab.workflowVersion`), and a **Disconnect** button (`useDisconnectCi`, confirm via a simple `window.confirm`-equivalent or an inline confirm state — no new Dialog component needed for a single yes/no).
   - **"Export to CI"** button opens `<ExportWizard/>` in a `Modal` (`agent`, `onClose`).
   - **"Update CI config"** button (visible when `surface.installations.length > 0`) calls `useBulkUpdateCi(agent.id)`, renders the per-installation `results` array afterward (`ciTab.updateOutcome`, one row per outcome with ok/error).
4. `_components/ExportWizard/ExportWizard.tsx` — 4-step wizard, local `step: 0|1|2|3` state, `ExportWizardSteps` (vendor component, already exists — `steps` labels from `exportWizard.steps.*`) for the step indicator inside the `Modal`'s header area:
   - **Target** (step 0): `useRepos()` dropdown (only connected repos are selectable — satisfies AC-1 at the UI layer; the server independently re-validates via the route param, AC-1's real enforcement). Render the other `exportWizard.targets.*` entries (circle/jenkins/cli) as visibly disabled/non-advancing per AC-33.
   - **Preview** (step 1, on-enter): call `useExportCiPreview(repoId, agent.id)` with default `triggers`/`post_as`. **If this call fails with a 409** (repo already installed to a different agent, AC-13), show that error inline at this step (the server's message text, no special client-side copy needed) instead of rendering the file list, and do not allow advancing to Configure/Install. Otherwise render `preview.files` **filtered to exclude any path starting with `.devdigest/runner/`** (AC-37 — never shown here). Only the workflow file (`.github/workflows/devdigest-review.yml`) is rendered as an editable `Textarea`; the rest render read-only (AC-34/AC-35). Track `workflowEdited: boolean` + `workflowText: string` in local state; once `workflowEdited` becomes `true` (user typed in the textarea), never overwrite `workflowText` from a subsequent preview response (AC-36).
   - **Configure** (step 2): `triggers` checkboxes (`opened`/`synchronize` checked by default, `reopened` optional — AC-38) + `post_as` radio/select (`github_review`/`pr_comment`/`none`). On change, if `!workflowEdited`, re-call `useExportCiPreview` to refresh the shown (unedited) workflow text; if `workflowEdited`, do **not** re-call (AC-36's guarantee holds by construction — no request that could overwrite the edit is ever made).
   - **Install** (step 3): two buttons — "Open pull request" (`action: 'open_pr'`) and `exportWizard.downloadArchive` (`action: 'files'`) — both call `useExportCi(repoId, agent.id)` with the same body (`{ target: 'gha', action, post_as, triggers, base: 'main', repo: <selected repo's display string>, workflow_override: workflowEdited ? workflowText : undefined }`). A 409 here (same AC-13 conflict, e.g. if another export raced in between Preview and Install) renders the same inline error as the Preview step. On the `open_pr` response, show `pr_url` + the one-time secret name/value (`exportWizard.secretValueLabel` + a copy-to-clipboard button using the `navigator.clipboard` pattern already established in `OnboardingTourView.test.tsx`'s insight — guard for `!navigator.clipboard`) — never write the secret value into any persisted client state (React Query cache is fine since it's in-memory/session-only and never sent anywhere else; do not `localStorage`/log it — AC-31). On the `files` response, build a zip client-side: `import JSZip from 'jszip'`, `const zip = new JSZip(); for (const f of files) zip.file(f.path, f.contents); const blob = await zip.generateAsync({type:'blob'})`, then trigger a download via a temporary `<a>` + `URL.createObjectURL(blob)` (revoke the URL after click).

**Verify:**
- [ ] `pnpm typecheck` passes
- [ ] RTL: Target step disables non-GHA platform options (AC-33)
- [ ] RTL: Preview step renders the memory file even with empty content, and never renders a `.devdigest/runner/` path (AC-34, AC-37)
- [ ] RTL: editing the workflow textarea then changing a Configure toggle leaves the textarea's value unchanged (AC-36) — mock `useExportCiPreview` and assert it is **not** called again after the edit
- [ ] RTL: Install step's two buttons both ultimately call `useExportCi` with the same `repo`/`triggers`/`post_as`, differing only in `action`
- [ ] RTL: a 409 preview response renders the conflict message and blocks advancing past Preview (AC-13)
- [ ] RTL: "Fail CI on" control on the CI tab calls the same `useUpdateAgent` mutation `ConfigTab` uses (spy on the hook module)
- [ ] `pnpm test` (client) passes, including a re-check of `AgentEditor.test.tsx`'s existing tests (new tab may require a router/query-client mock addition — check per the client insights.md pattern on new hook calls breaking sibling tests)
- [ ] §5 pre-finalize grep sweep clean

**Commit:** `feat(ci): Agent Editor CI tab + 4-step Export Wizard`

---

### Step 10: Client — CI Runs page

**Dependencies:** Step 5
**Owned paths:** `client/src/app/ci-runs/page.tsx` (new) · `client/src/app/ci-runs/_components/CiRunsView/**` (new)

**What to do:**

1. `page.tsx` — thin Server Component (or `"use client"` page reading no params, following whichever of the two established patterns in this codebase is simpler here — no dynamic route segment exists for this page, so either is fine; prefer a plain client page for consistency with most other top-level pages like `agents/page.tsx`/`evals/page.tsx` rather than the one-off `context/page.tsx` RSC pattern). Renders `<CiRunsView/>` inside the app shell, crumb from `page.crumb` (`ci.json`).
2. `CiRunsView.tsx`:
   - Filters: agent (dropdown from `useAgents()`), repo (from `useRepos()`), status, recency window (`runs.filters.*` copy) — AC-23.
   - `useCiRuns(filters)` with `refetchInterval` active **only while this component is mounted** (React Query's own lifecycle already guarantees this — no manual visibility tracking needed) — this, plus the server never running an independent cron, is what satisfies AC-16.
   - An explicit **Refresh** button calling `useCiCheck()` (`runs.refresh`/`runs.refreshing` copy).
   - Table columns per AC-43: PR (number + title/link), repo, agent, verdict/status badge (`runs.status.*`, including the new `skippedFork`), findings (total, with a hover/click-through to critical/warning/suggestion breakdown — reuse the existing severity-pill pattern from `PRRow`/`RunHistory` rather than inventing a new one), cost, duration, a link to `github_url` (`runs.viewJob`).
   - Empty-state variants (AC-24), each visibly distinct: **(a)** no runs ever for the workspace (`runs.emptyTitle`/`emptyBody`) when `runs.length === 0` and no filter is active; **(b)** current filters match nothing (`runs.edgeCases.noMatch`) when `runs.length === 0` and a filter *is* active; **(c)** last check failed (`runs.edgeCases.checkFailed`) when `useCiCheck()`'s mutation `isError` is true; **(d)** per-row `skipped_fork` status badge is itself the 4th distinguishable state, not a page-level empty state (see §1 design note on AC-24's reading).
   - `runs.lastChecked` display from `CiRunsResponse.last_checked_at`.

**Verify:**
- [ ] `pnpm typecheck` passes
- [ ] RTL: the 3 page-level empty/error states render distinctly under their respective fixture conditions
- [ ] RTL: a `skipped_fork` row renders its own status label, distinct from `failed`
- [ ] RTL: filters call `useCiRuns` with the expected query params
- [ ] `pnpm test` (client) passes
- [ ] §5 pre-finalize grep sweep clean

**Commit:** `feat(ci): CI Runs page — filters, table, edge-case states`

---

### Step 11: Server — routes.ts, module registration

**Dependencies:** Step 7, Step 8
**Owned paths:** `server/src/modules/ci/routes.ts` (new) · `server/src/modules/index.ts`

**What to do:**

1. `routes.ts` — Fastify plugin, `app.withTypeProvider<ZodTypeProvider>()`, `new ExportService(container)` + `new IngestService(container)`, mirroring `blast/routes.ts`'s shape (thin handlers, `getContext` first, delegate to service, return). Define a local `RepoAgentParams = z.object({ repoId: z.string().uuid(), agentId: z.string().uuid() })` (not added to the shared `_shared/schemas.ts` — this shape is specific to this module and touching a shared file here has no benefit). Routes:
   - `POST /repos/:repoId/agents/:agentId/ci/preview` — body `CiExportPreviewInput`, response `CiExportPreview`. No rate limit (cheap, no external calls). Can respond 409 (AC-13, propagated from the service's `resolveInstallationTarget`).
   - `POST /repos/:repoId/agents/:agentId/export-ci` — body `CiExportInput`, response the local `CiExport.extend({ secret_value: z.string() })` wrapper (Step 7). `config: { rateLimit: { max: 2, timeWindow: '1 minute', keyGenerator: async (req) => { const {workspaceId} = await getContext(container, req); return `ci-export:${workspaceId}`; } } }` (AC-15, exact `brief-generate` precedent). Can respond 409 (AC-13).
   - `POST /agents/:id/ci/bulk-update` — `IdParams`, response `CiBulkUpdateResult`, same rate-limit pattern keyed `ci-bulk-update:${workspaceId}` (AC-48).
   - `POST /ci/installations/:id/disconnect` — `IdParams`, response `CiDisconnectResult`. No rate limit.
   - `GET /agents/:id/ci` — `IdParams`, response `CiAgentSurface`. No rate limit.
   - `GET /ci/runs` — query schema `{agent_id?, repo?, status?, since_days?}` (all optional, coerced), response `CiRunsResponse`. No rate limit.
   - `POST /ci/check` — response `CiCheckResult`, rate-limit keyed `ci-check:${workspaceId}` (AC-26).
   Every handler calls `getContext(container, req)` first (AC-32) and every workspace-scoped id lookup 404s via the existing `NotFoundError` on a missing/cross-workspace row (services already throw this per Step 7/8).
2. In `server/src/modules/index.ts`, add `import ci from './ci/routes.js';` and one `ci,` entry in the `modules` record.

**Verify:**
- [ ] `pnpm typecheck` passes
- [ ] Integration test (`.it.test.ts`, Testcontainers): full export flow — `POST preview` then `POST export-ci` with `action: 'open_pr'` against a `MockGitHubClient`/`MockRunnerBundler`-overridden container — asserts a `ci_installations` row exists with `workflow_version: 1`, then a second `export-ci` call bumps it to `2`, reuses the same `id`/`slug`, and **the agent's `name` was changed between the two calls without changing the generated file path** (AC-4, AC-5, AC-45)
- [ ] Integration test: exporting a **different** agent to a repo that already has an installation from another agent returns 409 and leaves the existing installation row untouched (AC-13, re-scoped)
- [ ] Integration test: cross-workspace access to `GET /agents/:id/ci` / `POST /ci/installations/:id/disconnect` for another workspace's agent/installation returns 404
- [ ] Integration test: 3rd `export-ci` request within 60s from the same workspace is rejected (429) — AC-15
- [ ] Integration test: 3rd `bulk-update` request within 60s is rejected — AC-48
- [ ] Integration test: 3rd `POST /ci/check` request within 60s is rejected — AC-26
- [ ] Integration test: `POST /ci/check` against a stalled `MockGitHubClient` fails within the test's own bounded wait, with a clean error body (not a raw timeout/hang) — AC-27
- [ ] Integration test: fork-originating run ingestion — a `MockGitHubClient` fixture run with `conclusion: 'skipped'` — surfaces as `skipped_fork` in `GET /ci/runs`
- [ ] Integration test: duplicate `listWorkflowRuns` fixture (same run id returned twice across two `POST /ci/check` calls) results in exactly one `ci_runs` row — AC-19/AC-20
- [ ] Integration test: an artifact that fails `CiResultArtifact.safeParse` results in a run row falling back to GitHub's own `conclusion` (`failed`/`no_findings`), never a crash — AC-21
- [ ] `pnpm exec vitest run .it.test` passes (Docker required — this worktree's own isolated Postgres per §5, never a shared/default instance)
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` passes
- [ ] Manual smoke: restart the manually-run API process for **this worktree's own port** (schema + module registration changed) before any further manual testing — never restart/touch a process on the default ports or the sibling worktree's ports (§5)
- [ ] §5 pre-finalize grep sweep clean

**Commit:** `feat(ci): register ci module — routes, rate limits, integration tests`

---

## 7. Acceptance Criteria

| AC | Criterion (abridged) | Step(s) |
|---|---|---|
| AC-1 | Export requires a validated connected repo, never an arbitrary string | 7, 9, 11 |
| AC-2 | Compose name/model/prompt/strategy/ci_fail_on + enabled skills | 3 |
| AC-3 | Provider field always written as the runner's supported provider | 3 |
| AC-4 | Stable configuration-file identity per installation (frozen `slug`, derived once at first export, never re-derived on rename) | 1, 3, 7 |
| AC-5 | Re-export of the same agent overwrites, never duplicates | 1, 3, 7 |
| AC-6 | Standard `pull_request` trigger only, never `pull_request_target` | 3 |
| AC-7 | Fork PRs skip the review job | 3 |
| AC-8 | Workflow supplies every required env var incl. post-as choice | 3 |
| AC-9 | Open a PR when none exists | 7 |
| AC-10 | Reuse an existing open PR | 7 |
| AC-11 | Show PR URL + exact secret name/value on success | 7, 9 |
| AC-12 | GitHub failure surfaces; no installation recorded as if succeeded | 7 |
| AC-13 | **(re-scoped 2026-07-09)** v1 is one agent per repository — installing a second, *different* agent to an already-installed repo is rejected with a clear conflict error; the same agent installed to many *different* repos still works; re-export of the same agent still overwrites in place | 1, 3, 7, 9, 11 |
| AC-14 | Disconnect stops tracking, never touches repo files | 1, 7, 9 |
| AC-15 | Export rate-limited to 2/min/workspace | 11 |
| AC-16 | Checks only on page-open/explicit refresh, never an independent schedule | 8, 10 |
| AC-17 | Check determines new runs per tracked installation | 8 |
| AC-18 | In-progress run shown running, no findings/cost | 4, 8 |
| AC-19 | Finished run updates the same entry | 1, 4, 8 |
| AC-20 | Never two entries for one underlying run | 1, 4, 8 |
| AC-21 | Validate result file; discard + fall back to GitHub's outcome on failure. **Requires the generated workflow to actually upload the artifact** (Step 3's `upload-artifact` step) — without it, this AC's real path is unreachable and only its fallback branch ever fires | 3, 4, 8 |
| AC-22 | Attribute by which installation/repo was queried, never file contents | 8 |
| AC-23 | Filter by agent, repo, status, recency | 4, 8, 10 |
| AC-24 | 4 distinguishable states (never/no-match/check-failed/skipped-fork) | 1, 4, 10 |
| AC-25 | Show when last successfully checked | 4, 8, 10 |
| AC-26 | Refresh rate-limited to 2/min/workspace | 11 |
| AC-27 | 30s timeout on check, fails visibly | 8, 11 |
| AC-28 | Installation + run rows carry `workspace_id` directly | 1 |
| AC-29 | Agent CI surface: 7-day rollup, same window as run history | 7, 9 |
| AC-30 | Never write/transmit/commit a secret value into the target repo | 3 |
| AC-31 | Secret value shown only to the authenticated exporter, never logged/persisted client-side | 7, 9 |
| AC-32 | Every new route is authenticated + workspace-scoped | 11 |
| AC-33 | Target step: only GitHub Actions is functional | 9 |
| AC-34 | Preview lists config + skills + memory, memory listed even empty | 3, 9 |
| AC-35 | Only the workflow file is editable in Preview | 3, 9 |
| AC-36 | Edited workflow text is sticky across Configure changes | 9 |
| AC-37 | Runner bundle always committed, never listed/editable in Preview | 2, 3, 9 |
| AC-38 | Configure: trigger choices + post-as choices | 1, 3, 9 |
| AC-39 | Install: PR or archive, both record the same installation | 7, 9 |
| AC-40 | Bulk update regenerates config, updates existing PR/archive per installation, never opens a new PR | 7 |
| AC-41 | Bulk update reports per-installation outcome | 1, 7, 9 |
| AC-42 | `ci_fail_on` change only updates the agent, no file writes until re-export | 9 (reuses existing `PATCH /agents/:id`) |
| AC-43 | Run history columns: PR, repo, agent, verdict, findings, cost, duration, job link. **Depends on Step 3's artifact-upload step** — the data these columns render only exists in production if the workflow actually uploads it | 1, 3, 4, 8, 10 |
| AC-44 | Verdict = own completion status; findings total + breakdown available. **Same artifact-upload dependency as AC-43** | 1, 3, 4, 8, 10 |
| AC-45 | Workflow-version counter, +1 per successful re-export/bulk-update | 1, 3, 7 |
| AC-46 | Per-installation: repo, target, most-recent status, workflow version | 1, 7, 9 |
| AC-47 | Active installation count | 7, 9 |
| AC-48 | Bulk update rate-limited to 2/min/workspace | 11 |

## 8. Testing Plan

**Runtime isolation pre-flight (§5):** before running any test suite that starts a real Postgres/API process (`.it.test.ts`, `pnpm dev`, manual smoke), confirm this worktree's isolated runtime ports/DB per §5 — never assume `:3001`/`:3000`/`5432` belong to this worktree; the sibling `../devdigest-review` worktree may be holding them.

**Server:** hermetic (`.test.ts`, `src/adapters/mocks.ts`) for `ci/helpers.ts`, `ci/manifest.ts`, `ci/workflow.ts`, `ci/ingest-helpers.ts`, `ci/repository/*.repo.ts` (fake db), `ci/export-service.ts`, `ci/ingest-service.ts`. Integration (`.it.test.ts`, Testcontainers Postgres, real DB, no mocks) for `ci/routes.ts` — the module's actual HTTP surface, workspace scoping, rate limits, and the AC-27 stalled-mock/AC-19/20 dedup/AC-21 discard/AC-13 conflict scenarios that need a real DB round trip to be convincing.

**Client:** Vitest + RTL, `fetch`/hooks mocked (no running server needed) for the CI tab, Export Wizard's 4 steps, and the CI Runs page.

| Test | Type | Covers |
|---|---|---|
| `slugify`/`dedupeSlug` collisions | hermetic | AC-2 |
| `composeCiFiles` 0/N skills, override present/absent, flat paths | hermetic | AC-2, AC-34, AC-36, AC-37 |
| `composeCiFiles` slug is a pure input, never re-derived from the passed agent's current name | hermetic | AC-4, AC-5 |
| `agentManifestYaml` always `provider: openrouter` | hermetic | AC-3 |
| `generateWorkflowYaml` fork-guard + standard trigger + no inlined secret + no `DEVDIGEST_DIR` + uploads the result artifact (`CI_RESULT_ARTIFACT_NAME`, `if: always()`, `if-no-files-found: ignore`, after the runner step) | hermetic | AC-6, AC-7, AC-8, AC-21, AC-30, AC-43, AC-44 |
| `parseResultArtifact` valid/corrupt/schema-invalid | hermetic | AC-21 |
| `mapGithubRunToStatus` all branches incl. `skipped_fork` | hermetic | AC-18, AC-21, AC-24 |
| `RunsRepository.upsertByGithubRunId` dedup, `agent`/`duration_s` persisted correctly | hermetic | AC-19, AC-20, AC-43, AC-44 |
| `ExportService.resolveInstallationTarget` rejects a 2nd different agent for the same repo | hermetic | AC-13 |
| `ExportService.exportInstallation` GH-failure → no `upsertPublished` call | hermetic | AC-12 |
| `ExportService` repeat export of the same agent → same id/slug, +1 version, survives a rename | hermetic | AC-4, AC-5, AC-45 |
| `ExportService.bulkUpdate` partial failure → per-item outcome, no new PR | hermetic | AC-40, AC-41 |
| `IngestService.checkForNewResults` stalled mock → timeout error | hermetic | AC-27 |
| `IngestService.checkForNewResults` selects the artifact by `CI_RESULT_ARTIFACT_NAME`, converts `duration_ms` → `duration_s` | hermetic | AC-21, AC-43, AC-44 |
| `POST /repos/:repoId/agents/:agentId/export-ci` full flow | integration | AC-1, AC-4, AC-5, AC-9, AC-10, AC-11, AC-45 |
| 2nd different agent exported to an already-installed repo → 409, no mutation | integration | AC-13 |
| Cross-workspace 404 on `GET /agents/:id/ci` / disconnect | integration | AC-28, AC-32 |
| 3rd `export-ci`/`bulk-update`/`check` request in 60s rejected | integration | AC-15, AC-26, AC-48 |
| `POST /ci/check` stalled mock → visible failure | integration | AC-27 |
| Fork-skip ingestion → `skipped_fork` in `GET /ci/runs` | integration | AC-7, AC-24 |
| Duplicate run observed across 2 checks → 1 row | integration | AC-19, AC-20 |
| Malformed artifact → fallback to GitHub outcome | integration | AC-21, AC-22 |
| Export Wizard: Target disables non-GHA | RTL | AC-33 |
| Export Wizard: Preview lists memory file empty, hides runner bundle | RTL | AC-34, AC-37 |
| Export Wizard: edited workflow survives a Configure toggle | RTL | AC-36 |
| Export Wizard: Install PR vs archive, same underlying call shape | RTL | AC-39 |
| Export Wizard: 409 conflict blocks advancing past Preview | RTL | AC-13 |
| CI tab: Fail-on control reuses `useUpdateAgent` | RTL | AC-42 |
| CI Runs page: 3 page-level empty/error states + skipped-fork row | RTL | AC-24, AC-25 |

## 9. Out of Scope

- Generating workflows for CircleCI/Jenkins/generic CLI (target-platform vocabulary reserved, not built) — spec Non-goal.
- Any change to `agent-runner/src/*` or its env-var contract — spec Non-goal, frozen.
- Any change to the existing in-app (live) review path — spec Non-goal.
- GitHub App installation / branch-protection "block merge on findings" — spec Non-goal, v1 uses PAT-based auth only.
- Real-time/streaming CI run status — spec Non-goal; polling only while the CI Runs page is open.
- Removing workflow/config files from the target repo on disconnect — spec Non-goal (AC-14 note); the repo owner remains responsible for removing them, same as any other CI vendor.
- Exporting one agent to many repos, or many agents to one repo, in a single installation *action* — spec Non-goal; bulk update is a convenience wrapper around per-installation update-in-place, not a batch-create.
- **Deferred (2026-07-09 user decision, formerly AC-13's broader scope):** installing more than one agent to the *same* repository at all. v1 enforces exactly one agent per repository — a second, different agent is rejected with a clear conflict error (§1, §7 AC-13). Multi-agent-per-repo — and the per-installation `.devdigest/{id}/...` path-scoping and per-installation workflow-filename machinery that would be needed to support it (both considered and dropped during planning) — is a future iteration, not v1.
- **Future iteration (not v1):** real drift-detection logic comparing an installation's published config against the agent's current settings beyond the raw `workflow_version` counter (AC-45's rationale explicitly defers this).
- **Future iteration (not v1):** a dedicated `MemoryItem`/persistent-memory feature — the exported memory file is a permanently-empty placeholder in this plan; wiring it to real content is a separate, unspecified future feature.
- **Future iteration (not v1):** server-side archive generation (a dedicated zip-download route) — this plan's client-side `jszip` approach is simpler and sufficient for v1; a server-side route would only be worth it if archives grow large enough to matter for mobile/slow clients.
- **Future iteration (not v1):** removing the `disconnected_at` soft-delete window (i.e., a hard-delete/purge action for installations) — not requested by any AC.
