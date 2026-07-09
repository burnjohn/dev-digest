# Handoff — Feature B "Export to CI": PLAN ✅ → /implement (2026-07-09)

> Open this at the start of the `/implement` session. Dialogue with the user in **Ukrainian**;
> artifacts (code, commits) stay **English**. The user commits — never commit yourself.
> **Runtime isolation is mandatory** (see §Runtime below) — never assume `:3001`/`:3000`/`5432` is
> this worktree's.

Worktree: `F:\Data\Neoversity_ai\devdigest-ci`, branch `feat/export-to-ci`.

---

## 1. Pipeline status — planning fully done

| Stage | Status |
|---|---|
| spec | ✅ approved — `docs/feature-requirements/2026-07-09-ci-agent-runner-pipeline.md` (48 ACs; AC-13 re-scoped) |
| researcher | ✅ `docs/plans/2026-07-09-research-export-to-ci.md` (R1–R7, file:line grounded) |
| architecture-reviewer | ✅ 4 fits / 3 risks — all constraints folded into the plan |
| implementation-planner | ✅ `docs/plans/2026-07-09-export-to-ci-plan.md` (11 steps, 4 waves) |
| plan-verifier | ✅ found 2 ❌ + 2 ⚠️ → corrective planner pass → all 4 fixed → main re-read all 766 lines & confirmed |
| **NEXT** | **`/implement`** the plan |

---

## 2. The plan & how to execute it

**Plan:** `docs/plans/2026-07-09-export-to-ci-plan.md` — read it in full; it is self-contained (per-step owned paths, exact code sketches, Verify checklists, commit messages, AC mapping in §7, Testing Plan in §8).

**Execution mode:** multi-agent, **hard cap ≤5 parallel implementers per wave**:
```
Wave 1 (solo)      Step 1  — shared contracts + DB schema + migration 0023 + adapter port interfaces
Wave 2 (5 parallel) Steps 2–6 — GitHubClient+RunnerBundler+container · producer domain · ingest domain · client hooks+i18n · nav
Wave 3 (4 parallel) Steps 7–10 — export service · ingest service · CI tab+Wizard · CI Runs page
Wave 4 (solo)      Step 11 — routes + module registration + integration tests
```

**Model routing (user directive 2026-07-09):**
- **Implementer subagents → Sonnet** (`claude-sonnet-5`).
- **Final Architect + Reviewer/bug-review gate → Opus** (`claude-opus-4-8`).
- Intermediate gates (completeness, test-coverage) → default/Sonnet.
- Spawn each agent with the explicit `model` param (overrides the agent-def frontmatter). Also in the plan header.

**How to run:** invoke the `implement` skill on `docs/plans/2026-07-09-export-to-ci-plan.md`. It runs the implementer waves → completeness gate → architecture review → test coverage → bug review → final verification. Enforce the ≤5 cap and the model routing above when it spawns agents.

---

## 3. Runtime isolation — MANDATORY (plan §5)

