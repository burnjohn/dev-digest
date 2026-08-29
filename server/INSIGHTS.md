# Insights — server

Running log of non-obvious findings, decisions, and hard-won gotchas for
`@devdigest/api`. Append newest at the top. Keep entries short: what surprised
you, why it is that way, and what to do about it. This is the file Claude reads
when a task in `server/` needs the *why*, not the *what* — the [AGENTS.md](AGENTS.md)
map stays lean by pointing here.

<!-- Format: ### YYYY-MM-DD — short title, then 1–3 lines. -->

### 2026-08-29 — `isConfigChange` is a PATCH predicate and is wrong as a RESTORE predicate
`modules/agents/helpers.ts::isConfigChange` ends with a bare `patch.outputSchema !== undefined`:
mentioning the field at all counts as a change, because a save that sends it is assumed to be
setting it. A restore replays the WHOLE snapshot, so every field is always present and that clause
makes it report "changed" unconditionally — the "restoring the config you already have is a no-op"
guarantee would never hold and each promote would append an identical snapshot. `isRestoreChange`
is the separate value-comparison predicate for that path. It also compares `config_json.skills`
against the current links, which `isConfigChange` cannot see at all: the link set is part of the
agent's effective prompt (that is why `setSkills` bumps the version), so two configs identical in
every scalar but differing in their links are NOT the same version.

### 2026-08-29 — restoring an agent version must replace the links BEFORE it snapshots
`AgentsRepository.snapshotVersion` builds `config_json.skills` by re-reading `skillIdsForAgent(row.id, tx)`
rather than taking them from its caller. So in `restoreVersion`, writing the snapshot before
replacing `agent_skills` records the OUTGOING link set against the INCOMING config — a snapshot that
matches no state the agent was ever in, and one that a later restore of that version would then
faithfully reproduce. Order is: lock the agent row, replace links, update scalars + version,
`snapshotVersion` last.

### 2026-08-29 (final on this) — the vacuous-truth rule covers RECALL too; the entry below is stale on that one point
Extended the same day, so all three metrics fold to 1 on a zero denominator once something was
produced. Know what recall means under it: `matchMustNotFlag` returns `tp = fn = 0` whatever the
model does, so a `must_not_flag` case's recall is now a **constant 1 that measures nothing** — unlike
precision, which still scores 0 when a finding hits a forbidden region. **Do not read 100% recall on
a single-case run as evidence of anything**; only a set containing at least one `must_find` case has
a real recall denominator. `scoreWithoutArm` is wrapped too, else an ablation delta would show a
regression the skill never caused.

### 2026-08-29 (supersedes) — "blank metrics for a `must_not_flag` case BY DESIGN" is NO LONGER TRUE for precision/citation
Owner decision, reversing the note further down: a unit that RAN and returned no findings said
nothing wrong and dropped nothing, so precision and citation accuracy are **1**, not `null` —
`scoring.ts::vacuouslyPerfect`, applied in `scoreWithArm` and `foldBatchAggregate`. **Recall is
unchanged and still `null`** (a `must_not_flag` case has nothing to find). Kept as a wrapper, never a
change to `computePrecision`/`computeCitationAccuracy` themselves, because the rule needs a
precondition — *something was produced*: an errored case and an all-errored batch must keep `null`,
since folding those to 1 renders a run that never happened as flawless. Rows written before this
keep their NULLs; the metric is not comparable across the change.

### 2026-08-29 (latest) — inserting a status row ALREADY TERMINAL is a design tool, not just an optimization
Making a single eval-case run persist a batch of 1 (`EvalsService.runCase` -> `insertCompletedBatch`)
needed it to count on the dashboard while neither taking the owner's live-batch 409 lock nor being
reapable — which looks like it needs a `trigger: 'set'|'single'` discriminator column plus a filter in
every read. It needs neither: run the work FIRST, then insert the row with `status`/`finished_at`
already set, and it is never `running` for even one round-trip, so both the lock scan and the boot
reaper (which only ever look for `running`) skip it for free. **When a guard keys off a transient
status, never being in that status beats being excluded from it by a flag someone must remember to check.**

