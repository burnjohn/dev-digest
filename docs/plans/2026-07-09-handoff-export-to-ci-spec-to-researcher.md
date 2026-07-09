# Handoff — Feature B "Export to CI": SPEC ✅ → RESEARCHER (2026-07-09)

> Open this at the start of the next session. Stage `spec` is DONE; the next stage
> is `researcher`. Dialogue with the user in **Ukrainian**; artifacts (spec, plan,
> research report, code) stay **English**. The user commits — never commit yourself.
> Never restart the user's `:3001`/`:3000` — pause and warn instead.

Worktree: `F:\Data\Neoversity_ai\devdigest-ci`, branch `feat/export-to-ci`.

---

## 1. What just happened (spec stage)

`spec-creator` refined the existing draft **in place** into the final Feature B spec:

- **File:** `docs/feature-requirements/2026-07-09-ci-agent-runner-pipeline.md`
- **Status:** `draft` → **`ready-for-planning`**
- **AC count:** **48** (AC-1–AC-32 unchanged verbatim; AC-33–AC-48 added).
- **Index updated:** `docs/feature-requirements/README.md`.

New material folded in (from the 5 wizard screenshots + user decisions):

| ACs | Topic |
|---|---|
| AC-33–AC-39 | 4-step Export Wizard: Target (GHA-only functional) → Preview (only workflow editable, memory file always listed even if empty, bundled runner always shipped) → Configure (triggers + post-as) → Install (PR **or** zip, both record an installation) |
| AC-40–AC-42 | Bulk "Update CI config" (republish to ALL active installations, in-place, no new PRs, per-repo outcome); staged "Fail CI on" (no repo write until next export/bulk) |
| AC-43–AC-44 | CI Runs columns: PR·repo·agent·verdict·findings·cost·duration·Actions-link; verdict = run `status`, findings = total + severity breakdown on demand |
| AC-45–AC-47 | Per-installation **workflow-version counter** (additive, like AC-28); CI tab shows repo·platform·last-status·version + active-installation count |
| AC-48 | Bulk-update rate limit (2/min/workspace, same as export) |

