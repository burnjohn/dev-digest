# Research — Feature B "Export to CI" (2026-07-09)

> Read-only research feeding the implementation-planner. Every claim carries a
> `file:line` citation. Input to `docs/feature-requirements/2026-07-09-ci-agent-runner-pipeline.md`.
> **v1 posture: keep the implementation simple; iterate later.**

## R1 — Runner-bundle sourcing → DECISION: build during export

- `agent-runner/dist/` does **not** exist on disk (nothing to copy from).
- Build script: `agent-runner/package.json:9` → `"build": "ncc build src/index.ts -o dist"`; `@vercel/ncc` is a devDependency (`package.json:18`). Emits a self-contained `dist/index.js`.
- **Git-ignore contradiction (verified via `git check-ignore -v`):** root `.gitignore:1-6` negates `!agent-runner/dist/`, but `agent-runner/.gitignore:2` (`dist/`) **wins** (nearer-file precedence) → `git add -f` would still fail today. Not blocking under the chosen approach.
- No automated build wiring: no `.github/workflows/*` job builds agent-runner; no root `package.json`; `scripts/` only has `dev.sh`/`e2e.sh`.
- **DECISION (user-confirmed): (a) build the `ncc` bundle during export/bulk-update handling**, read the fresh `dist/index.js`, include in `commitFiles`. Rationale: the runner embeds `reviewer-core`'s `groundFindings()` gate + deterministic verdict into every artifact (`agent-runner/AGENTS.md:60-73`, `README.md:114-124`) → a stale bundle is a **correctness/security regression**, not cosmetic. Build-during-export guarantees sync with current source. +1–5s latency on a rate-limited background job — acceptable.
- **Architecture note:** wrap the build behind an **injected adapter port** (via `app.container`), not raw `child_process`/fs in a service.

## R2 — Producer GitHub-write capability (exists) + ingest gap (4 new methods)

- **Already exists** (`GitHubClient` port `server/src/vendor/shared/adapters.ts:145-179`; impl `server/src/adapters/github/octokit.ts`):
  - `commitFiles(repo, payload) → {branch}` — `adapters.ts:163`, impl `octokit.ts:262-328` (blobs→tree→commit→ref; creates branch from base or force-ffs).
  - `findOpenPr(repo, branch) → {url}|null` — `adapters.ts:165`, impl `octokit.ts:330-347`.
  - `openPullRequest(repo, payload) → {url}` — `adapters.ts:157`, impl `octokit.ts:243-260`.
  - Mock: `MockGitHubClient` `mocks.ts:150` (`commitFiles` 243, `findOpenPr` 248).
- **Ingest GAP — no GitHub Actions methods exist** (grep for `listWorkflowRuns|workflow_run|listArtifacts|getArtifact` → 0 hits). Add to the port + Octokit impl (wrapping already-available `octokit.rest.actions.*`; `octokit@^4.0.3` `server/package.json:38`):
  1. `listWorkflowRuns(repo, {since?})` → `rest.actions.listWorkflowRunsForRepo`
  2. `getWorkflowRun(repo, runId)` → `rest.actions.getWorkflowRun` (AC-18/19 finished-poll)
  3. `listRunArtifacts(repo, runId)` → `rest.actions.listWorkflowRunArtifacts`
  4. `downloadArtifact(repo, artifactId) → Buffer(zip)` → `rest.actions.downloadArtifact`
  Plus MockGitHubClient counterparts.

## R3 — Ingest seam: result file = uploaded ARTIFACT, not committed

- Runner writes `devdigest-result.json` to **local disk only** (`agent-runner/src/run.ts:149`, path from `index.ts:32`/`DEVDIGEST_RESULT_PATH`); it does **not** commit or upload it. Nothing in `agent-runner/src/*` calls an Actions artifacts API.
- Therefore **the generated workflow must add `actions/upload-artifact@v4`** (precedent: `.github/workflows/e2e-web.yml:117`, `evals.yml:278`) so ingest can retrieve it via R2's `listRunArtifacts`/`downloadArtifact`. Retrieval is by artifact download, **not** by reading a committed repo file.
- Runner output already `safeParse`d against `CiResultArtifact` before writing (`agent-runner/src/artifact.ts:32-54`); fields map 1:1 (`findings_count`, `critical/warning/suggestion`, `cost_usd`, `duration_ms`, `agent`, `version='1'`, `pr_number`) — see `artifact.ts:16-24,33,35`; `run.ts:39,144-147`. Contract: `server/src/vendor/shared/contracts/eval-ci.ts:228-239`.

## R4 — Workflow-generator contract (env-only, `node .devdigest/runner/index.js`)

- Invocation: **`node .devdigest/runner/index.js`** (`agent-runner/README.md:7-9`, `AGENTS.md:5`, forward-ref comment `src/index.ts:4-7`). NOT `runner.mjs`, NOT a marketplace `uses:` action — it's a plain Node script. (The comment forward-refs `server/src/modules/ci/constants.ts`/`workflow.ts` — not yet built.)
- **No CLI args** — env-only (all via injected `env`, `index.ts:30`):

