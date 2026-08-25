# Development Plan — Phase 3.1: `scripts/build-index.mjs` (catalog data build)

**Execution mode:** multi-agent (lightweight — no separate content-review
pass; verification is command-based, run by the orchestrating session, not
a dispatched review agent)

## Context

Phase 2 extracted and generalized the four plugins
(`engineering-paved-path`, `research-tools`, `architecture-review`,
`sdd-engineering`) into `plugins/**` and registered them in
`.claude-plugin/marketplace.json`. Phase 3 builds the GitHub Pages
discovery catalog described in
`docs/specs/marketplace-extraction/architecture.md` § "GitHub Pages catalog
contract". This sub-plan (3.1 of 4) builds the foundation every later
sub-plan depends on: the Node.js script that turns `plugins/**` +
`marketplace.json` into the JSON data files the SPA (3.2/3.3) will read.
Without real, non-fixture `index.json`/`releases.json`/`stats.json`/
`bodies/` on disk, the SPA sub-plans have nothing real to render or search.

Working directory for all steps: `/Users/viptech/dev/ai agent/dev-digest-ai-marketplace`
(a separate repo from `dev-digest`, where this plan file lives).

## Modules involved

This touches only the new `dev-digest-ai-marketplace` repo (not any
`dev-digest/**` package): root `scripts/build-index.mjs`, root
`package.json`, and the gitignored `site/public/*` output paths. No
`server`/`client`/`reviewer-core`/`e2e`/`shared` module in `dev-digest` is
touched.

## Constraints

From `docs/specs/marketplace-extraction/architecture.md`:

- **Real-data-only (promt #11, architecture.md:349-352):** `index.json`
  must be generated exclusively from what exists in `plugins/` and
  `marketplace.json` at build time — no seed/demo/fixture data. This is the
  single most important constraint of this sub-plan; verify it by pointing
  the script at the actual `plugins/**` tree checked into this repo, not a
  test fixture directory.
- **Regenerate-on-build, gitignored (architecture.md:292-311):** outputs go
  to `site/public/{index.json,releases.json,stats.json,bodies/}`, already
  covered by `.gitignore` (confirmed: `site/public/*.json`,
  `site/public/bodies/`, `site/dist/` are already gitignored — do not
  re-add or commit generated output).
- **`plugin.json` is the composition source of truth**
  (architecture.md:205-211) — `marketplace.json` only carries `source` +
  catalog metadata; do not read component lists from `marketplace.json`,
  read each plugin's own `plugin.json`.
- **No framework for the build script** (architecture.md:519-520) — plain
  Node.js (confirmed `node --version` → v24.11.0 in this environment;
  native `fs`/`path`, no bundler).
- **Package manager is npm everywhere** in this repo (architecture.md
  Stack) — do not introduce pnpm/yarn lockfiles.
- **No git tags exist yet** in this repo (confirmed via `git tag -l` →
  empty output on 2026-08-25) — `releases.json` generation must not assume
  tags exist. Build the per-plugin version history from each
  `CHANGELOG.md`'s `## <version> — <title>` headings; treat tag lookup as
  best-effort/optional (e.g. via `git tag -l '<plugin>--v*'`, empty result
  tolerated, not an error) since tagging happens later in the lab sequence
  (lab step 9), not in this phase.
- **`${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_SKILL_DIR}` invariant** does not apply
  to `build-index.mjs` itself (it is not a plugin-shipped script, it lives
  at repo root and runs in CI/local dev, not inside an installed plugin) —
  do not add these env vars here; they matter only for scripts *inside*
  `plugins/**`.
- **English-only prose** (architecture.md:587-591) — comments, README
  updates, and console output in the script must be English.
- **No absolute local filesystem paths or secrets** committed
  (architecture.md AC-8) — the script must use paths relative to its own
  location (`import.meta.url` / `path.join(__dirname, ...)`), never a
  hardcoded `/Users/...` path.

From the hands-on lab (`04-hands-on-lab.md` Крок 6): local verification
sequence is `npm run build:index` at repo root, then
`cd site && npm ci && npm run build && npm run preview` (the `cd site`
half is out of scope for this sub-plan — site doesn't exist until 3.2 —
but `npm run build:index` at root must work standalone after this sub-plan
lands).

## Skills the implementer will use

- None of the catalog `.claude/skills/` entries map directly to "write a
  plain Node.js data-transformation script" (no framework skill applies —
  this is intentionally framework-free per Stack). The implementer should
  rely on ordinary Node.js `fs`/`path`/`gray-matter`-or-hand-rolled
  frontmatter parsing, not reach for a skill that doesn't fit.
- `security` skill is worth a light pass at the end: the script reads
  arbitrary repo Markdown and will later feed it to a browser (3.2/3.3) —
  confirm this sub-plan does not itself introduce an eval/exec of file
  content, and that no absolute path or secret leaks into generated JSON.

## Ordered steps