### User decisions locked this stage (do not re-litigate)
1. **"Update CI config" = bulk republish**, no wizard — loops the single-installation update-in-place (AC-5/AC-10) across all active installations; never opens new PRs; per-repo success/failure.
2. **Workflow version = INCLUDED** (user overrode the agent's instinct to drop it) — the requirements explicitly ask for it on the CI tab.
3. **"Fail CI on"** only stages on the agent; **Preview** edits only the workflow file and they win over later Configure toggles; **CI Runs verdict** = status; **zip** still creates a tracked installation.
4. **§11 runner-bundle sourcing** = deliberately LEFT OPEN for the researcher (see §4 below).

---

## 2. Scope boundary (worktree B) — keep the researcher inside this

- **IN scope:** server `ci/` module + its routes (absent today), the CI Runs page, the agent CI tab, and ingest that writes results back into `agent_runs`/`ci_runs` with `source='ci'`.
- **OUT of scope:** the multi-agent runs service and the PR feed (that's parallel **Feature A** in `../devdigest-review`), any change to the `agent-runner` package itself, installing a GitHub App, enforcing branch-protection merge-blocking.

---

## 3. Current state of the ground

| Layer | State |
|---|---|
| Contracts `server/src/vendor/shared/contracts/eval-ci.ts` | ✅ frozen — `AgentManifest`, `CiTarget`, `CiFile`, `CiExportInput`, `CiInstallation`, `CiExport`, `CiRunStatus`, `CiRun`, `CiResultArtifact` |
| DB `server/src/db/schema/ci.ts` | ⚠️ `ci_installations`, `ci_runs` exist, EMPTY, **no `workspace_id`, no `workflow_version`** |
| Migrations `server/src/db/migrations/` | highest = **`0022_agent_version_provenance.sql`** → Feature B's next is **`0023_*`** (COORDINATE numbering with Feature A) |
| `agent-runner/` package | ✅ built + tested (23/23); ships as `.devdigest/runner/index.js`; reads secrets from `process.env` by design |
| Server `modules/ci/` | ❌ absent (confirmed — no dir) |
| Client CI tab / CI Runs page | ❌ absent (AgentEditor has Config/Skills/Context/Evals/Stats; global nav has a "CI Runs" item) |

### Additive contract/schema touchpoints the spec introduces (all additive, never repurpose)
1. `workspace_id` on **both** `ci_installations` and `ci_runs` (AC-28).
2. **`workflow_version`** counter on `ci_installations` (AC-45), + optional field on the `CiInstallation` shape.
3. **Disconnect** request/response shape (new).
4. **Trigger-a-check** request/response shape (new).
5. **Bulk-update per-installation outcome** list shape (AC-41, new).
6. **PR-vs-archive** distinction on the Install response (AC-39, new).
7. **Repo-identify** approach: keep `repo` as `owner/name` string; carry the real repo reference via the endpoint path, not the body (or additive optional field if unavoidable).

---

## 4. Researcher mandate — the questions to answer (with the §11 one first)

Run the `researcher` agent with the spec as input. Return a report with `file:line` citations and explicit "Not Found" gaps. Priority questions:

- **R1 (blocking — §11 / AC-37): How does the server obtain the built `agent-runner/dist/index.js` bytes to embed in every export?**
  Investigate: is `dist/index.js` present on disk now? Is `ncc` build wired into any automated workflow? Resolve the **git-ignore contradiction** (root `.gitignore` tries to force the runner dist committed with a "must be committed" comment, but `agent-runner/.gitignore` currently wins and excludes it). Recommend one of: build-during-export / vendor-at-server-build / prebuilt-commit. This is the #1 thing to de-risk before planning.
- **R2 (producer): Where is the "atomic multi-file commit + open/reuse PR" capability** the spec says already exists? (likely a `GitHubClient` adapter / port in `server/src/vendor/shared/adapters.ts` + `server/src/adapters/`). Confirm it can (a) atomically commit N files to a `devdigest/ci` branch and open/reuse a PR, and (b) whether it already covers **ingest's** needs — list recent workflow runs + download the result artifact. If ingest's GitHub calls don't exist, name the exact gap.
- **R3 (ingest seam): How is `devdigest-result.json` made retrievable after a run?** Read `agent-runner/src/` — is it uploaded as a GitHub Actions **artifact** (download via Actions API) or committed as a file? This decides the ingest retrieval mechanism (AC-21/AC-22).
- **R4 (workflow generator): The exact env-var + CLI contract `agent-runner` reads** (at minimum `OPENROUTER_API_KEY`, `GITHUB_TOKEN`, the agent slug, the post-as mode; plus the real invocation path `.devdigest/runner/index.js`). The generated `.github/workflows/devdigest-review.yml` must satisfy it byte-exactly (note: screenshot's `runner.mjs` + `devdigest/review-action@v1` are editable placeholders — the real target is the self-contained bundled runner).
- **R5 (server patterns to mirror):** module scaffold (`src/modules/AGENTS.md`), routes+Zod via `fastify-type-provider-zod`, adapters via `app.container` (never import concrete classes), workspace scoping (mirror `modules/blast/`), the **2/min per-workspace rate-limit + `scheduleNext` + detached child-logger** pattern from `modules/reviews/` `review-all` (reuse for AC-15/26/48).
- **R6 (client patterns):** how to add a **CI tab** to `client/src/app/agents/[id]/_components/AgentEditor/`; how to add the **CI Runs page** under `client/src/app/` (global nav already has the item); the TanStack Query hook pattern (e.g. `useBlast`); and the design tokens / component styles for the wizard **modal** + CI tab from `F:\Data\Neoversity_ai\DevDigest Design standalone.html` (screens N12 Export Wizard, N13 CI Runs).
- **R7 (migrations):** confirm `0023` is the next free number here AND is not claimed by Feature A; how `workspace_id` + `workflow_version` columns get added (`schema/ci.ts` edit → `pnpm db:generate` → review → `pnpm db:migrate`).

---

## 5. Worktree A/B coordination (carry into every later stage)

Sibling folders under `F:\Data\Neoversity_ai\`: `dev-digest` (base), `devdigest-review` (Feature A, `feat/multi-agent-review`), `devdigest-ci` (Feature B, this one).

- **spec/researcher/plan/typecheck/hermetic-tests:** no conflict — proceed freely in parallel.
- **Migrations:** both worktrees write the SAME dev DB. Feature A adds its own `NNNN-*.sql` (around `multi_agent_runs`); Feature B adds `0023_*` (workspace_id + workflow_version). **Numbers must not collide** — confirm Feature A's next number before `db:generate`.
- **Seed:** use non-colliding IDs/slugs.
- **Live dev servers:** both want `:3001`/`:3000` + one Postgres → only **one worktree live at a time**. For demo/verify keep live in a single worktree; run the live worktree's `db:migrate` before switching.

---

## 6. Commit (USER does this — spec stage change)

Two files changed, both docs-only:
- `docs/feature-requirements/2026-07-09-ci-agent-runner-pipeline.md`
- `docs/feature-requirements/README.md`

Suggested message:

```
docs(spec): finalize Export-to-CI spec (Feature B) — wizard UI + bulk update + workflow version

Refine SPEC-2026-07-09-ci-agent-runner-pipeline from draft to ready-for-planning.
Add 16 ACs (AC-33..48) for the 4-step Export Wizard (Target/Preview/Configure/
Install), the CI tab's bulk "Update CI config" republish + staged "Fail CI on",
a per-installation workflow-version counter, and the CI Runs column set. AC-1..32
unchanged. The §11 runner-bundle sourcing question is left as an open technical
item for the researcher.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## 7. Can the next stage start in a fresh session?

**Yes.** `researcher` needs only: this handoff + the spec file + the pointers in §3–§4.
Nothing in memory, no running server, no DB state required. Launch `researcher`
with the §4 question list.

Related memory: `lesson07-parallel-implementation-demo`, `ci-agent-runner-wiring-gap`.
