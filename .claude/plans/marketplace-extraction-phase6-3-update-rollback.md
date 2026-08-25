# Development Plan — Phase 6.3: Update to sdd-engineering@1.1.0 + rollback rehearsal (lab Крок 11)

**Execution mode:** multi-agent, same split as the rest of Phase 6.
`implementer` edits files only inside `dev-digest-ai-marketplace`
(`spec-creator.md`, one new eval case, `CHANGELOG.md`, `plugin.json`
version bump) — it does not hold `Bash` and never runs `git tag`, `git
push`, `claude plugin *`, or any eval. The **orchestrating session** runs
every eval, every `claude plugin`/`git` command, and drives the live
install-target rehearsal, exactly as in Phase 6.1/6.2.

Two working directories, explicitly labeled per step:
- **[marketplace]** = `/Users/viptech/dev/ai agent/dev-digest-ai-marketplace`
- **[install-target]** = `/Users/viptech/dev/ai agent/plugin-install-target`

## Context

Precondition: Phase 6.1 (all four `--v1.0.0` tags pushed) and Phase 6.2
(sdd-engineering@1.0.0 installed and rehearsed in `plugin-install-target`,
with one commit recorded) are both complete.

This phase implements the lab's Крок 11 backward-compatible change and its
full round-trip: ship `sdd-engineering@1.1.0`, update the install target to
it, confirm the new behavior is genuinely new (AC-5), then rehearse
rollback to `1.0.0` via a **stable channel pinned directly to the
`sdd-engineering--v1.0.0` tag** (coordinator's confirmed mechanism — no
separate `stable` git branch; see Phase 6.1's Constraints for the full
rationale and the real `owner/repo@<tag>` marketplace-source syntax this
reuses), then confirm a smoke check stays green (AC-7), then return to
`latest`.

**The exact backward-compatible requirement (lab's own wording,
`L08/04-hands-on-lab.md:339`, English translation carried into the
implementation):** *"`spec-creator` does not complete a spec until every
mandatory requirement carries an acceptance criterion."* This is a
strengthening of an existing self-check, not a new template section or a
breaking change — `spec-creator.md`'s Step 4 self-check already has a
"Traceability" bullet (`plugins/sdd-engineering/agents/spec-creator.md:248-251`)
that currently reads as "every AC-N traces back to a Goal or user story"
(AC-N → requirement direction). The 1.1.0 change adds the **reverse**
direction as a blocking gate: every Goal/User story requirement → at least
one AC-N, checked *before* the draft may be reported as complete, not just
verified after the fact. A 1.0.0-shaped spec that already has full AC
coverage for every requirement still satisfies 1.1.0 unchanged — this is
why the bump is backward-compatible (minor, not major).

## Modules involved

- **[marketplace]** `plugins/sdd-engineering/agents/spec-creator.md` —
  Step 4 self-check strengthened into a blocking gate (see Step 1 below).
- **[marketplace]** `evals/agents/spec-creator/` — one new eval case
  proving the new gate (AC-5).
- **[marketplace]** `plugins/sdd-engineering/CHANGELOG.md` — new
  `## 1.1.0 — <title>` entry (must match `parseChangelog`'s exact
  `## <version> — <title>` em-dash shape — see Phase 6.1's load-bearing
  finding; do not repeat that mistake on this new heading).
- **[marketplace]** `plugins/sdd-engineering/.claude-plugin/plugin.json`
  — `"version": "1.1.0"`. Its own `dependencies` array is unaffected —
  the 1.0.0-tagged dependency plugins already satisfy `^1.0.0` and do not
  need a re-tag for this bump.
- **[install-target]** no committed file changes expected from the update
  itself (a plugin version bump is not a code change in the consumer
  repo); the rehearsal in Step 6 may produce a new spec file, handled the
  same way as Phase 6.2's rehearsal commit if the coordinator wants it
  recorded (optional here — the homework's mandatory commit/PR evidence
  was already satisfied in Phase 6.2).

## Constraints

From `docs/specs/marketplace-extraction/architecture.md`:

- **AC-5**: the 1.1.0 eval must pass on 1.1.0 and fail-or-not-applicable on
  1.0.0 for the *specific new-requirement case* — this must be
  demonstrated by actually running the same case against both versions of
  `spec-creator.md`, not asserted from reading the diff. See Ordered
  steps' before/after sequencing.
- **AC-7**: after activating the stable channel and reinstalling, the
  system must resolve to exactly `sdd-engineering@1.0.0` (pinned tag), and
  a smoke check covering the spec→plan→implement→review path must pass.
