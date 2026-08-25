# Development Plan — Phase 6.1: Release sdd-engineering@1.0.0 (lab Крок 9)

**Execution mode:** multi-agent (same split as Phases 2–5) — `implementer`
writes/edits files only (`scripts/release.sh`, `scripts/rollback.sh`,
`docs/RELEASES.md`, both `CHANGELOG.md` fold-ins); it does not hold `Bash`
and never runs `git tag`, `git push`, or any `claude plugin *` command. The
**orchestrating session** (holds `Bash` + real GitHub push access) runs
every mutating command: `claude plugin validate`, `claude plugin tag
--dry-run`/`--push`, `git push`, and the local catalog-build smoke check.

Working directory for every command below:
`/Users/viptech/dev/ai agent/dev-digest-ai-marketplace`.

## Context

Phases 1–5 extracted, generalized, and cost-optimized all four plugins;
`git tag -l` is still empty (confirmed again at Phase 6 planning time) and
`scripts/` currently holds only `build-index.mjs` — **`scripts/release.sh`
and `scripts/rollback.sh` do not exist yet**, even though
`docs/specs/marketplace-extraction/architecture.md:401-416` names both as a
required deliverable ("promt #4 — explicitly requested, therefore a
required deliverable, not optional tooling"), not optional lab flavor. This
phase closes that gap and performs the lab's Крок 9 release itself:
dependencies tagged first, `sdd-engineering` last.

**Load-bearing finding from planning research — do not re-derive:**
`scripts/build-index.mjs:172-173`'s `parseChangelog()` only matches heading
lines of the exact shape `## <version> — <title>` (regex
`^##\s+(\S+)\s+—\s+(.+)$`, em dash `—`, not a hyphen). A `## Unreleased`
heading — which is exactly what Phase 5 left in both
`plugins/architecture-review/CHANGELOG.md` and
`plugins/sdd-engineering/CHANGELOG.md` — does **not** match this pattern
and is silently dropped from `releases.json`/the catalog's `#/whats-new`
feed (`scripts/build-index.mjs:344-349`'s `releases[pluginName] =
changelogEntries.map(...)` only ever sees what `parseChangelog` returned).
Folding `## Unreleased` into a `## 1.0.0 — Initial extraction`-shaped
heading is therefore not cosmetic — skipping it means AC-3 (catalog shows
each plugin's actual current version/history) silently regresses the day
this repo's `pages.yml` next rebuids the site. **This fold-in is Step 1
below and must complete before any tag is created.**

## Modules involved (all inside `dev-digest-ai-marketplace`; no
`dev-digest/**` file changes)

- `plugins/architecture-review/CHANGELOG.md`,
  `plugins/sdd-engineering/CHANGELOG.md` — fold `## Unreleased` into
  `## 1.0.0 — Initial extraction`.
- `plugins/engineering-paved-path/CHANGELOG.md`,
  `plugins/research-tools/CHANGELOG.md` — already correctly shaped
  (`## 1.0.0 — Initial extraction`, no `Unreleased` section); confirmed by
  re-read, no edit needed unless the implementer's fresh read finds
  otherwise.
- `scripts/release.sh` (new) — dependency-tagged-first guard + `claude
  plugin tag --dry-run`/`--push` wrapper.
- `scripts/rollback.sh` (new) — prints/optionally runs the exact
  marketplace-remove → marketplace-add(pinned tag) → plugin-install command
  sequence; no invented `plugin rollback` command.
- `docs/RELEASES.md` — currently a one-line stub
  (`docs/RELEASES.md` at planning time: "Will describe SemVer policy, tag
  convention, update flow, release channels... Full content: Phase 2/3");
  this phase writes the real content, since Phase 6 is the actual release.
- `INSIGHTS.md` (repo root) — an entry recording the `parseChangelog`
  `Unreleased`-heading gotcha, if not already captured.

## Constraints

From `docs/specs/marketplace-extraction/architecture.md` and this repo's
own `INSIGHTS.md`:

- **Dependencies release before consumer, always**
  (architecture.md:541-545) — tag order is fixed:
  `engineering-paved-path--v1.0.0`, `research-tools--v1.0.0`,
  `architecture-review--v1.0.0`, `sdd-engineering--v1.0.0` last. `
  scripts/release.sh` must refuse to tag a plugin whose declared
  `dependencies` (from its own `plugin.json`) are not yet tagged at a
  satisfying version — it must actually check (`git tag -l
  "<dep>--v*"` + a real semver-range comparison against the dependency's
  declared `^x.y.z`), not just print a reminder.
- **Tags are immutable once pushed**
  (architecture.md:546-548) — `scripts/release.sh` never force-tags; if a
  tag already exists for the target `<name>--v<version>`, it must fail
  loudly rather than move it. (`claude plugin tag`'s own `-f/--force` flag
  exists to *skip* the dirty-tree/tag-exists checks — the script must never
  pass `--force` on its own initiative; that flag is for a human to invoke
  directly if they explicitly intend to override, never a default in the
  script.)
- **Exact tag convention**: `<plugin>--v<version>`
  (architecture.md:262-270), which is also exactly what the real
  `claude plugin tag` command creates and validates against
  `plugin.json`/the enclosing marketplace entry (confirmed via `claude
  plugin tag --help`, Claude Code 2.1.243: "Create a {name}--v{version} git
  tag for a plugin release, validating that plugin.json and any enclosing
  marketplace entry agree").
- **No fabricated `--strict` flag** on `claude plugin validate`
  (architecture.md:289-290, lab step 7's explicit correction) — do not add
  one anywhere in the scripts or docs.
- **`scripts/rollback.sh` prints the real command sequence, no fabricated
  `plugin rollback` command** (architecture.md:410-416, lab step 11's
  explicit correction). Per the confirmed stable-channel mechanism
  (coordinator's decision — see below), that sequence is:
  ```sh
  claude plugin marketplace remove dev-digest-ai-marketplace
  claude plugin marketplace add viptech/dev-digest-ai-marketplace@<tag> --scope <scope>
  claude plugin install sdd-engineering@dev-digest-ai-marketplace --scope <scope>
  ```
  — no separate `stable` git branch. **Confirmed mechanism (coordinator,
  2026-08-23):** pin directly to the plugin's own release tag (e.g.
  `sdd-engineering--v1.0.0`) via Claude Code's real `<owner>/<repo>@<ref>`
  marketplace-source shorthand (confirmed working syntax, per
  `code.claude.com/docs/en/plugin-marketplaces` and `claude plugin
  marketplace add --help`'s `<source>` argument) — not a maintained
  `stable` branch. This keeps `scripts/rollback.sh` simple: no branch to
  fast-forward, and the immutable-tag invariant already gives the
  necessary guarantee that the pinned ref never moves.
  **Also confirmed (real, documented Claude Code bug —
  anthropics/claude-code#44042):** adding a second marketplace source that
  resolves to the *same* `marketplace.json` `"name"` field
  (`dev-digest-ai-marketplace`, unconditionally, since that name is fixed
  in this repo's own manifest regardless of which ref is checked out)
  **silently overwrites** the first entry instead of erroring — so
  `scripts/rollback.sh` must never suggest adding the pinned-tag source
  *alongside* the existing one; it must always `remove` the current
  marketplace entry first, matching the lab's own literal instruction
  ("Вимкніть або видаліть current channel" — `L08/04-hands-on-lab.md:357`).
- **`${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_SKILL_DIR}` convention
  (architecture.md:561-566) does not apply to these two scripts** — they
  are repo-root developer tooling run from a git checkout of
  `dev-digest-ai-marketplace` itself, not runtime scripts shipped inside an
  installed plugin. Do not add either env var to `release.sh`/`rollback.sh`;
  that convention is for scripts like
  `plugins/sdd-engineering/skills/workflow-retro/scripts/analyze_journals.py`
  which run *inside* an installed plugin instance (relevant again in
  Phase 6.2/6.3, not here).
- **No secrets, no absolute local filesystem path in any committed file**
  (architecture.md `SECURITY.md` policy, AC-8) — `scripts/rollback.sh`'s
  printed command sequence uses the GitHub slug
  `viptech/dev-digest-ai-marketplace`, never a local path; if either script
  needs to reference its own repo root, use a relative path or
  `git rev-parse --show-toplevel`, never a hardcoded
  `/Users/viptech/...` path.
- **English-only prose** in every committed file (architecture.md:587-591)
  — both scripts' comments/output strings, `docs/RELEASES.md`, and both
  `CHANGELOG.md` fold-ins.
- **`docs/RELEASES.md` content contract**
  (architecture.md:396-397): SemVer policy, tag convention, update flow,
  release channels (`latest` vs `stable`), rollback procedure — all five,
  not a subset.

## Skills the implementer will use

None of this harness's own skills apply directly — this is shell-script
authoring plus two `CHANGELOG.md` edits and one doc fill-in, not
React/Fastify/Drizzle/onion-architecture code. The implementer needs no
`Bash` tool and no project-specific skill; its job is precision editorial
work against the exact constraints above (dependency-order guard logic,
immutability, the real `claude plugin tag`/`marketplace` command surface,
no invented flags/commands).

## Ordered steps

### Step 1 — implementer: fold `## Unreleased` into `## 1.0.0` (before anything else)

1. `plugins/architecture-review/CHANGELOG.md` — merge the `## Unreleased`
   entry's content (the `architecture-reviewer.md` `# Input` trim note)
   into the existing `## 1.0.0 — Initial extraction` section, as an
   additional paragraph or bullet under that one heading. Remove the
   `## Unreleased` heading entirely — this repo has never shipped a tag
   yet, so there is no released version for "Unreleased" to sit ahead of;
   everything folds into the first real release.
2. `plugins/sdd-engineering/CHANGELOG.md` — same fold-in for its
   `## Unreleased` entry (the `plan-verifier.md` Step 0 trim note) into its
   `## 1.0.0 — Initial extraction` section.
3. Self-check both files: the only version heading present matches
   `parseChangelog`'s regex exactly — `## 1.0.0 — Initial extraction`,
   em dash (`—`, U+2014), not a hyphen (`-`) or en dash (`–`). Copy the
   character from an existing correctly-parsed heading
   (`plugins/engineering-paved-path/CHANGELOG.md`'s own `## 1.0.0 —
   Initial extraction` line) rather than retyping it, to avoid a
   look-alike-dash mistake.
4. Confirm `plugins/engineering-paved-path/CHANGELOG.md` and
   `plugins/research-tools/CHANGELOG.md` need no change (re-read both;
   they should already be single-`## 1.0.0`-heading files).

### Step 2 — implementer: `scripts/release.sh`

Given a plugin name (its version is read from that plugin's own
`plugin.json`, matching how `claude plugin tag` itself derives the tag
name — the script does not take a version argument):

```sh
./scripts/release.sh <plugin-name>
```

Behavior:
1. Resolve `plugins/<plugin-name>/.claude-plugin/plugin.json`; read its
   `version` and `dependencies` array (empty array if absent).
2. For each declared dependency, check `git tag -l "<dep-name>--v*"` and
   verify at least one existing tag's version satisfies the dependency's
   declared range (e.g. `^1.0.0`) — a real semver-range check, not a
   presence-only check. If any dependency is unsatisfied, print which one
   and exit non-zero **before** touching git in any way.
3. Print the target plugin's `CHANGELOG.md` (its latest heading's notes)
   for the human to read as part of the pre-tag review — matches the lab's
   "Перед кожним release перегляньте CHANGELOG.md, commit SHA та
   результати evals" instruction (`L08/04-hands-on-lab.md:302`).
4. Print `git status --short` and the current `HEAD` SHA — the human's
   commit-SHA check.
5. Run `claude plugin tag --dry-run ./plugins/<plugin-name>` and print its
   output.
6. Prompt for explicit confirmation (a real interactive prompt, e.g. `read
   -p "Push this tag? [y/N] "`) before running `claude plugin tag --push
   ./plugins/<plugin-name>`. Never push non-interactively/unconditionally.
7. Exit non-zero on any failure at any step; never swallow a `claude
   plugin tag` non-zero exit code.

### Step 3 — implementer: `scripts/rollback.sh`

```sh
./scripts/rollback.sh <plugin-name> <tag> [--scope project|user|local] [--execute]
```

Behavior:
1. Validate `<tag>` matches the `<plugin-name>--v<version>` convention and
   actually exists (`git tag -l "<tag>"` non-empty) — refuse with a clear
   message if not (e.g. a typo'd tag name), rather than printing a
   possibly-wrong command sequence.
2. **Always** print the exact sequence a human runs, using the marketplace
   name from this repo's own `.claude-plugin/marketplace.json` (read it,
   don't hardcode the string twice):
   ```sh
   claude plugin marketplace remove <marketplace-name>
   claude plugin marketplace add viptech/dev-digest-ai-marketplace@<tag> --scope <scope>
   claude plugin install <plugin-name>@<marketplace-name> --scope <scope>
   ```
3. Without `--execute`, stop after printing (dry-run is the default,
   matching `release.sh`'s own dry-run-first shape). With `--execute`, run
   the three commands in order via `Bash`-equivalent shell calls, stopping
   immediately if any one fails, and print each command's real output.
4. Never emit or suggest a `claude plugin rollback` command — no such
   command exists.
5. Note in a comment at the top of the script: this repo's own
   `marketplace.json` `"name"` field is fixed regardless of which git ref
   is checked out, so the `remove` step is mandatory before the `add`
   step — adding a second source with the same resolved name silently
   overwrites the first (see Constraints above) rather than erroring.

### Step 4 — implementer: `docs/RELEASES.md`

Replace the current stub with real content covering, in this order:
SemVer policy (what a patch/minor/major bump means for a plugin here —
e.g. "a backward-compatible new agent-prompt requirement, like the 1.1.0
change ahead, is a minor bump; a breaking removal of a skill/agent a
consumer already depends on is a major bump"), the tag convention
(`<plugin>--v<version>`, immutable once pushed), the update flow
(`claude plugin marketplace update` then `claude plugin update
<plugin>@<marketplace>`, restart/`/reload-plugins` required), release
channels (`latest` = the marketplace's default branch/ref; `stable` =
pinned directly to a specific `<plugin>--v<version>` tag via the
`owner/repo@<tag>` marketplace-source form — no separate branch), and the
rollback procedure (point at `scripts/rollback.sh`'s exact command
sequence, cross-referenced, not duplicated in full).

### Step 5 — orchestrating session: review + validate before tagging

1. Review the implementer's diff for the constraints above (dependency
   guard is a real check, no `--force`/fabricated commands, no absolute
   paths).
2. `bash -n scripts/release.sh` and `bash -n scripts/rollback.sh` — syntax
   check only, no execution.
3. `claude plugin validate ./plugins/engineering-paved-path`,
   `./plugins/research-tools`, `./plugins/architecture-review`,
   `./plugins/sdd-engineering`, and `claude plugin validate .` — all five
   must report clean.
4. Local catalog-build smoke check, confirming Step 1's fold-in actually
   surfaces correctly (this is the concrete proof the `parseChangelog`
   gotcha is fixed, not just asserted):
   ```sh
   npm run build:index
   ```
   then inspect the generated `site/public/releases.json` for
   `architecture-review` and `sdd-engineering` and confirm each shows a
   single `1.0.0` entry containing both the original extraction note and
   the folded-in cost-optimization note — not an entry named `Unreleased`
   and not a missing entry.
5. Commit all of Steps 1–4's file changes (CHANGELOGs, both new scripts,
   `docs/RELEASES.md`) with a descriptive message.

### Step 6 — orchestrating session: tag in dependency order

```sh
./scripts/release.sh engineering-paved-path
./scripts/release.sh research-tools
./scripts/release.sh architecture-review
./scripts/release.sh sdd-engineering
```

Confirm at each step the script's own dependency-satisfaction check passes
(trivially for the first three, which have no dependencies or whose sole
dependency — `architecture-review` → `engineering-paved-path` — was just
tagged), review the `--dry-run` output, then confirm the push.

### Step 7 — orchestrating session: post-tag verification

```sh
git tag -l
git show engineering-paved-path--v1.0.0 --stat
git show sdd-engineering--v1.0.0 --stat
```

Confirm all four tags exist, follow the exact `<plugin>--v1.0.0` shape, and
each points at the commit pushed in Step 5 (no `.github/workflows/validate.yml`
exists yet in this repo — see Out of scope — so "points at a CI-green
commit" per the architecture invariant can only be confirmed as "points at
the commit this session locally validated clean with `claude plugin
validate`," not an actual CI run; note this caveat honestly rather than
overstating it).

## Test plan

- `claude plugin validate ./plugins/<each>` and `claude plugin validate .`
  — all clean (Step 5.3).
- `npm run build:index` then inspect `site/public/releases.json` — Step
  1's `Unreleased`→`1.0.0` fold-in is visible correctly, not dropped
  (Step 5.4).
- `bash -n scripts/release.sh` / `bash -n scripts/rollback.sh` — no syntax
  errors (Step 5.2).
- `git tag -l` after Step 6 shows exactly the four expected tags, in the
  correct dependency order by push time (Step 7).
- Manual read of `scripts/rollback.sh`'s printed (not yet executed) output
  against a fake tag argument — confirms it prints the real three-command
  sequence, no invented command.

## Out of scope

Architecture and security review of `release.sh`/`rollback.sh` are **not**
part of this plan or the implementer's job — if either script's
complexity warrants a dedicated review pass, that runs separately in
either execution mode. This phase also does not: wire `.github/workflows/validate.yml`
(still absent — a pre-existing gap from earlier phases, not created here;
flagged, not fixed), install the plugin anywhere (Phase 6.2), or perform
any 1.1.0 change or rollback rehearsal (Phase 6.3).
