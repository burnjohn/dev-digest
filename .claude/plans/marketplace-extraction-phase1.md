# Development Plan — DevDigest AI Marketplace extraction: Phase 1 (Repo & structure)

**Execution mode:** single-agent

> **WORKING DIRECTORY FOR EXECUTION:** `/Users/viptech/dev/ai agent/dev-digest-ai-marketplace`
> — **not** `dev-digest`. This is a separate, standalone git repository (already
> cloned locally, empty, with `origin` pointing at
> `https://github.com/viptech/dev-digest-ai-marketplace.git`, no commits yet, no
> default branch on GitHub yet). Nothing in the `dev-digest` repo is touched by
> executing this plan. `dev-digest`'s `CLAUDE.md`, `TESTING.md`, onion
> architecture / DI conventions, and package-manager-per-folder table do **not**
> apply to the new repo — it will grow its own `CLAUDE.md` in a later phase, not
> this one.

## Context

L08's hands-on lab ("Plugins + Cost Engineering + Team Rollout") requires
extracting the reusable half of DevDigest's `.claude/` harness into a
standalone, installable Claude Code plugin marketplace repo,
`dev-digest-ai-marketplace`. The full initiative spans lab steps 1–11
(structure → extraction → dependency graph → plugin assembly → marketplace
registration → GitHub Pages catalog → validation → cost baseline → release →
install-elsewhere → update/rollback). This plan covers **only lab steps 1–2**
("Створюємо окремий repository" and "Відділяємо переносиме від локального") —
i.e., laying down the top-level repo skeleton, root tooling files, and making
the very first commit/push into the already-existing empty GitHub remote. It
deliberately does **not** touch plugin contents, `marketplace.json`,
`plugin.json` contracts, the GitHub Pages site, evals, cost baseline, or
releases — those are later phases per
`docs/specs/marketplace-extraction/architecture.md`.

The architecture spec
(`/Users/viptech/dev/ai agent/dev-digest/docs/specs/marketplace-extraction/architecture.md`)
is the approved source of truth for scope and layout; 6 of 8 open questions
are resolved inline in that document, one is deferred to 1.1.0+ (out of scope
for this phase entirely — `doc-writer`/`test-writer` re-inclusion), and the
install-target question is already resolved and irrelevant to this phase
(install happens in a later phase, against
`/Users/viptech/dev/ai agent/plugin-install-target`).

Five additional scaffolding decisions were confirmed directly by the owner for
this phase (not covered by the architecture spec, which is silent on license,
first-commit branching, and stub-file depth):

1. **License:** MIT, added in this phase as `LICENSE`.
2. **First commit target:** pushed directly to `main` (no PR for the init
   skeleton) — acceptable because the GitHub repo is currently fully empty
   (`isEmpty: true`, no default branch yet), so there is no existing `main` to
   protect yet.
3. **Stub-file depth:** every "content later" doc (`CONTRIBUTING.md`,
   `docs/PLUGIN-GUIDELINES.md`, `docs/SITE-SPEC.md`, `docs/SECURITY.md`,
   `docs/RELEASES.md`, `docs/COST-BASELINE.md`) gets only a title + 1–2
   sentences stating the file's purpose and "details: TBD in Phase N" — no
   invented policy text.
4. **`CODEOWNERS`:** a single placeholder line, `* @viptech`.
5. **Root `package.json`:** minimal — `name`, `private: true`, `version:
   "0.0.0"`, no dependencies, placeholder `scripts` (e.g. `"build:index": "echo
   TODO"`) — real deps (`marked`, `dompurify`, `minisearch`) and a working
   `build-index.mjs` arrive in Phase 3 alongside `site/`.

## Modules involved

This plan touches **only** the new standalone repository
`dev-digest-ai-marketplace` (root-level scaffolding: directories, stub docs,
`CODEOWNERS`, `LICENSE`, root `package.json`, `.gitignore`, `README.md`,
first commit, first push). It does **not** touch any `dev-digest` module
(`server/`, `client/`, `reviewer-core/`, `e2e/`, `server/src/vendor/shared`) —
those are read-only sources this phase copies nothing from yet (extraction of
actual plugin content is Phase 2).