### 2026-08-29 (latest) — the `?? 0` wire-boundary trap again, this time on `cases_passed` — and the reaper is what springs it
Sharpens the `cases_total` entry below: the same `toBatchRecord` coalesce hit a second column, because
`reapStaleRunningBatches` stamps `status: 'failed'` + `finished_at` but leaves `cases_passed` NULL. A
batch killed by a `tsx watch` reload therefore rendered as **`0/7` with dashed metrics** —
byte-identical in the UI to a genuinely all-errored batch (e.g. a missing provider key), and the real
reason lives only in a `console.warn` since neither table has a reason column. **A partial write must
fill every column the wire layer coalesces, or the coalesce invents a plausible wrong number.**

### 2026-08-29 — every in-process `running` row needs a boot reaper; `agent_runs` had one, `eval_run_batches` did not
A batch's loop is handed to `setImmediate` inside the API process — nothing queues or resumes it —
so a restart (a `tsx watch` reload is enough) strands its row at `status: 'running'` forever, and
the studio then renders that owner's cases as running/queued and keeps `Run all evals` disabled with
no way back. `reapStaleRunningRuns` had solved exactly this for `agent_runs` in `app.ts`'s boot
sequence; `EvalsRepository.reapStaleRunningBatches` now sits beside it. **The rule generalizes: any
status column whose live state is owned by an in-process loop needs a boot sweep, and the sweep must
stamp `finished_at` too** — a `failed` row with a null finish still reads as in-flight to every query
that sorts on it.

### 2026-08-29 — a column written only at COMPLETION reads as `0` for the whole run it was meant to describe
`eval_run_batches.cases_total` was left NULL by `insertBatch` and written by `completeBatch`, and
`toBatchRecord` coalesces NULL to `0` for its `z.number().int()` field — so `GET /evals/batches/:id`,
whose whole purpose is polling a RUNNING batch, reported `cases_total: 0` and the studio's progress
line read `5/0` until the batch ended. The size of the set is known at `startAgentBatch`/
`startSkillBatch`, so it is now written on the INSERT. Any field a poller reads must be populated when
the poll STARTS, not when the work finishes — a `?? 0` at the wire boundary turns that into a plausible
wrong number rather than a visible null.

### 2026-08-29 (fourth, and the first one with a mechanism behind it) — eval-case polarity is back to REQ-4/REQ-5, and a NEGATIVE case is now winnable
Supersedes the three notes below, which flip-flopped without ever fixing what made the flip
tempting. `reviews/eval-draft.ts`: accepted -> POSITIVE (`must_find`, padded `expected_output`),
dismissed -> NEGATIVE (`must_not_flag`, one padded `forbidden_region`). What was missing all along
is why the previous flip looked reasonable: **nothing fed a dismissal back into the review**, so a
negative case was unwinnable by construction — `findings.dismissed_at` was written by the UI and
read by NOBODY (`grep -i dismiss reviewer-core/src` returned zero hits), the runner handed the model
the same frozen diff, the model re-reported the same defect, and `scoring.ts` scored it a false
positive on every run forever. Making both arms `must_not_flag` did not fix that; it just relabelled
it. `pipeline/case-runner.ts` now renders the case's own `forbidden_regions` as a trusted
do-not-report list (`reviewer-core` `PromptParts.suppressions`), so the case measures whether the
model OBEYS and can still legitimately fail. Diagnosis note for next time: `precision: 0` with
`recall: null` on a seeded case means exactly one thing — a finding intersected a forbidden region.

### 2026-08-29 — three-line drift, not a bug: the padded window cuts BOTH ways depending on the arm
`EXPECTATION_LINE_PADDING = 3` was measured for `must_find`, where widening the window ABSORBS
citation drift and stops a found bug scoring as a miss. On the `must_not_flag` arm the identical
constant WIDENS a trap: the live failure was a dismissed finding at line 19, padded to 16-22, and a
re-run citing the same defect at 22-22 — an intersection of exactly one line. Both behaviours are
correct and they are the same line of code, so before touching the constant, name which arm you are
tuning. The suppression list deliberately sends the model the padded range verbatim: it is told
exactly what the scorer checks.

