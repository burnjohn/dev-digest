# Development Plan — Phase 3.4: `site.yml` + `pages.yml` CI workflows

**Execution mode:** multi-agent (lightweight — no separate content-review
pass; verification is command-based/manual, run by the orchestrating
session, since GitHub Actions cannot be executed locally)

## Context

Sub-plans 3.1–3.3 built `scripts/build-index.mjs` and the full `site/` SPA
locally. This sub-plan (3.4 of 4, last of Phase 3) wires the two GitHub
Actions workflows the architecture spec's repository layout already
reserves (`docs/specs/marketplace-extraction/architecture.md`
repository-layout tree): `.github/workflows/site.yml` (PR-time: does the
catalog build?) and `.github/workflows/pages.yml` (post-merge: rebuild +
publish to GitHub Pages). Neither workflow file exists yet in this repo
(confirmed: `.github/workflows/` directory does not exist as of this
phase). `.github/workflows/validate.yml` (schema validation + generalized
behavior evals) is **not** part of this sub-plan or this phase — it
belongs to a separate initiative validating `plugins/**` content, and per
promt #16's explicit requirement, `site.yml` must be visually and
mechanically separate from it so a red site-build never reads as a
plugin-content failure or vice versa.

Working directory: `/Users/viptech/dev/ai agent/dev-digest-ai-marketplace`.

## Modules involved

`.github/workflows/**` inside `dev-digest-ai-marketplace` only. No
`dev-digest/**` module touched.

## Constraints

From `docs/specs/marketplace-extraction/architecture.md`:

- **`site.yml` is a separate job/workflow from `validate.yml`, on
  purpose** (architecture.md:453-457, promt #16): a PR's UI must clearly
  distinguish "does the catalog site build" from "does the plugin/skill
  content pass schema+behavior checks." Since `validate.yml` does not
  exist yet in this repo (out of scope for this phase entirely — it
  belongs to whatever initiative implements schema validation +
  generalized behavior evals), this sub-plan only needs to make sure
  `site.yml` is its own standalone workflow file with its own name/job
  name, not appended as an extra job inside some other file — there is no
  existing `validate.yml` to accidentally merge into today, but the
  workflow's `name:` field and job name must still read clearly on its own
  (e.g. `name: Site build`) so a future `validate.yml` addition doesn't
  need this file restructured.
- **`site.yml` runs on PRs, builds index + site, does not publish**
  (architecture.md:442-457, Build → catalog publish flow diagram): trigger
  on `pull_request` (paths touching `scripts/build-index.mjs`,
  `site/**`, `plugins/**`, `.claude-plugin/marketplace.json` — a path
  filter keeps this from re-running on unrelated doc-only PRs, though a
  simpler no-path-filter version that always runs is also acceptable if
  the implementer judges path-filtering adds more maintenance risk than
  value; document whichever choice is made). Steps: checkout, setup Node
  (matching the local Node major version already in use — v24 per
  `node --version` confirmed in 3.1 — or a documented LTS choice),
  `npm ci` at repo root, `npm run build:index`, `npm test` at repo root
  (3.1's build-index tests), then `cd site && npm ci && npm test && npm
  run build` (3.2/3.3's component tests + production build). Do **not**
  add a deploy/publish step here — that is `pages.yml`'s job.
- **`pages.yml` runs on merge to `main`, rebuilds, publishes `site/dist`**
  (architecture.md:442-457): trigger on `push` to `main` (same path filter
  reasoning as above, or none). Steps: the same build sequence as
  `site.yml` (checkout, Node setup, `npm ci`, `npm run build:index`,
  `cd site && npm ci && npm run build`), then use the standard GitHub
  Pages deploy actions
  (`actions/configure-pages`, `actions/upload-pages-artifact` pointed at
  `site/dist`, `actions/deploy-pages`) with the `pages: write` /
  `id-token: write` permissions block GitHub Pages deployment requires.
- **No documented `--strict` flag for `claude plugin validate`**
  (architecture.md:289-291, lab step 7's correction) — irrelevant to this
  sub-plan directly (this sub-plan touches no `claude plugin validate`
  invocation), noted here only so the implementer does not accidentally
  add one while writing CI YAML that happens to also run plugin
  validation steps; if this sub-plan's `site.yml` is later asked to also
  run `claude plugin validate .` (not currently in scope — that belongs to
  `validate.yml`), it must not add a `--strict` flag.
- **The actual GitHub Pages deploy step can only be fully proven after a
  real merge to `main` and GitHub Pages being enabled in the repository's
  own Settings** (architecture spec Overview: this is a target
  architecture for a repo that exists but where Pages hasn't necessarily
  been turned on yet) — this sub-plan can write and locally lint
  `pages.yml`, but the orchestrating session (which has `gh`/GitHub access
  this implementer does not) is responsible for confirming the repository
  Settings → Pages source is set to "GitHub Actions" and that a real
  merge triggers a real deployment; this is explicitly **not** something
  the implementer agent can verify from inside a sandboxed session with no
  Bash/network access to GitHub.
- **English-only prose** in workflow `name:`/step names/comments
  (architecture.md:587-591).
- **No secrets committed** — GitHub Pages deploy via `actions/deploy-pages`
  uses the automatic `GITHUB_TOKEN`/OIDC token, not a manually-provisioned
  secret; do not add any `secrets.*` reference beyond the automatically
  provided ones.
- **npm everywhere** (Stack) — `npm ci`, not `pnpm`/`yarn`, in every CI
  step.

## Skills to apply (implementer will use)

- No package-specific skill (`fastify-best-practices`,
  `drizzle-orm-patterns`, etc.) applies to GitHub Actions YAML directly.
  `security` is worth a light pass: confirm the workflow's permissions
  block is least-privilege (`pages: write`/`id-token: write` only on the
  `pages.yml` job that needs it, not repo-wide `contents: write` unless
  actually required) and that no secret is referenced beyond the
  automatic token.

## Ordered steps

1. **Write `.github/workflows/site.yml`** — PR-triggered workflow: single
   job (e.g. `build-site`) that checks out the repo, sets up Node, runs
   `npm ci` at root, `npm run build:index`, `npm test` at root, then
   `site`'s own `npm ci && npm test && npm run build`. No deploy step.
   Name the workflow and job clearly (e.g. `name: Site build`) so a PR's
   checks list reads unambiguously, distinct from any future
   `validate.yml` entry.
2. **Write `.github/workflows/pages.yml`** — `main`-push-triggered
   workflow: same build sequence as `site.yml` (checkout, Node setup,
   `npm ci`, `npm run build:index`, `cd site && npm ci && npm run build`),
   plus the GitHub Pages deploy steps
   (`actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`
   pointed at `site/dist`, `actions/deploy-pages@v4` — or whatever the
   currently-current major versions of these actions are; the implementer
   should confirm current major versions via a quick check rather than
   assume these exact numbers are still current) with a `permissions:
   { pages: write, id-token: write }` block and an `environment:
   github-pages` block per GitHub's documented Pages-via-Actions pattern.
3. **Cross-check both workflows' build steps stay in sync** with 3.1's
   `npm run build:index`/`npm test` and 3.2/3.3's `site`'s own
   `npm ci`/`npm test`/`npm run build` scripts — if any of those script
   names differ from what 3.1–3.3 actually landed (verify against the
   real `package.json`/`site/package.json` files at the time this sub-plan
   runs, not this plan document's assumed names), the workflow files must
   match the real script names, not this plan's placeholder names.
4. **Update root `README.md`** (brief addition, not a rewrite) with a
   short "CI" or "Site" section pointing at `site.yml`/`pages.yml` and
   noting the local-equivalent commands from 3.1–3.3's test plans, so a
   future contributor can reproduce CI locally without reading the YAML.

## Test plan

GitHub Actions workflows cannot be executed locally by the implementer or
verified by a sandboxed session with no GitHub network access. Verification
here is necessarily staged:

- **Static check (implementer or orchestrating session, no GitHub access
  needed):** both YAML files parse as valid YAML (e.g.
  `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))"` or any
  equivalent linter) and every `npm run <script>` step name referenced in
  the workflow actually exists in the corresponding `package.json`'s
  `scripts` block — cross-check by reading both `package.json` files, not
  by running them.
- **Real CI run (orchestrating session only, requires `gh`/git push
  access this implementer does not have):** open a PR that touches
  `site/**` or `scripts/build-index.mjs`, confirm `site.yml` shows up as
  its own separate, clearly-named check distinct from any other workflow,
  and goes green. After merge to `main`, confirm `pages.yml` runs and
  (assuming GitHub Pages is enabled in repo Settings — a prerequisite
  outside this plan's control) the site becomes reachable at its
  `https://viptech.github.io/dev-digest-ai-marketplace/` URL, matching the
  lab's own end-of-lab check ("GitHub Pages показує актуальний каталог").
- This real-CI verification step is explicitly the orchestrating session's
  responsibility, not the implementer's, per the confirmed
  no-Bash-for-implementer constraint and the fact that only the
  orchestrating session holds `gh`/repository-admin capability in this
  workflow.

## Out of scope

Architecture and security review are not part of this plan or the
implementer's job. Enabling GitHub Pages in the repository's own Settings,
opening the PR, merging it, and confirming the live deployed URL are
explicitly the orchestrating session's manual follow-up (as they were for
Phase 2's PR-opening steps), not something this plan's implementer can
complete from inside a sandboxed session. `validate.yml` (schema
validation + generalized behavior evals) is a separate initiative entirely
and is not touched by this sub-plan.