## Constraints

- Architecture spec, "Repository layout (target, per lab step 1)" — the exact
  top-level tree this phase must produce (`docs/specs/marketplace-extraction/architecture.md:151-178`).
- Architecture spec, Stack section — **package manager is npm everywhere in
  this new repo** (root and future `site/`), confirmed by the owner
  (`docs/specs/marketplace-extraction/architecture.md:524-526`). This overrides
  `dev-digest`'s own mixed pnpm/npm convention — irrelevant here since this is
  a different repo entirely.
- Architecture spec, Invariants — "keep every committed file's prose in
  English... no Ukrainian comments anywhere in this repo, verified before each
  PR that touches extracted content"
  (`docs/specs/marketplace-extraction/architecture.md:587-591`). Applies to
  every stub file created in this phase too.
- Architecture spec, Invariants — "never publish... IF any committed file...
  contains an absolute local filesystem path or a literal secret/credential
  value, THEN CI (shall) fail the PR before merge" (AC-8,
  `docs/specs/marketplace-extraction/architecture.md:636-639`). No absolute
  local paths (e.g. `/Users/viptech/...`) may appear in any committed file in
  this phase — including README/CONTRIBUTING stub prose. `.gitignore` may
  reference relative build-output paths only.
- Architecture spec Overview — "no repo-creation step needed, only cloning" —
  already done; confirmed the local clone at
  `/Users/viptech/dev/ai agent/dev-digest-ai-marketplace` exists, is a git
  repo, has `origin` set, and has zero commits
  (`docs/specs/marketplace-extraction/architecture.md:27-33`, verified live via
  `git status`/`git remote -v` on 2026-08-24).
- Lab step 1 acceptance bar: "новий автор може підготувати pull request, не
  питаючи в чаті, де мають лежати файли й що запустити" — even a stub
  `CONTRIBUTING.md` should name the folders (`plugins/`, `docs/`, `scripts/`,
  `site/`) so this bar is trending toward satisfied, even though full
  dependency-rule/PR-checklist content is deferred (`L08/04-hands-on-lab.md:64`).
- Root `dev-digest` CLAUDE.md's conventions (onion architecture, snake_case
  wire contracts, `server`/`client`/`reviewer-core` package-manager table,
  do-not-touch list) are **specific to the `dev-digest` repo** and do not
  apply to `dev-digest-ai-marketplace` — noted explicitly so this is not
  mistakenly carried over during execution.
- GitHub remote state (verified 2026-08-24 via `gh repo view`): `isEmpty:
  true`, `defaultBranchRef.name: ""` — no default branch exists yet on the
  remote, so the first push will create `main` from the local commit.

## Skills to apply