### 2026-08-29 — `claude-haiku-4.5` via OpenRouter took 131s per eval case; `deepseek-v4-flash` takes 8s
Measured on ONE unchanged case, back to back: DeepSeek 6-20s at ~$0.0005, Haiku 4.5 **131.3s at
$0.0063** (~9 output tokens/sec for ~1k tokens — the slowness is the route, not the payload).
`duration_ms` matched wall clock, so none of it is framework overhead. That figure straddles the
OpenRouter client's per-attempt `timeout: 90_000` with `maxRetries: 2`
(`reviewer-core/src/llm/openrouter.ts`, not overridden in `platform/container.ts`), so a run is
either ~2x the real latency (one aborted attempt + one good one) or an intermittent "error from
OpenRouter" when every attempt blows 90s. Before blaming a model for flaky evals, time it: the
`eval_runs.duration_ms`/`cost_usd` columns already carry the evidence. Also: OpenRouter lists `seed`
as supported for DeepSeek and NOT for Haiku 4.5, so only the cheap one can be pinned for determinism.

### 2026-08-29 (final) — eval-case polarity, settled: scoring is `must_not_flag` for BOTH arms, the label is provenance
Supersedes both notes below. `reviews/eval-draft.ts` seeds every finding-backed case as
`must_not_flag` (empty `expected_output`, one padded `forbidden_region`) — red means "the agent still
reports this", green means it stopped. What differs is only the BANNER, driven by a new
`eval_cases.seeded_from` column (`'accepted'` → POSITIVE CASE, `'dismissed'` → NEGATIVE CASE);
`expectation_kind` is `must_not_flag` for both and can never label them apart. Provenance never
reaches the scorer. Consequences: a reviewer that still catches an accepted finding scores RED, and
`recall`/`precision` are `null` on every seeded case (no TP/FN → zero denominators), so the dashboard
headline metrics are blank for them BY DESIGN. Migration `0020_eval_case_seeded_from.sql` must be
applied before any case is saved — the insert writes the new column.

### 2026-08-29 (later) — CORRECTION: the eval-case polarity flip was REVERTED; the entry below is stale on point (1)
`reviews/eval-draft.ts` is back to SPEC-03 REQ-4/REQ-5 as originally specified: accepted -> POSITIVE
(`expected_output`, `must_find`), dismissed -> NEGATIVE (`forbidden_regions`, `must_not_flag`). Both
windows stay padded. Point (2) of that entry — the `eval_baseline` runner model — still stands.
Worth remembering as process, not just fact: the flip was proposed, objected to in writing, confirmed
twice, shipped, and reversed within the hour. When a decision inverts a scoring contract, ship it
behind its own commit so reverting is one command rather than an archaeology exercise.

### 2026-08-29 — two OWNER decisions that invert what an eval case means — read before trusting a number
Both were taken deliberately, against a written objection, and both contradict SPEC-03 as shipped.
(1) **Polarity**: `reviews/eval-draft.ts` now seeds BOTH an accepted and a dismissed finding as
`must_not_flag` — empty `expected_output`, one padded `forbidden_region`. Red means "the agent still
reports something here". REQ-4 specified the opposite for the accepted arm. Consequences the owner
accepted: a correct reviewer scores RED, and `recall`/`precision` are `null` on these cases
(`must_not_flag` has no TP/FN, so both denominators are 0) — so the Eval Dashboard's headline metrics
go blank for finding-seeded cases, by construction, not by bug. `input_diff` is frozen, so fixing the
code never turns such a case green.
(2) **Runner model**: an agent-owned case runs on the `eval_baseline` feature model
(`Eval Runner`; briefly `claude-haiku-4.5`, reverted to `deepseek-v4-flash` the same day on latency), NOT `agents.model` — the agent supplies only the
system prompt. Changing an agent's model no longer moves its eval numbers. Practical fallout for
tests: an agent-owned eval route test must mock `openrouter`, not the agent's own provider
(`test/evals-routes.it.test.ts`), the same trap `evals-skill-cases.it.test.ts` already documents.

### 2026-08-29 — a seeded eval case is flaky because the WINDOW is one line wide, not because the model is
`evals/scoring.ts::matchesExpectation` compares `file` equality plus range **intersection** and
nothing else — never title, severity or category — and `pass` needs `fn === 0 && fp === 0`, so one
non-overlapping citation scores as a miss *and* a false positive at once (recall 0 / precision 0).
Four consecutive runs of one case seeded at `start_line: 19` had the reviewer cite the same rename at
`16-19`, `16-22`, `20-20`, `19-19`: three passes and one fail off a single line of drift, every run
having actually found the bug. `reviews/eval-draft.ts` now pads the seeded window
(`EXPECTATION_LINE_PADDING`) on both the accepted and dismissed arms. When an eval flips, diff the
run's cited lines against the expectation before suspecting the model — and note OpenRouter sends no
`seed` and pins no provider (`reviewer-core/src/llm/openrouter.ts`), so `temperature: 0` is not
determinism.