- **Immutable tags** (architecture.md:546-548) — `sdd-engineering--v1.1.0`
  is a **new** tag, never a rewrite of `sdd-engineering--v1.0.0`.
- **Dependencies-before-consumer** invariant does not block this bump —
  `sdd-engineering` is the only plugin changing; its three dependencies
  stay at their already-tagged `1.0.0` and still satisfy `^1.0.0`.
- **Marketplace-name-collision bug** (anthropics/claude-code#44042,
  confirmed at Phase 6.1 planning) — the rollback step must always
  `claude plugin marketplace remove dev-digest-ai-marketplace` before
  `add`-ing the pinned-tag source; never add both at once.
- **Model/routing held constant** is Phase 5's constraint for the cost
  experiment specifically — **not directly applicable here** (this phase
  is not a cost A/B), but do not incidentally change `evals/src/config.ts`
  or `EVAL_MODEL` while adding the new eval case.
- **No fabricated `plugin rollback` command** — reuse `scripts/rollback.sh`
  from Phase 6.1 for the rollback step; do not hand-invent a new command
  sequence here.
- **English-only prose**, **no secrets/absolute paths** (AC-8) — applies
  to the `spec-creator.md` edit, the new eval case, and the `CHANGELOG.md`
  entry.
- **"If a plugin could change external state, describe its recovery
  separately"** (lab step 11's explicit instruction) — confirmed for this
  case: `sdd-engineering` has no external state beyond files it writes
  inside the consumer repo (specs/plans/code) and no network/credential
  side effects (per architecture.md's Stack — no adapter in this
  marketplace performs an authenticated call). State this explicitly in
  the rollback step rather than silently skipping the question.

## Skills the implementer will use

None directly — this is an agent-prompt strengthening plus one new
eval-case file plus two doc edits, not React/Fastify/Drizzle/
onion-architecture code.

## Ordered steps

### Step 1 — implementer [marketplace]: strengthen `spec-creator.md`'s Step 4 gate

Edit `plugins/sdd-engineering/agents/spec-creator.md`'s Step 4 self-check
"Traceability" bullet (currently line ~248-251) from a passive
after-the-fact verification into a blocking completion gate. Target
behavior, worded for the agent:

> Before reporting a feature spec as complete: for every Goal/User story
> requirement, confirm at least one `AC-N` covers it. If any requirement
> lacks a corresponding `AC-N`, do not report the spec as complete —
> either add the missing `AC-N` yourself if the criterion is clear from
> context, or, if it is genuinely ambiguous what a checkable criterion for
> that requirement should be, raise it explicitly under `Open questions`
> and continue iterating rather than finalizing the draft.

Keep the existing (already-correct) reverse-direction check — "every
`AC-N` traces back to a Goal or User story" — as a separate bullet; the
1.1.0 change adds the missing direction, it does not replace the existing
one. Do not touch the fixed section templates (Step 3) or the EARS-shape
rules — this is a Step 4 self-check strengthening only, nothing about
*what* an AC-N must look like changes, only whether the spec may be
finalized while one is missing.

### Step 2 — implementer [marketplace]: new eval case (AC-5)

