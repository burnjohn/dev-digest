# Insights — server

Running log of non-obvious findings, decisions, and hard-won gotchas for
`@devdigest/api`. Append newest at the top. Keep entries short: what surprised
you, why it is that way, and what to do about it. This is the file Claude reads
when a task in `server/` needs the *why*, not the *what* — the [AGENTS.md](AGENTS.md)
map stays lean by pointing here.

<!-- Format: ### YYYY-MM-DD — short title, then 1–3 lines. -->

### 2026-08-18 — a prompt in `docs/agent-prompts/` does NOT mean the agent is seeded
`api-contract-reviewer.md` shipped and was listed in that folder's README while nothing exported it
from `seed-prompts.ts` or added it to `seedAgents`, so `pnpm db:seed` quietly produced four reviewers
against docs describing five. Adding a reviewer is three separate edits (doc → export → `seedAgents`)
— pin the result with a `.it` assertion, because no existing test counts agents or skills.

### 2026-08-17 — a delete-then-guarded-insert cache swap loses data on an upstream `200 []`
`pulls/routes.ts` `GET /pulls/:id` deleted `pr_files` unconditionally and re-inserted only
`if (detail.files.length > 0)`, so one empty-but-successful GitHub reply permanently wiped a PR's
cached patches — wrapping it in a transaction does NOT help, that only guards against a crash
*between* the two statements. Delete and insert must share one guard, and the trust check is
cross-field: `files_count > 0 && files.length === 0` means the sub-resource failed.

### 2026-08-17 — GitHub's PR sub-resources fail INDEPENDENTLY of `pulls.get`
In the 2026-08-17 incident `GET /repos/:o/:r/pulls/:n` returned 200 with a correct `changed_files`
while `…/files` and `…/commits` 404'd (and at times answered `200 []`) — "PR exists, diff is empty"
is a real upstream state, not a caller bug. Never treat an empty sub-resource as authoritative;
`PrDetail.diff_source` (`github` | `cache` | `unavailable`) now carries that verdict to the UI so
the fallback stops rendering as "No changed files." Related: the fail-open entry below.

### 2026-08-17 — CORRECTS the `{}`-parses entry below: `.default()` breaks the REAL call
That entry's advice — give a new structured schema all-`.default()` fields so the mock's `{}`
fallback parses — is wrong, and cost a whole feature. Calls go out with `strict: true`, where
OpenAI rejects any field that is optional without also being nullable; `.default()` is exactly
that, so `ConventionDedup` was rejected on every real scan while all 275 tests passed. Fields
stay REQUIRED (`.nullish()` is fine — nullable AND optional); give the MOCK an explicit fixture
instead. `test/structured-schemas.test.ts` now guards the rule on the Zod side — note the
converted JSON schema looks legal, `zodResponseFormat` only emits a console warning.

### 2026-08-17 — a silent fail-open hides a feature that never ran
The same bug survived seven real scans because `consolidate` caught the error and returned the
un-deduped list, which is visually identical to "found no duplicates". Fail-open is right for a
tidying pass; fail-open *silently* is not. `modules/` has no logger on any `Deps`, so this one
uses `console.warn` deliberately — an unobservable pass is worse than an off-convention log.

### 2026-08-17 — `created_at` cannot break a sort tie between rows written by the same transaction
`ORDER BY confidence DESC, created_at ASC` in `ConventionsRepository.listByRepo` was not a TOTAL
order: `replacePending` inserts a whole scan in one transaction and `now()` is the transaction
timestamp, so every row shares a `created_at`. Postgres then returns tied rows in heap order, and
any `UPDATE` (accepting a rule) rewrites that tuple to the end of the heap — so the card the user
just clicked jumped position on the next refetch. Any user-visible list needs a unique immutable
last key (`asc(id)`); a `defaultNow()` column is not one.

