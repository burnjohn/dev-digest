# Mechanical hard checks — H1–H18

Every rule below is a **boolean over paths and diff text**. No LLM, no judgement, no
verification pass — there is nothing here to hallucinate. Each fires with
`confidence: 1.0` and **skips** the adversarial pass in `SKILL.md` §7.

Total runtime on a normal diff: ~2 seconds.

---

## Shared preamble

Every block assumes this preamble has been sourced. The repo root contains **spaces**, so
`cd` once into a quoted path and never build `git -C "$ROOT"` call sites.

```bash
cd "<repo-root>"                       # quoted — the path contains spaces

G() { git --no-pager -c core.quotepath=false "$@"; }

BASE=$(G merge-base origin/main HEAD 2>/dev/null) \
  || BASE=$(G merge-base upstream/main HEAD 2>/dev/null) \
  || BASE=$(G merge-base main HEAD 2>/dev/null) \
  || BASE=HEAD
```

`core.quotepath=false` is not optional: without it git octal-escapes non-ASCII paths and
every glob below silently misses them.

### `CHANGED` — the file set every check reads

Four sources, unioned. **Untracked is not optional** — H1–H3, H6–H8 and H13–H16 are
exactly the rules that a forgotten `git add` would hide.

```bash
emit() {                                # status-first parser for --name-status -z
  awk -v RS='\0' '
    BEGIN { need = 0 }
    {
      if (need == 0) { st = $0; need = (st ~ /^[RC][0-9]*$/) ? 2 : 1; old = ""; next }
      if (need == 2) { old = $0; need = 1; next }
      print st "\t" (old == "" ? "" : old "\t") $0; need = 0
    }'
}

{
  G diff --name-status -M -C -z "$BASE" HEAD | emit     # committed on the branch
  G diff --name-status -M -C -z --cached    | emit      # staged
  G diff --name-status -M -C -z             | emit      # unstaged
  G ls-files --others --exclude-standard -z \
    | tr '\0' '\n' | grep -v '^$' | sed 's/^/A\t/'      # untracked
} | sort -u > /tmp/changed.tsv
```

**The `-z` rename trap.** `--name-status -z` emits a rename or copy as **three**
NUL-separated fields (`R100`, old path, new path) and everything else as **two**. A parser
that assumes two fields silently shifts by one and corrupts the entire file list from the
first rename onward. Parse **status-first**: read the status, then read 2 paths if it starts
with `R`/`C`, otherwise 1. Verified against the current tree, which carries four `R100`
records (`client/src/components/showcase/` → `client/src/test/showcase/`).

`git diff` writes `LF will be replaced by CRLF` warnings to **stderr** on Windows. They do
not touch stdout, so no redirect is needed — but do not `2>&1` these pipelines or the
warnings become file paths.

### `ADDED` — new-side added lines, for text checks

```bash
G diff -U0 "$BASE" HEAD; G diff -U0 --cached; G diff -U0
```
piped through `grep '^+' | grep -v '^+++'`. Untracked files are appended whole
(every line of an untracked file is an added line).

### Binary and pure-rename exclusions

```bash
G diff --numstat -z "$BASE" HEAD        # binary rows are  -<TAB>-<TAB><path>
```
Binaries are excluded from LLM review. `R100` (pure move, zero content change) is excluded
from LLM review **but kept** for the `frontend-ui-architecture` routing group — a pure move
is precisely the question that skill exists to answer.

---

## The rules

| ID | Rule | Severity |
|---|---|---|
| H1 | Vendored contracts drifted | CRITICAL |
| H2 | Generated vendor tree hand-edited | CRITICAL |
| H3 | Lock file edited without its `package.json` | CRITICAL |
| H4 | DB-backed test missing the `.it.test.ts` suffix | CRITICAL |
| H5 | `.it.test.ts` with no DB dependency | WARNING |
| H6 | Secret literal in the diff | CRITICAL |
| H7 | Secrets file committed | CRITICAL |
| H8 | Runtime/generated data committed | CRITICAL |
| H9 | Migration `.sql` with no `_journal.json` entry | CRITICAL |
| H10 | `_journal.json` entry with no migration `.sql` | CRITICAL |
| H11 | An **existing** migration modified | CRITICAL |
| H12 | `process.env` outside its allowed files | WARNING |
| H13 | `reviewer-core/dist/**` present | CRITICAL |
| H14 | Root `package.json` added | CRITICAL |
| H15 | Cross-package relative import | CRITICAL |
| H16 | `docker compose down -v` in a script or doc | CRITICAL |
| H17 | `INSIGHTS.md` lines removed | WARNING |
| H18 | Skill catalog drift | WARNING |