Add a new case alongside the existing `evals/agents/spec-creator/
spec-creator.cases.ts`/`spec-creator.eval.ts` (same `QualityCase`/DSL shape
as the existing dark-mode-toggle case — re-read that file's shape first,
match its conventions exactly, do not invent a new case format). Design
the fixture prompt to name **multiple distinct requirements** for a small
feature (so the eval can check "some requirements have an AC-N, one does
not" is caught) — e.g. a feature with an explicit accessibility
requirement or an explicit error-state requirement that's easy for a
model to describe in prose but skip turning into a checkable `AC-N`. The
grader must fail (or mark not-applicable) the case if any named
requirement has no corresponding `AC-N` in the spec's Acceptance criteria
section, and pass once every requirement does.

### Step 3 — implementer [marketplace]: `CHANGELOG.md` + `plugin.json` bump

1. `plugins/sdd-engineering/CHANGELOG.md` — add, **above** the existing
   `## 1.0.0 — Initial extraction` heading:
   ```markdown
   ## 1.1.0 — Require an acceptance criterion per mandatory requirement

   `spec-creator` no longer reports a feature spec complete while any
   Goal/User story requirement lacks a corresponding `AC-N` — it either
   adds the missing criterion or raises it under `Open questions` first.
   Backward-compatible: a spec that already had full AC coverage is
   unaffected.
   ```
   Use the exact em-dash (`—`) heading shape `parseChangelog` requires
   (Phase 6.1's load-bearing finding) — copy the character from the
   existing `## 1.0.0 — ...` line in the same file, don't retype it.
2. `plugins/sdd-engineering/.claude-plugin/plugin.json` — bump
   `"version"` from `"1.0.0"` to `"1.1.0"`. Do not touch the
   `dependencies` array.

### Step 4 — orchestrating session [marketplace]: BEFORE measurement (1.0.0 behavior)

Before Step 1's edit is committed, or by temporarily reverting it
(`git stash` around the new eval case's run, or checking out
`sdd-engineering--v1.0.0`'s tagged `spec-creator.md` content into a scratch
copy — either technique is fine as long as the case runs against the
**unedited** 1.0.0 prompt):

```sh
cd evals
npm run eval:agents -- -t "<the new case's test name>"
```

Confirm the new case fails or is graded not-applicable against the
unedited (1.0.0) `spec-creator.md` — this is the "old version doesn't
have this behavior" half of AC-5. Record the result.

### Step 5 — orchestrating session [marketplace]: AFTER measurement (1.1.0 behavior) + regression check

With Step 1's edit in place (implementer's real file, not the scratch
copy):

```sh
cd evals
npm run eval:agents -- -t "<the new case's test name>"
npm run eval:agents        # re-run the existing dark-mode-toggle case too
npx vitest run workflow -t "does not activate on an unrelated prompt (AC-9)"
```

Confirm: the new case now passes; the pre-existing dark-mode-toggle case
still passes (no regression from the Step 4 self-check strengthening);
AC-9's negative case is unaffected. This is AC-5's other half plus a
minimal no-regression check reusing Phase 5's two already-real cases.

### Step 6 — orchestrating session [marketplace]: validate + tag 1.1.0

```sh
claude plugin validate ./plugins/sdd-engineering
./scripts/release.sh sdd-engineering
```

`release.sh`'s dependency-satisfaction check should pass trivially (the
three dependencies are already tagged `1.0.0`, satisfying the unchanged
`^1.0.0` ranges). Review the `--dry-run` output, confirm, push. Confirm
afterward: `git tag -l` now also shows `sdd-engineering--v1.1.0`, and
`sdd-engineering--v1.0.0` is unchanged (immutable — do not re-run `claude
plugin tag` against the same version again).

### Step 7 — orchestrating session [install-target]: update

```sh
cd "/Users/viptech/dev/ai agent/plugin-install-target"
claude plugin marketplace update dev-digest-ai-marketplace
claude plugin update sdd-engineering@dev-digest-ai-marketplace --scope project
```