Both worktrees now run **isolated** runtimes so they can be live simultaneously. This worktree (`devdigest-ci`) prefers, if free: `CLIENT_PORT=3010 · API_PORT=3011 · POSTGRES_PORT=5442 · DATABASE_NAME=devdigest_ci · compose project devdigest_ci` (`docker compose -p devdigest_ci up -d`).
- **Never hardcode** `3010/3011/5442/devdigest_ci/devdigest_review` into committed code, tests, shared configs, or docs — env-driven only.
- Final merged feature MUST run on **defaults** (client 3000 / API 3001 / Postgres 5432); new config needs safe defaults.
- **Pre-flight before any server/Docker:** check BOTH isolated (3010/3011/5442) AND default (3000/3001/5432 — sibling may hold them) ports; on conflict **STOP + report**; never test against an already-running server you don't own.
- **Pre-finalize every step:** `git diff --name-only` → `grep -R "3010\|3011\|5442\|devdigest_ci\|devdigest_review" <changed files>` — strip leaks. (This is already baked into every step's Verify checklist.)
- Each implementer's final report uses the §5 "Final response format" (ports/db/compose used + no-hardcode + default-compat confirmations).

**When the USER must bring things up — implement AI: PAUSE and hand the user the runbook below; never start servers/containers yourself (project rule: use the user's own processes).**

| Moment | Needs live |
|---|---|
| Wave 1 / Step 1 (`pnpm db:migrate`) | isolated Postgres :5442 + `devdigest_ci` DB + `DATABASE_URL` pointed at it |
| Typecheck + hermetic tests (Waves 2–3) | nothing |
| Integration `*.it.test.ts` (Step 11) | Docker **daemon** only (Testcontainers spins an ephemeral PG) — NOT the dev container |
| Verify / manual smoke (end) | API :3011 + web :3010 |

Bring-up runbook (verified — `docker compose -p devdigest_ci` does NOT isolate here: `docker-compose.yml` fixes `container_name: devdigest-postgres` + port `5432`):
```sh
docker run -d --name devdigest-postgres-ci -e POSTGRES_USER=devdigest -e POSTGRES_PASSWORD=devdigest -e POSTGRES_DB=devdigest_ci -p 5442:5432 -v devdigest_ci_pgdata:/var/lib/postgresql/data pgvector/pgvector:pg16
# server/.env (uncommitted): DATABASE_URL=postgres://devdigest:devdigest@localhost:5442/devdigest_ci · API_PORT=3011
# client/.env (uncommitted): NEXT_PUBLIC_API_BASE=http://localhost:3011
cd server && pnpm db:migrate && pnpm db:seed
cd server && pnpm dev                      # API :3011
cd client && pnpm exec next dev -p 3010    # web :3010 (package.json hardcodes 3000 — override on CLI, don't edit it)
```
Pre-flight: 5442/3011/3010 free AND :3000/:3001/:5432 not this worktree's (sibling may hold them). Full rationale + creds note in plan §5.

---

## 4. Locked decisions (do not re-litigate)

- **Runner bundle built during export** behind an injected `RunnerBundler` port (`ncc build`, fresh each export/bulk-update) — never a prebuilt/committed copy. (§11 spec, R1.)
- **One agent per repository (v1)**, flat `.devdigest/agents/<slug>.yaml`; `<slug>` frozen at first export (stable across renames). A second *different* agent to the same repo → 409. **AC-13 re-scoped; multi-agent-per-repo deferred** (§9 Out of Scope).
- **Ingest = uploaded GitHub Actions artifact**: the generated workflow MUST include `actions/upload-artifact@v4` (`name: devdigest-result` shared constant, `if: always()`, `if-no-files-found: ignore`); ingest downloads + `safeParse`s it; attribution by queried installation only (never file contents).
- **Migration `0023`** adds `workspace_id` (both tables) + `workflow_version`/`slug`/`triggers`/`post_as`/`workflow_contents`/`disconnected_at` (installations) + `github_run_id`/`repo`/`agent`/`duration_s`/`critical`/`warning`/`suggestion` (runs) — all additive, NOT NULL where noted, no backfill. **Re-verify `0023` is still free vs. the sibling `../devdigest-review` worktree before `pnpm db:generate`; use `0024` if taken.**
- **New deps:** `yaml` + `jszip` (user-confirmed).
- **Engineering principles are GATE criteria** (plan §4): **P1** — no load-bearing workaround (a hack needing a paragraph of justification = wrong code, simplify); **P2** — fix the generator/root cause, not the symptom. The architecture/reviewer gate must REJECT violations, not just note them.

---

## 5. One empirical unknown for the implementer
`GitHubClient.downloadArtifact` (Step 2): Octokit's `rest.actions.downloadArtifact` return shape (binary `data` vs. a redirect `url` to `fetch`) varies by version — the implementer must confirm against the installed `octokit@^4.0.3` and return a `Buffer` either way (Step 2 says so; leave a code comment).

---

## 6. Commit & session

- **User commits.** Per-step commit messages are in the plan (one per step). The planning-stage docs are uncommitted (see below).
- **Can `/implement` start in a fresh session?** YES — the plan is self-contained; only this handoff + the plan + runtime-isolation awareness are needed. No live server/DB state required to begin (Wave 1 is schema/contracts).
- After Wave 1 (schema/module registration) and before manual smoke tests, restart only **this worktree's own** API process — never the default ports or the sibling worktree's.

### Suggested commit for the planning-stage docs (user runs it)
```
docs(ci): finalize Export-to-CI plan (Feature B) — researched, arch-reviewed, verified

Add the research report, the 11-step/4-wave implementation plan (≤5 parallel,
Sonnet implementers / Opus final gate), and the plan→implement handoff. Resolve
the spec's §11 runner-bundle question (build-during-export behind a RunnerBundler
port) and re-scope AC-13 to v1 one-agent-per-repo (flat .devdigest/agents/<slug>.yaml;
multi-agent-per-repo deferred).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

Related memory: `lesson07-parallel-implementation-demo`, `worktree-runtime-isolation`, `engineering-principle-fix-the-process`, `ci-agent-runner-wiring-gap`.