---

### H1 — vendored contracts drifted · CRITICAL

`server/src/vendor/shared` is the ONE canonical copy; `client/src/vendor/shared` is its
byte-identical output. The script itself is the authority — do not reimplement its
comparison.

```bash
./scripts/sync-vendor.sh --check        # exit 0 = in sync, 1 = drifted
```

Run it whenever `CHANGED` touches `*/vendor/shared/**` or `scripts/sync-vendor.sh`.
Non-zero exit → CRITICAL, `category: bug`. Quote the script's own diff output as the
rationale, and give the fix verbatim: `./scripts/sync-vendor.sh` (server is canonical).

### H2 — generated vendor tree hand-edited · CRITICAL

> **Corrected against the tree — do not restore the naive form.** The obvious rule
> ("any `client/src/vendor/shared/**` path in the diff is a hand-edit") is **wrong**, and
> the current working tree proves it: six files under `client/src/vendor/shared/**` are
> modified, `server/src/vendor/shared/contracts/findings.ts` is modified, and
> `sync-vendor.sh --check` reports **in sync**. That is the intended workflow — edit
> canonical, run the script — and flagging it would make H2 fire on every correct contract
> change. A false CRITICAL here would train the user to `--override` on their most common
> multi-package change.

Fire **only** when the client copy is not byte-identical to canonical:

```bash
cut -f2- /tmp/changed.tsv | grep -q '^client/src/vendor/shared/' \
  && ! ./scripts/sync-vendor.sh --check >/dev/null 2>&1 \
  && echo "H2: client vendor copy edited and NOT in sync with canonical"
```

If `--check` passes, H2 does not fire. A byte-identical copy *is* the script's output; it
cannot be distinguished from one, and there is nothing to fix. Record it in the report's
Coverage section (`client vendor copy changed, verified in sync`) instead of as a finding.

### H3 — lock file edited without its `package.json` · CRITICAL

Lock files are regenerated by the package manager, never hand-edited (root AGENTS.md).
A lock change with no manifest change in the **same package** is the signature of a manual
edit or a bad merge resolution.

```bash
for pkg in client server reviewer-core e2e; do
  lock=$(cut -f2- /tmp/changed.tsv | grep -E "^$pkg/(pnpm-lock\.yaml|package-lock\.json)$")
  manifest=$(cut -f2- /tmp/changed.tsv | grep -E "^$pkg/package\.json$")
  [ -n "$lock" ] && [ -z "$manifest" ] && echo "H3: $lock changed without $pkg/package.json"
done
```

`client` and `server` use **pnpm** (`pnpm-lock.yaml`); `reviewer-core` and `e2e` use **npm**
(`package-lock.json`). Check both names — a `package-lock.json` appearing under `client/`
is itself the bug.

**Known local-state caveat.** `TESTING.md` documents `server/package.json` as
`skip-worktree`, which would make it invisible to `git diff` and turn a legitimate
server-side dependency bump into a false H3. That flag is **not** set in this clone
(`git ls-files -v` returns no lowercase-letter rows), so H3 is safe here. Before reporting
H3 against `server/`, confirm:

```bash
G ls-files -v -- server/package.json      # a lowercase letter in col 1 = skip-worktree
```
A `S`/`h` marker means suppress the finding and note it under Coverage instead.

### H4 — DB-backed test missing the `.it.test.ts` suffix · CRITICAL

The split is by filename only (`TESTING.md`): the unit lane runs
`vitest run --exclude '**/*.it.test.ts'`, the integration lane runs `vitest run .it.test`.
A DB-backed test named `*.test.ts` lands in the **hermetic** lane, where no Postgres exists,
and fails CI without ever being visible locally.

```bash
for f in $(cut -f2- /tmp/changed.tsv | grep -E '^server/.*\.test\.ts$' | grep -v '\.it\.test\.ts$'); do
  grep -qE "helpers/pg|testcontainers" "$f" 2>/dev/null \
    && echo "H4: $f is DB-backed but not named *.it.test.ts"
done
```