1. **Design the output shapes first, as a short comment block or a
   `scripts/build-index.types.d.ts` (optional, JSDoc is enough) at the top
   of `build-index.mjs`**, matching architecture.md's contract:
   - `index.json`: one entry per artifact (plugin / skill / agent), each
     carrying at minimum `type`, `id`, `name`, `description`,
     `pluginName`, `pluginVersion`, `keywords` (from `SKILL.md`/agent
     frontmatter if present, else `[]`), and a `bodyId` pointing at the
     matching file under `bodies/` used for MiniSearch's full-text fields
     (README body, `SKILL.md` body) per architecture.md:325-327.
     Dependency edges per plugin (`dependencies` from `plugin.json`) go on
     each plugin's own index entry — this is what 3.3's dependency-graph
     feature will consume, so the field name chosen here becomes that
     sub-plan's contract; document it in a short comment.
   - `releases.json`: per plugin, an array of `{ version, title, notes }`
     parsed from `CHANGELOG.md`'s `## <version> — <title>` headings
     (confirmed heading shape: `plugins/sdd-engineering/CHANGELOG.md:3`
     — `## 1.0.0 — Initial extraction`), newest first, plus (best-effort)
     any matching `<plugin>--v<version>` git tag if one exists.
   - `stats.json`: counts for the landing page — total plugins, total
     skills, total agents, per-plugin breakdown.
   - `bodies/`: one sanitized-at-render-time-later, **raw markdown** file
     per README/`SKILL.md`/agent-body source (sanitization with DOMPurify
     happens client-side at render time in 3.2, per
     architecture.md:327-332 — do not pre-sanitize here, just copy/extract
     the markdown body text, e.g. strip the YAML frontmatter fence from
     `SKILL.md`/agent files before writing the body file).
2. **Implement the plugin/component discovery walk** in
   `scripts/build-index.mjs`: read `.claude-plugin/marketplace.json` for
   the plugin list, then for each plugin read its own
   `plugins/<name>/.claude-plugin/plugin.json` (name, version, description,
   dependencies), `README.md`, `CHANGELOG.md`, `COMPATIBILITY.md`, and walk
   `skills/*/SKILL.md` (parse YAML frontmatter for `name`/`description`)
   and `agents/*.md` (same frontmatter shape, confirmed via
   `plugins/sdd-engineering/agents/spec-creator.md:1-11`) if those
   directories exist for that plugin (not every plugin has both — e.g.
   `engineering-paved-path` has `skills/` only, no `agents/`; confirmed via
   repo tree).
3. **Write the three JSON files + `bodies/` directory** to
   `site/public/` (create the directory if it does not exist — `site/`
   itself is empty until 3.2, but `site/public/` as a leaf directory must
   exist for `build-index.mjs` to write into; do not scaffold any other
   part of `site/` here, that's 3.2's job).
4. **Wire `npm run build:index`** in the root `package.json`: replace the
   current placeholder (`"build:index": "echo TODO: implement in Phase 3
   (scripts/build-index.mjs)"`) with `"build:index": "node
   scripts/build-index.mjs"`.
5. **Write `scripts/build-index.test.mjs`** using Node's built-in test
   runner (`node:test` + `node:assert`, zero new dependency, matches the
   "no framework" constraint) covering at minimum:
   - the four real plugins are all present in `index.json` with correct
     `type`/`pluginName` values (a real-data assertion, not a fixture —
     run the script against the actual `plugins/` tree in this repo, or a
     small isolated fixture tree under
     `scripts/__fixtures__/` if the implementer prefers full isolation —
     either is acceptable, but if a fixture tree is used it must be
     clearly labeled as fixture-only test scaffolding, never mistaken for
     the real `site/public/*` output);
   - a plugin with no `agents/` directory (e.g.
     `engineering-paved-path`) does not crash the walk and simply
     contributes zero agent entries;
   - `releases.json` parses `CHANGELOG.md`'s `## 1.0.0 — Initial
     extraction` heading shape correctly for all four plugins;
   - the script does not throw when no git tags exist (confirmed current
     state of this repo).
6. **Add a root `test` script** to `package.json`:
   `"test": "node --test scripts/*.test.mjs"`.

## Test plan

Run from repo root (`/Users/viptech/dev/ai agent/dev-digest-ai-marketplace`):

- `npm test` — expects all `node:test` cases in
  `scripts/build-index.test.mjs` to pass (green, no failures).
- `npm run build:index` — expects a clean exit (0) and the four files/dir
  (`site/public/index.json`, `site/public/releases.json`,
  `site/public/stats.json`, `site/public/bodies/`) to be written, non-empty,
  with `index.json` containing exactly 4 plugin entries plus one entry per
  skill/agent actually present under `plugins/**` at that commit (11 skills
  in `engineering-paved-path`, 3 skills in `sdd-engineering`, 4 agents in
  `sdd-engineering`, 1 agent each in `research-tools`/`architecture-review`
  — confirmed counts from the current repo tree) — no extra, no missing,
  no placeholder entries.

**Per the confirmed answer, the implementer agent is not expected to have
Bash access.** Both commands above are to be run by the orchestrating
session (which does have Bash) after the implementer's file changes land,
as manual verification — not as a self-verification step inside the
implementer's own turn. If `npm test`/`npm run build:index` fail, the
orchestrating session sends the concrete failure output back for a fix
round rather than assuming the implementer already confirmed green.

## Out of scope

Architecture review and security review are not part of this plan or the
implementer's job — they belong to separate review agents (or, per the
confirmed lightweight multi-agent mode for this phase, to the
orchestrating session's own command-based verification described above,
which stands in for a dispatched content-review pass since this sub-plan
is code, not agent/skill prose). Building the SPA that reads these JSON
files is 3.2's job, not this one.