### 2026-08-17 — a NEW `completeStructured` call breaks every existing test unless `{}` parses
`MockLLMProvider.completeStructured` resolves fixtures as `structuredBySchema[req.schemaName] ??
structured ?? {}`, so adding a call to an existing pipeline hands `{}` to the new schema in every
test written before it — `MockLLMProvider fixture failed schema` across the whole file. Give the
new schema all-`.default()` fields so `{}` parses to a harmless no-op, which for a pass that
*deletes* data is also the right fail-open shape.

### 2026-08-17 — `.` does not match `\r`, so `split('\n')` silently breaks every CRLF file
`CodeIndex.grep` parsed rg output with `buf.split('\n')` + `/^(.*?):(\d+):(.*)$/`. On a
CRLF checkout every line keeps a trailing `\r`, and `\r` is a JS regex *line terminator* —
`.` refuses it — so the match failed for ALL lines and grep returned `[]` with no error.
It only looked fine because LF-authored files matched. Split on `/\r?\n/` (or strip a
trailing `\r`) anywhere you parse subprocess or file output line-wise on Windows.

### 2026-08-17 — SUPERSEDES the grep entry below: the flag-injection half is fixed
`grepWithRg` now passes `-e <pattern>` and `--` before the root (`buildRgArgs`, unit-tested
in `test/pattern-safety.test.ts`), so a `-`-leading pattern can no longer be parsed as an
option. The *other* reason still stands — it roots at `git.clonePathFor`, which does not
exist in the `.it` lane, so grep-backed logic is still untestable there.

### 2026-08-17 — A substring probe cannot measure a naming rule — that was the 30% ceiling
`countSupport` matched `normalizeSnippet(file.text).includes(probe)`, so for any naming/typing
rule the probe only ever matched the file it was copied from → `support_count` 1 → every card
scored ~0.30. Conformance needs a *denominator*: count sites that FOLLOW vs VIOLATE
(`countSymbolConformance` over the repo-wide `symbols` table for naming, `countPathConformance`
over `file_rank` for structure), and treat an undeclared scope as unmeasurable (`null`), never
as "the whole repo" — that inversion scores a universally-followed rule at ~2%.

### 2026-08-17 — A saturating support term plus a multiplicative penalty charges twice
The old `blendConfidence` computed `support = min(1, count/target)` (already ~0.17 at count 1)
and *then* multiplied by `LOW_SUPPORT_PENALTY` for the same low count. Both are deleted; if you
add a "weak evidence" knob again, check the normalisation isn't already expressing it.

### 2026-08-17 — `CodeIndex.grep` cannot back a model-authored pattern, for two separate reasons
`grepWithRg` passes the pattern POSITIONALLY (`spawn(rg, [...flags, pattern, root])`) with no
`-e` and no `--`, so a pattern starting with `-` is parsed as a flag — and rg supports
`--pre=<COMMAND>`. Independently, it roots at `git.clonePathFor`, which does not exist in the
`.it` lane, so anything built on it silently returns 0 in every DB-backed test. Count in-process
behind a pattern validator instead.

### 2026-08-17 — REFINES the rename-prompt entry below: only adds+drops in ONE generate trigger it
`drizzle-kit generate` asks "created or renamed from another column?" only when the same diff
contains an added AND a deleted column. A purely additive migration (9 `ADD COLUMN`s across two
tables, `0015`) generates non-interactively on Windows in one shot — so prefer adding a column
alongside an old one over renaming, and split any cleanup drop into its own later generate.

### 2026-08-17 — `git.readFile` THROWS for a missing file; only the mock returns `''`
`SimpleGitClient.readFile` is `fs.readFile` over the clone path, so an absent file rejects
with ENOENT — `MockGitClient.readFile` returning `''` is mock-only behaviour. Any optional
read (config allowlists, best-effort samples) must be `try/catch`ed, or it passes every
hermetic test and blows up on the first real clone.

### 2026-08-17 — drizzle-kit's rename prompt can't be answered non-interactively on Windows
Adding columns while dropping one makes `drizzle-kit generate` ask "created or renamed from
another column?", and it reads the TTY — piping newlines leaves it hanging and NOTHING is
written. Split the change into two generates instead: first add the new columns (no deleted
column → no ambiguity), then remove the old one (no added column → no ambiguity).