| Var | Required | Where | Purpose |
|---|---|---|---|
| `OPENROUTER_API_KEY` | yes | `index.ts:39` | LLM cred → OpenRouterProvider |
| `GITHUB_TOKEN` | when post_as≠none | `run.ts:99-102` | fetch diff + post |
| `GITHUB_REPOSITORY` | yes | `context.ts:67-73` | owner/name |
| `PR_NUMBER` | yes¹ | `context.ts:78` | (fallback: event payload) |
| `GITHUB_EVENT_PATH` | GHA-auto | `context.ts:44-60,75` | title/body/fork flag |
| `DEVDIGEST_DIR` | no | `index.ts:31` | override `.devdigest` |
| `DEVDIGEST_RESULT_PATH` | no | `index.ts:32` | override artifact path |
| `DEVDIGEST_POST_AS` | no | `index.ts:25-28,33` | github_review(def)\|pr_comment\|none |

- Exit code: `0` ok; `1` on gate `REQUEST_CHANGES` **or** any hard failure (`run.ts:159-172`); on hard failure nothing posted/written — the "required check" relies on this exit code alone. Fork handling: runner computes fork status itself but relies on the workflow never scheduling it for a fork (skip job for forks).

## R5 — Server patterns for the new `ci/` module

- Scaffold: `server/src/modules/AGENTS.md:5-19` — `routes.ts`(plugin)/`service.ts`(logic)/`repository.ts`(DB, **always workspace_id-scoped**). Register in `server/src/modules/index.ts` (static import + `modules{}` entry, e.g. `blast` line 13/44).
- Clean example: `server/src/modules/blast/routes.ts:1-52` — `app.withTypeProvider<ZodTypeProvider>()`, `const { container } = app`, `new BlastService(container)`, Zod schemas, `getContext(container, req)` → `{workspaceId}`; **no concrete adapter imports**. Repo scoping: `blast/repository.ts` (`eq(...workspaceId, workspaceId)` on every query).
- Rate-limit + fan-out + detached logger: `server/src/modules/reviews/routes.ts` — `config:{rateLimit:{max:2,timeWindow:'1 minute'}}` (`:271`); `const log = req.log.child({...})` (`:303-305`); `CONCURRENCY=3` + `scheduleNext()` recursion (`:306-326`). Reuse for AC-15/26/48 + ingest "check all installations" + bulk-update.

## R6 — Client patterns (copy already drafted!)

- AgentEditor tab: add `ci` to `TABS` (`client/src/app/agents/[id]/_components/AgentEditor/constants.ts:12-17`, currently config|skills|context|evals) + a branch in `AgentEditor.tsx:26-34`. (Stale top-comment mentions "Stats" — no Stats tab in code; ignore.)
- New page: `client/src/app/ci-runs/page.tsx` (sibling to agents/evals/…). `activeKeyFor` already anticipates `/ci-runs` (`client/src/components/app-shell/helpers.ts:38`) BUT `client/src/vendor/ui/nav.ts:21-39` has **no** `ci-runs` NAV entry yet → must add the sidebar link.
- **i18n copy already fully drafted + unconsumed**: `client/messages/en/ci.json` (106 lines) has `runs.*`, `exportWizard.*` (target/preview/configure/install), `ciTab.*`, and `publishDialog.*`. No `useTranslations("ci")` anywhere (grep 0 hits). **`publishDialog` is a superseded single-step precursor** → ignore in favour of `exportWizard`.
- Data hook: mirror `useBlast` (`client/src/lib/hooks/blast.ts:13-20`) — `useQuery({queryKey:[domain,id], queryFn:({signal})=>api.get(...), enabled, staleTime})`.
- **Design HTML unusable:** `F:\Data\Neoversity_ai\DevDigest Design standalone.html` is ~1.78MB base64 on one line; `ScreenExport`/`ScreenCIRuns` components are not parseable text (only gallery labels for N11/N12/N13). **Authoritative UI source = spec §4 + AC-33..39 + `ci.json` copy**, not this HTML.

## R7 — Migrations

- Highest = `server/src/db/migrations/0022_agent_version_provenance.sql`; **0023 free here**. (Note: `AGENTS.md:7` says `server/drizzle/` but real path is `server/src/db/migrations/` per `drizzle.config.ts:8` `out`.)
- Workflow (`db/AGENTS.md:10`): edit `schema/` → `pnpm db:generate` → review → `pnpm db:migrate`. Add-only; never edit applied migration / alter existing column.
- `schema/ci.ts:1-27`: `ci_installations` (id, agentId, repo, targetType, installedAt) + `ci_runs` (id, ciInstallationId, prNumber, ranAt, status, findingsCount, costUsd, githubUrl, source). **No `workspace_id` (either), no `workflow_version`.** Both wired into barrel `schema.ts:24,47,94-95`. Add `workspaceId: uuid('workspace_id').notNull().references(...)` (both) + `workflowVersion: integer('workflow_version').notNull().default(1)` (ciInstallations) → regenerate.
- **COLLISION:** sibling `../devdigest-review` (Feature A) is also at `0022` and will want `0023` → coordinate the number before `db:generate`.

## Actionable summary for the planner
- **R1:** build ncc bundle during export/bulk-update behind an injected bundler adapter; no prebuilt/vendored copy; gitignore fix not required.
- **R2:** add 4 Actions methods to `GitHubClient` + Octokit + Mock; commit/PR path already exists.
- **R3:** generated workflow uploads `devdigest-result.json` as an artifact; ingest downloads it.
- **R4:** workflow calls `node .devdigest/runner/index.js` with the env table above; fork-skip; exit-code = check signal.
- **R5/R6:** mirror `blast` + `reviews` review-all (server); AgentEditor TABS + `ci-runs` page + NAV + `ci.json` copy + `useBlast` hook (client); design HTML not usable.
- **R7:** `0023` migration (workspace_id ×2 + workflow_version); coordinate number with Feature A.