- **`mermaid-diagram`** — only if the root `README.md` includes an
  architecture/overview diagram (e.g. reproducing or linking the dependency
  graph already drawn in the architecture spec's Data flow section). Optional;
  use only if a diagram is actually added, not required to force one in.
- No other `dev-digest` project skill applies. This phase writes no
  application code, no React/Next/Fastify/Drizzle/Zod/TypeScript logic, no
  security-sensitive auth/input-handling code — it is pure directory/file
  scaffolding in a brand-new, empty repository. `onion-architecture`,
  `security`, `typescript-expert`, etc. are not relevant until Phase 2+ when
  actual plugin/agent/skill content and the `site/` SPA are built.

## Ordered steps

All steps run with working directory
`/Users/viptech/dev/ai agent/dev-digest-ai-marketplace`.

1. **Verify starting state** (sanity check before creating anything):
   `git status` (expect "No commits yet"), `git remote -v` (expect `origin`
   pointing at `https://github.com/viptech/dev-digest-ai-marketplace.git`),
   `pwd` to confirm location. Do not proceed if any of these differ from
   expectations — stop and re-confirm with the user rather than guessing.

2. **Create top-level directories** exactly matching the architecture spec's
   layout (`docs/specs/marketplace-extraction/architecture.md:151-178`):
   - `.claude-plugin/` — leave empty in this phase (no `marketplace.json` yet
     — that's Phase 2/lab step 5). Add a `.gitkeep` only if needed to commit
     an otherwise-empty directory (git does not track empty dirs).
   - `.github/workflows/` — create as empty/placeholder directory only; do
     **not** write `validate.yml`, `site.yml`, or `pages.yml` content in this
     phase (that's Phase 2/3, per the task boundary). Use `.gitkeep` or
     defer creating this directory until a workflow file exists in a later
     phase — whichever keeps the directory out of the tree cleanly; note this
     decision inline in the commit if `.github/workflows/` ends up empty and
     thus absent from the commit (git tracks files, not empty dirs — an empty
     `.github/workflows/` simply won't appear in the tree until Phase 2/3
     adds a workflow file, and that is fine/expected).
   - `plugins/engineering-paved-path/`, `plugins/research-tools/`,
     `plugins/architecture-review/`, `plugins/sdd-engineering/` — each gets a
     minimal stub `README.md` only (title + one sentence naming the plugin's
     eventual purpose per the architecture spec's per-plugin composition
     table, e.g. "Shared engineering-practice skills (React, testing,
     Next.js, Fastify, architecture, Drizzle, PostgreSQL, Zod, TypeScript,
     security, Mermaid). Full content: Phase 2."). No `.claude-plugin/`,
     `skills/`, or `agents/` subdirectories yet — those are Phase 2.
   - `docs/` — create with five stub files: `PLUGIN-GUIDELINES.md`,
     `SITE-SPEC.md`, `SECURITY.md`, `RELEASES.md`, `COST-BASELINE.md`. Each:
     one `#` title matching the filename's purpose + 1–2 sentences describing
     what the file will eventually contain (per architecture spec's
     "Contribution/security/release documentation contracts" section,
     `docs/specs/marketplace-extraction/architecture.md:382-399`) + a closing
     line "Full content: Phase 2/3 (see architecture.md)." Do not invent
     policy text (no fabricated SemVer rules, no fabricated security
     policy) — this is the owner-confirmed scope for this phase.
   - `scripts/` — empty in this phase; `build-index.mjs`, `release.sh`,
     `rollback.sh` are Phase 2/3 deliverables. Same empty-directory caveat as
     `.github/workflows/` — will not appear in the commit until a file lands
     inside it.
   - `site/` — empty in this phase (SPA scaffold is Phase 3). Same caveat.

3. **Create root scaffolding files:**
   - `CODEOWNERS` — single line: `* @viptech`.
   - `CONTRIBUTING.md` — title + 1–2 sentences: this file will describe
     plugin folder structure, manifest field reference, dependency rules,
     pre-PR checks, and PR checklist (per lab step 1 / architecture spec);
     name the top-level folders (`plugins/`, `docs/`, `scripts/`, `site/`) so
     a contributor has at least minimal orientation now. "Full content: Phase
     2." Do not draft the actual checklist/rules yet.
   - `README.md` — repo root README: what this repo is (one paragraph, can
     paraphrase the architecture spec's Overview — separate repo, four
     plugins, marketplace manifest, GitHub Pages catalog), links to
     `docs/*.md` stub files, and a "Status: scaffolding only, Phase 1 of the
     extraction — see `viptech/dev-digest` architecture spec for the full
     plan" note so a reader isn't confused by empty `plugins/*` folders.
     Optionally include a small Mermaid diagram (use `mermaid-diagram` skill)
     reproducing the dependency graph from the architecture spec's Data flow
     section if it adds clarity — optional, not required.
   - `LICENSE` — standard MIT license text, copyright line using the owner's
     name/GitHub handle (`viptech`) and current year (2026). Use the
     canonical MIT template text.
   - `.gitignore` — cover: `node_modules/`, `site/dist/`, `site/public/*.json`
     and `site/public/bodies/` (generated catalog output, per architecture
     spec's "regenerate-on-build, not committed" contract,
     `docs/specs/marketplace-extraction/architecture.md:294-311`), common
     OS/editor cruft (`.DS_Store`, `.vscode/` optional), `*.log`. Keep it
     minimal and accurate to what actually exists today — don't pre-ignore
     paths that don't apply yet if uncertain, but the `site/public/*` and
     `node_modules/` entries are safe to add now since they're already
     specified in the architecture contract.
   - `package.json` (root) — minimal, npm, no dependencies:
     ```json
     {
       "name": "dev-digest-ai-marketplace",
       "version": "0.0.0",
       "private": true,
       "description": "Claude Code plugin marketplace extracted from DevDigest's engineering harness",
       "license": "MIT",
       "scripts": {
         "build:index": "echo TODO: implement in Phase 3 (scripts/build-index.mjs)"
       }
     }
     ```
     No `package-lock.json` commit required yet since there are no
     dependencies to lock — running `npm install` against this file produces
     an empty/no-op lockfile; only run it if verifying the file parses, don't
     treat lockfile generation as mandatory for this phase.

4. **Self-verification before committing:**
   - `grep -rn "/Users/" .` (excluding `.git/`) across all newly created
     files — must return nothing (AC-8 constraint: no absolute local paths in
     any committed file).
   - Confirm no file contains Ukrainian prose (visual scan of each stub file
     — all English per the Invariants constraint).
   - `git status` / `git add -A -n` (dry run) to confirm exactly the intended
     files are staged — no stray `.DS_Store`, no accidental `node_modules/`.
   - Diff the created top-level tree against the architecture spec's
     "Repository layout" block to confirm nothing is missing or renamed.

5. **First commit and push:**
   - `git add -A`
   - `git commit -m "Scaffold dev-digest-ai-marketplace repo structure"` (or
     similar concise message — English, no attribution footer per user's
     global instructions).
   - `git branch -M main` if the local branch isn't already named `main`
     (check first with `git branch --show-current`).
   - `git push -u origin main`.
   - Confirm via `gh repo view viptech/dev-digest-ai-marketplace --json
     isEmpty,defaultBranchRef` that `isEmpty` is now `false` and
     `defaultBranchRef.name` is `main`.

## Test plan

This phase has no application code, so there is no unit/integration test
suite to run (`TESTING.md` in `dev-digest` does not apply to this separate
repo, and no test framework has been introduced here yet — that arrives with
evals in a later phase). "Passing" for this phase means:

- `git log -1 --stat` on the new repo shows exactly one commit containing the
  full intended tree (directories + stub files listed in Ordered Steps 2–3).
- `git remote show origin` (or `gh repo view`) confirms the push succeeded
  and `main` is now the GitHub default branch.
- The `grep -rn "/Users/"` check (Ordered Steps 4) returns no matches.
- `node -e "require('./package.json')"` (or `npm pkg get name version`) run
  from the repo root parses `package.json` without error, confirming valid
  JSON.
- Manual diff of the committed top-level tree (`git ls-tree -r --name-only
  HEAD`) against the architecture spec's target layout
  (`docs/specs/marketplace-extraction/architecture.md:151-178`) — every listed
  path that can exist without a Phase-2+ content file present (i.e. every
  stub doc, `plugins/*/README.md`, `CODEOWNERS`, `CONTRIBUTING.md`,
  `README.md`, `LICENSE`, `.gitignore`, `package.json`) is present; empty
  directories with no file yet (`.claude-plugin/`, `.github/workflows/`,
  `scripts/`, `site/`) are expected to be absent from `git ls-tree` until a
  later phase adds their first file — this is not a failure, just how git
  represents empty directories.

## Out of scope

Architecture and security review are **not** part of this plan or the
executing agent's job — they belong to separate review agents, regardless of
execution mode. Also explicitly out of scope for this phase (deferred to
later phases per the architecture spec and task boundary): plugin content
(`skills/`, `agents/` inside any `plugins/*` folder), `.claude-plugin/
marketplace.json`, per-plugin `.claude-plugin/plugin.json`, GitHub Actions
workflow file contents (`validate.yml`, `site.yml`, `pages.yml`), the `site/`
SPA and `scripts/build-index.mjs` implementation, evals, cost baseline
measurement, releases/tagging, install-target rehearsal, and the 1.1.0
update/rollback rehearsal (lab steps 3–11).