### 2026-08-29 — in a with/without A/B, a constant shared by BOTH arms still ruins the number
A skill eval's runner-agent `systemPrompt` was byte-identical in both arms (`baseInput` built once
and spread in `pipeline/case-runner.ts`), so it *cancelled* in `recall(with) − recall(without)` — and
was still wrong: it is an **interaction term**, not contamination. A runner prompt already covering
what the skill teaches drives lift toward 0 for an excellent skill; a weak one inflates it for a
mediocre one, so two skills measured under different runners are incomparable. Fixed by pinning a
neutral baseline (SPEC-03 AC-68/AC-72/AC-73, rewritten 2026-08-29). **Check what a shared constant
*interacts* with, not just whether it cancels.**

### 2026-08-25 — a runtime guarantee parked in an optional helper silently never runs
`platform/trace-builder.ts`'s `buildRunTrace` carried the only `RunTraceSchema.parse` of a run trace
— and had **zero importers**; `run-executor` built the `RunTrace` as a typed object literal on all
three paths (done / cancelled / failed) and wrote it raw. Nothing flags this: `tsc` checks the
literal's shape, so the absent runtime parse is invisible, and `run_traces` is opaque jsonb that only
fails on read. Put a validate-before-persist at the **write chokepoint** (here `saveRunTrace` in
`repository/run.repo.ts`, which every producer funnels through), never in a builder a caller may skip.

### 2026-08-23 — a red `.it` lane is usually Testcontainers contention, not a regression
`pnpm exec vitest run .it.test` starts 16 suites in parallel, each spinning its own Postgres
container; on a cold or busy Docker they blow the 120s `beforeAll` budget and report
`Hook timed out in 120000ms` — **zero assertion failures**. Before debugging code, re-run one
suite alone: if it passes, it was contention. Never run two `.it` invocations concurrently, and
give Docker Desktop time to finish starting (its WSL2 `docker-desktop` distro can sit `Stopped`
for minutes while `docker info` hangs rather than errors).

### 2026-08-22 — a Zod contract edit that passes BOTH typechecks can still break every fixture
Adding required fields to a schema in `vendor/shared/contracts/` invalidates every test that
`.parse()`s it, and `tsc` cannot see it for two independent reasons: `server/tsconfig.json` ends
`"include": ["src/**/*.ts"]`, so `server/test/**` is never compiled, and `.parse()` takes `unknown`,
so compiling it would raise nothing anyway. `test/contracts.test.ts`'s SmartDiff fixture failed at
RUNTIME one wave later. A contract edit's done condition must run
`pnpm exec vitest run --exclude '**/*.it.test.ts'`, never just `pnpm typecheck`.

### 2026-08-22 — `smart-diff` pattern arrays are FIRST-match-wins, with no "most specific" rule
`classifyPath` runs `BOILERPLATE_PATTERNS.some()` before `WIRING_PATTERNS.some()`, and each array is
an ordered `.some()` — so a broad early entry silently shadows a narrower one appended later. GitHub
Linguist's generic `(^|/)vendor/` swallowed BOTH `server/src/vendor/shared/**` (the canonical,
hand-written contracts — the most review-worthy tree in the repo) and `client/src/vendor/ui/**` (the
hand-maintained design system), burying them in Boilerplate; only `client/src/vendor/shared/**` is
generated. Fixed with a lookahead. Appending an override and assuming it wins is the trap — a red
test is the only thing that surfaces it.

### 2026-08-21 — CORRECTS the seed's "not env parsing": secrets have TWO sources, so a `.it` test is not hermetic by default
`LocalSecretsProvider.get` reads `~/.devdigest/secrets.json` **and** falls back to `process.env`,
which `platform/config.ts`'s `import 'dotenv/config'` fills from `server/.env`; `config.secretsPath`
is hardcoded with no env override, so **only `overrides.secrets` closes both channels**. Any `.it`
test reaching `container.llm(...)` or `container.github()` without it makes real billed calls that
`catch` blocks swallow — the lane stays green while billing and flaking on timeouts. Use
`hermeticOverrides()` from `server/test/helpers/overrides.ts`.

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