**Match `helpers/pg`, not `test/helpers/pg` — this was a real bug.** Tests live *inside*
`server/test/`, so they import the fixture relatively as `./helpers/pg.js`; the
absolute-looking form never matches and the check silently cannot fire. Found 2026-08-22,
when H5 reported five hits including two pre-existing files that import that helper on
line 2. H4 is the dangerous half: a CRITICAL rule that can never fire reads as "clean" on
every run.

### H5 — `.it.test.ts` with no DB dependency · WARNING

The inverse. Harmless to correctness, but it parks a hermetic test in the Docker lane, where
it is skipped whenever Docker is absent — so it silently stops running.

```bash
for f in $(cut -f2- /tmp/changed.tsv | grep -E '^server/.*\.it\.test\.ts$'); do
  grep -qE "helpers/pg|testcontainers" "$f" 2>/dev/null \
    || echo "H5: $f is in the Docker lane but imports no DB helper"
done
```

Same pattern correction as H4 above — see the note there.

### H6 — secret literal in the diff · CRITICAL, `kind: secret_leak`

Secrets live in `~/.devdigest/secrets.json` (mode `0600`) with `process.env` as fallback.
They never appear in git and never appear in the DB.

Run over `ADDED` only — a secret that was already on `BASE` is a different (worse) problem
and belongs to history rewriting, not to this review.

```bash
grep -nE \
  "sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|(GITHUB_TOKEN|OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{8,}"
```

Set `kind: "secret_leak"`. That kind is **exempt from the line-intersection half of the
grounding gate** (`grounding.ts` `FULL_FILE_KINDS`) — file presence is enough.

A match on a *placeholder* (`sk-xxxxx`, `ghp_` + literal `x`s, `<your-token>`) is still
reported, at WARNING, with the placeholder quoted. Do not build a placeholder allowlist:
the cost of asking is one line, the cost of a suppressed real key is the key.

### H7 — secrets file committed · CRITICAL

```bash
cut -f2- /tmp/changed.tsv | grep -E '(^|/)secrets\.json$'
cut -f2- /tmp/changed.tsv | grep -E '^\.devdigest/' | grep -v '^\.devdigest/cache/'
```
Two greps, not one: POSIX `grep -E` has no negative lookahead, so `^\.devdigest/(?!cache/)`
is not a pattern — it matches the literal characters and quietly finds nothing.

`.devdigest/cache/` is git-ignored and is where this skill writes its own artifacts.
Anything else under `.devdigest/` is state that must not be shared.

### H8 — runtime/generated data committed · CRITICAL

```bash
cut -f2- /tmp/changed.tsv \
  | grep -E '(^|/)(clones|test-results|\.next|coverage|node_modules|playwright-report)/'
```
All are git-ignored; a path here means someone used `git add -f`. `clones/` in particular is
imported-repo checkouts — potentially gigabytes, potentially someone else's private code.

### H9 / H10 — migration and journal must move together · CRITICAL

`drizzle-kit generate` writes the `.sql` **and** the `meta/_journal.json` entry **and** a
`meta/NNNN_snapshot.json`. A hand-written `.sql` with no journal entry is never executed by
`db/migrate.ts` — it looks applied in review and does nothing in production.

```bash
sql=$(cut -f2- /tmp/changed.tsv | grep -E '^server/src/db/migrations/[0-9]{4}_.*\.sql$')
journal=$(cut -f2- /tmp/changed.tsv | grep -E '^server/src/db/migrations/meta/_journal\.json$')

[ -n "$sql" ] && [ -z "$journal" ] && echo "H9: migration(s) without a _journal.json change"
[ -z "$sql" ] && [ -n "$journal" ] && echo "H10: _journal.json changed with no migration .sql"

# and per-file: the tag must actually be in the journal
for f in $sql; do
  tag=$(basename "$f" .sql)
  grep -q "\"tag\": \"$tag\"" server/src/db/migrations/meta/_journal.json \
    || echo "H9: $tag has no entry in _journal.json"
done
```