### 2026-08-17 — `freshRepo()` per test does NOT isolate a `.it` test — skills are workspace-scoped
`LocalNoAuthProvider` resolves the same default workspace for every request, so a skill one
test creates is visible to the rest of the file — in `conventions.it.test.ts` it silently
deduped away the candidates later tests asserted on. A test that writes workspace-scoped
state (skills, settings, agents) must delete it before closing, not just scope its own repo.

### 2026-08-16 — SUPERSEDES 2026-08-15: `pnpm typecheck` is GREEN on `main` again
The two `DATABASE_URL` errors below were fixed in `9421f37` — both entrypoints now sit behind
an `if (!url) { … process.exit(1) }` guard that narrows `string | undefined` to `string`.
`pnpm typecheck` exits 0; treat **any** error as yours, not pre-existing.

### 2026-08-16 — `run_traces` is ONE jsonb document, not columns
The table is `(run_id, trace jsonb)` — there is no `prompt_assembly` or `log` column. Read it as
`(row.trace as RunTrace).prompt_assembly.skills`, with **snake_case** keys inside (it is the wire
contract verbatim). Selecting `t.runTraces.promptAssembly` silently yields `undefined`.

### 2026-08-16 — Widening a contract enum takes 3 edits, not 1 — but never a migration
A value added to a Zod enum in `vendor/shared/contracts/` (e.g. `SkillSource`) also has to
be added to the matching Drizzle `text(col, { enum: [...] })` in `db/schema/`, or
`$inferInsert` rejects it at the repository — the DDL itself needs nothing, since
`0000_init.sql` declares these as plain `text` with **zero** `CHECK` constraints
(`grep -c CHECK` → 0). Third edit is `./scripts/sync-vendor.sh` to re-copy the client vendor tree.

### 2026-08-15 — `Container` structurally satisfies a per-service `Deps` interface
Replacing `constructor(private container: Container)` with an explicit
`interface XServiceDeps { db; jobs; git; secrets }` needs **no** call-site or container change —
`Container` exposes those as public members/getters, so `new RepoService(app.container)` still
compiles. Verified end-to-end on `modules/repos/service.ts` with `pnpm typecheck`.

### 2026-08-15 — `pnpm typecheck` is already red on `main` (2 pre-existing errors)
`db/migrate.ts` and `db/seed.ts` both do `const url = process.env.DATABASE_URL` and pass it
straight to a `string` parameter → `TS2345: 'string | undefined' is not assignable`. Don't chase
these when validating your own change; check whether the errors are only in those two files.

### 2026-08-10 — `reviews.run_id` is a `uuid` — don't seed string run-ids in `.it` tests
`reviews.runId` (`db/schema/reviews.ts`) is a `uuid` column, so seeding `runId: 'run-1'` fails
with `invalid input syntax for type uuid`. To model "findings across N runs" in a `.it` test,
insert N separate `reviews` rows (runId is nullable — omit it), not distinct run-id strings.

### 2026-08-09 — `completeAgentRun` has a THIRD, hidden param-type copy
Adding a field to an agent run means editing the values type in **both**
`repository/run.repo.ts::completeAgentRun` *and* the class wrapper
`reviews/repository.ts::completeAgentRun` (it re-declares the same inline object
type, not `typeof`/`Parameters<>`). Miss the wrapper and you get a TS2353
"unknown property" at the call site in `run-executor.ts`, not at the repo.

### 2026-08-09 — seed
- **Migrations don't run on boot.** A fresh clone that "won't serve" almost always
  just needs `pnpm db:migrate` (pgvector is enabled by migration `0000`).
- **DB-backed tests need the `*.it.test.ts` suffix** or the unit/integration split
  breaks and they run in the wrong (Docker-less) lane.
- **Secrets are not in `AppConfig`** — chase them through `SecretsProvider`
  (`~/.devdigest/secrets.json`), not env parsing.