Start a new session / `/reload-plugins`, then repeat a short
`spec-creator` invocation with a deliberately multi-requirement prompt
(similar shape to Step 2's eval fixture) and confirm: trace/telemetry
(same honestly-scoped evidence as Phase 6.2 — `claude plugin list --json`'s
version field, `claude plugin details`, transcript tool-use blocks) shows
`sdd-engineering@1.1.0` active; the resulting spec has an `AC-N` for every
named requirement, or explicitly flags any it couldn't resolve under `Open
questions` — it must not silently ship an uncovered requirement.

### Step 8 — orchestrating session [install-target]: rollback rehearsal

```sh
claude plugin marketplace list --json   # confirm the exact current marketplace name before removing it
```

Then, using `scripts/release.sh`'s sibling `scripts/rollback.sh` (from the
**[marketplace]** checkout, run with `--execute` since this step actually
performs the rollback, not just previews it):

```sh
cd "/Users/viptech/dev/ai agent/dev-digest-ai-marketplace"
./scripts/rollback.sh sdd-engineering sdd-engineering--v1.0.0 --scope project --execute
```

This runs, in order:
```sh
claude plugin marketplace remove dev-digest-ai-marketplace
claude plugin marketplace add viptech/dev-digest-ai-marketplace@sdd-engineering--v1.0.0 --scope project
claude plugin install sdd-engineering@dev-digest-ai-marketplace --scope project
```
executed from **[install-target]**'s context (the marketplace/install
commands act on whichever project session runs them — confirm the
orchestrating session is actually operating against
`plugin-install-target`, not the marketplace repo, when these three run).
Note: pinning the whole marketplace repo to the `sdd-engineering--v1.0.0`
tag also pins `marketplace.json` and all three dependency plugins' own
`plugin.json` to their state at that commit — which is exactly their
already-tagged `1.0.0`, since none of them changed between Phase 6.1 and
this phase. No version drift risk here.

Start a new session / `/reload-plugins` in **[install-target]**, then:

```sh
claude plugin list --json
```

Confirm `sdd-engineering` resolves to exactly `1.0.0` again (AC-7's first
half).

### Step 9 — orchestrating session [install-target]: smoke check (AC-7's second half)

`plugin-install-target` has no automated eval harness of its own (that
infrastructure lives only in `dev-digest-ai-marketplace/evals/`, which
tests plugin content directly via `--plugin-dir`/`Options.plugins`, not
against a marketplace-installed consumer project). The smoke check here is
therefore the same manual repeat used in Phase 6.2 Step 4, done once more:
ask for one more small, real feature covering the
spec→plan→implement→review path (`spec-creator` → `implementation-planner`
→ `run-plan` → the plugin's own `implementer` → `plan-verifier`/
`architecture-reviewer`), confirm it completes successfully end to end,
and run `npm test` in `plugin-install-target` to confirm nothing broke.
Also confirm the 1.1.0-specific behavior (blocking gate on missing AC-N)
is genuinely gone at 1.0.0 — i.e., re-run the same multi-requirement prompt
from Step 7 and confirm the 1.0.0 `spec-creator` does not block on a
missing `AC-N` the way 1.1.0 did (this is the honest "old behavior is back"
confirmation, mirroring AC-5's before/after logic one more time at the
consumer-project level, not just inside `evals/`).

### Step 10 — orchestrating session [install-target]: no plugin-data loss check

Per the lab's explicit instruction ("перевірте, що користувач не втрачає
plugin data" / "опишіть відновлення, якщо плагін міг змінити зовнішній
стан"): confirm the spec/plan/code files the plugin wrote during Phase
6.2's and this phase's rehearsals are still present on disk in
`plugin-install-target` after the rollback (they are ordinary repo files,
untouched by a marketplace-source swap) — state this confirmation
explicitly rather than assuming it, and note (per Constraints above) that
`sdd-engineering` has no other external state to check.

### Step 11 — orchestrating session [install-target]: return to `latest`

Only after Steps 8–10 are all confirmed:

```sh
claude plugin marketplace remove dev-digest-ai-marketplace
claude plugin marketplace add viptech/dev-digest-ai-marketplace --scope project
claude plugin update sdd-engineering@dev-digest-ai-marketplace --scope project
```

Reload/new session, `claude plugin list --json` once more, confirm
`sdd-engineering` is back at `1.1.0`.

## Test plan

- `npm run eval:agents -- -t "<new case>"` — fails/not-applicable on
  unedited (1.0.0) `spec-creator.md` (Step 4), passes after Step 1's edit
  (Step 5). This is AC-5's core evidence.
- `npm run eval:agents` (existing dark-mode case) and `npx vitest run
  workflow -t "does not activate on an unrelated prompt (AC-9)"` — both
  still pass after Step 1's edit (Step 5) — no regression.
- `claude plugin validate ./plugins/sdd-engineering` — clean after the
  version bump (Step 6).
- `git tag -l` shows `sdd-engineering--v1.1.0` in addition to the existing
  four `--v1.0.0` tags, and `sdd-engineering--v1.0.0` is unchanged (Step
  6).
- `claude plugin list --json` in `plugin-install-target` — shows `1.1.0`
  after Step 7, exactly `1.0.0` after Step 8, back to `1.1.0` after Step
  11.
- `npm test` in `plugin-install-target` — green after Step 9's smoke
  rehearsal.
- Manual confirmation (Step 7, Step 9) that the new AC-N-per-requirement
  gate is active at 1.1.0 and genuinely absent at 1.0.0 — not inferred
  from the diff, observed live in both directions.

## Out of scope

Release/tagging of the three dependency plugins (already done, Phase
6.1), the initial 1.0.0 install and its homework commit (already done,
Phase 6.2 — this phase does not need a second commit in
`plugin-install-target` unless the coordinator separately wants one for
the demo), any `gh repo create`/real GitHub PR (still not needed per the
coordinator's Phase 6.2 decision), wiring `.github/workflows/validate.yml`
(still a pre-existing, unaddressed gap — flagged again, not fixed here),
and architecture/security review of the `spec-creator.md` edit or the new
eval case — that review, if wanted, is a separate pass by a review agent,
not this plan's job.