**The untracked case is the common one.** On the current tree
`server/src/db/migrations/0011_quiet_patch.sql` is **untracked** (`??`) while
`_journal.json` is modified — a plain `git diff` sees only half the pair and would report a
phantom H10. This is the single best argument for `ls-files --others` being in `CHANGED`.

### H11 — an existing migration modified · CRITICAL

```bash
grep -E '^M\tserver/src/db/migrations/[0-9]{4}_.*\.sql$' /tmp/changed.tsv
```
Status `M`, not `A`. An applied migration is recorded in the `devdigest_pgdata` volume;
editing the file changes what a *fresh* database gets and leaves every existing one behind,
silently. The fix is always a new migration, never an edit.

### H12 — `process.env` outside its allowed files · WARNING

The repo's own rule (`onion-architecture`, verified against the tree): `process.env` never
appears under `modules/**`, and inside `platform/` only in `config.ts`. Everything else
reads secrets through `SecretsProvider`.

```bash
G diff -U0 -- 'server/src/modules/**' 'server/src/platform/**' \
  | grep '^+' | grep -v '^+++' | grep -n 'process\.env'
```
Current legitimate readers, for reference: `platform/config.ts`, `adapters/secrets/local.ts`,
`adapters/git/simple-git.ts` (writes two subprocess vars), `db/migrate.ts`, `db/seed.ts`.
`adapters/` and `db/` are outside this rule's scope; do not widen it.

### H13 — `reviewer-core/dist/**` present · CRITICAL

```bash
cut -f2- /tmp/changed.tsv | grep -E '^reviewer-core/dist/'
```
The engine is consumed as **TypeScript source** through a tsconfig alias and never emits JS
(`reviewer-core`'s `build` script is `tsc --noEmit`). A `dist/` here means someone changed
the build contract. Note that `.gitignore`'s `!agent-runner/dist/` exception is forward-looking
and does **not** apply to `reviewer-core`.

### H14 — root `package.json` added · CRITICAL

```bash
cut -f2- /tmp/changed.tsv | grep -E '^package\.json$|^pnpm-workspace\.yaml$'
```
Four standalone packages, deliberately not a workspace. A root manifest changes how every
command in every AGENTS.md is run.

### H15 — cross-package relative import · CRITICAL

```bash
# over ADDED lines
grep -E "^\+.*from ['\"]\.\.?/.*/(server|client|reviewer-core|e2e)/"
```
Cross-package code is shared through **tsconfig path aliases**, not relative paths. A
relative hop compiles locally and breaks the moment the package is built or moved.

### H16 — `docker compose down -v` in a script or doc · CRITICAL

```bash
grep -nE 'docker[ -]compose[^|;&]*down[^|;&]*(-v|--volumes)'
```
over `ADDED`. `-v` destroys the `devdigest_pgdata` volume and with it every imported repo
and review. The only sanctioned use is against the ephemeral e2e stack; if that is the
intent, the finding is answered by naming the compose file explicitly in the command.

### H17 — `INSIGHTS.md` lines removed · WARNING

```bash
G diff --numstat -- '**/INSIGHTS.md'     # deletions column must be 0
```
`INSIGHTS.md` is append-only; a stale entry is corrected by a new dated entry, not by an
edit. The `engineering-insights` skill sanctions exactly one exception — the periodic prune
pass — so this is a WARNING that asks, not a CRITICAL that blocks.

Verified on the current tree: `server/INSIGHTS.md` shows `11 0` (11 added, 0 deleted) — a
clean append, no finding.

### H18 — skill catalog drift · WARNING

```bash
for d in .claude/skills/*/; do
  n=$(basename "$d")
  grep -q "\[$n\](" .claude/skills/README.md || echo "H18: $n has no catalog row"
done
node -e '
  const l = require("./skills-lock.json").skills, fs = require("fs");
  for (const k of Object.keys(l))
    if (!fs.existsSync(".claude/skills/" + k)) console.log("H18: skills-lock entry without a folder: " + k);
'
```

Known drift at the time of writing, all three confirmed:
`skills-lock.json` lists `architecture-patterns` and `github-workflow-automation` with no
matching folder; `.claude/skills/README.md` listed 12 skills against 13 present
(`engineering-insights` was missing) and referenced a `.cursor/skills/` symlink that does
not exist in the tree. Report **once per session**, not once per run — it is a repo state,
not a property of the diff.
