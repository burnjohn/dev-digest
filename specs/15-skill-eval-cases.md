# Spec: Skill-owned eval cases   |   Spec ID: SPEC-15   |   Status: approved

**Affected modules:** `server`, `client`. Cross-module, hence a root spec.
`reviewer-core` is a consumer-only dependency and is deliberately unchanged
(inherits SPEC-12 D6); `mcp-server`, `agent-runner` and `e2e` are non-goals
for this slice (N6, N7).

**Resolves:** `specs/12-eval-pipeline.md` **N3** — *"Skill-owned eval cases.
The reserved `EvalOwnerKind` enum admits `'skill'`; this slice implements
`'agent'` only."* Nothing in SPEC-12 is superseded; this spec is strictly
additive to it and inherits its decisions except where a decision below says
otherwise.

> **Disambiguation, restated normatively (the same false cognate SPEC-12
> flagged once).** The `evals/` directory at the repository root is a
> *different system*: it evaluates the Claude Code harness — the skills,
> agent prompts and workflow routing under `.claude/` used to *build*
> DevDigest — and its blocking CI gate is `cd evals && pnpm eval:quality`
> (root `CLAUDE.md` §Eval Self-Check). The word "skill" collides too: a
> `.claude/skills/**` skill is a harness skill; a **DevDigest skill** is a
> `skills` table row (`server/src/db/schema/skills.ts:14`) — workspace-owned
> markdown injected into a review agent's prompt. This spec is about the
> latter, as a **product feature** living in `server/` and `client/`.
> Nothing here may read from, write to, or depend on `evals/` or
> `.claude/skills/`, and nothing there may depend on this feature.

## Problem & Motivation

A DevDigest skill is a named, reusable markdown block of reviewer
instructions that any number of agents link, order and toggle. Its own
service says what it is, exactly: *"It has no code, no tools and no
execution: it is text that gets concatenated into the prompt"*
(`server/src/modules/skills/service.ts:33-34`). Skills are first-class in the
product — created, imported, versioned, previewed, linked
(`skills/routes.ts:88-189`) — and every one of them costs tokens on every run
of every agent that links it (`run_skills.tokens`,
`server/src/db/schema/runs.ts:80-81`).

What does not exist is any way to answer the question that a skill's whole
existence rests on:

> Is this skill doing anything?

The product looks like it already answers this. The Skill editor's Stats tab
shows *pull frequency*, *accept rate*, *findings (30d)* and *tokens/run*
(`skills/service.ts:232-244`). It does not answer the question, and the
module's own recorded lesson says so in as many words
(`server/LEARNINGS.md`, 2026-08-03, §*"findings attribution from
`run_skills` is RUN-level, not skill-level, and the UI must say so"*):

> `run_skills` records which skills were injected into *a run's* prompt, not
> which skill produced *which finding* […] So a run that injected four skills
> has all of its findings counted toward all four skills' stats. This
> over-counts by design […] The Stats tab's panel title reflects this too:
> "Findings in runs using this skill", never "caused by".

That is an honest observational statistic and it is the correct thing to show
from the data available. It is not a measurement. It cannot distinguish a
skill that is carrying a review from a skill that is 900 tokens of dead
weight riding along in the same prompt, because both get credited with the
same findings.

SPEC-12 built the machine that *can* answer causal questions of this shape:
a frozen input, a fixed expectation derived from a real human triage
decision, a run executed through the existing review path, and a score
computed entirely in code (`modules/eval/scoring.ts`, zero LLM calls). It
answered it for **agents** — change the system prompt, run the same case set,
read the delta. It deliberately stopped short of skills.

Skills do not transfer directly, and the reason is structural, not
incidental:

- **A skill produces no findings**, so there is no accept/dismiss triage loop
  on a skill and SPEC-12's one-click *turn-this-finding-into-a-case* flow
  (`eval/routes.ts:30`, `eval/service.ts:154`) has no direct analogue.
- **A skill cannot be executed.** `EvalExecutor.runCase` needs a system
  prompt, a model and a strategy (`modules/eval/executor.ts:55-64`); a skill
  row carries none of them (`schema/skills.ts:14-39`). There is nothing to
  run a skill *against*.

So this feature has to define, from first principles, what a skill-owned eval
case tests. The answer this spec adopts: a skill-owned case tests the skill's
**marginal contribution** — the same frozen input, the same carrier agent,
the same expectation, executed twice, once with the skill's block in the
prompt and once without it. The difference between the two arms is the only
number in this product that is attributable to one skill and to nothing else.
It is the controlled experiment the Stats tab's observational numbers are
explicitly not.

### This space is already reserved in four independent places

Following SPEC-11's and SPEC-12's precedent: read first, adopted rather than
duplicated (D1).

1. **Schema.** `eval_cases.owner_kind` and `eval_runs.owner_kind` are both
   `text(..., { enum: ['skill', 'agent'] })`
   (`server/src/db/schema/eval.ts:31,69`), with the polymorphic
   `owner_kind`/`owner_id` index already in place (`eval.ts:58,97-103`).
   Zero rows exist with `owner_kind = 'skill'`.
2. **Contracts.** `EvalOwnerKind = z.enum(['skill', 'agent'])`
   (`vendor/shared/contracts/knowledge.ts:198`), carried through
   `EvalCase.owner_kind` (`knowledge.ts:231`) and `EvalRunRecord.owner_kind`
   (`vendor/shared/contracts/eval-ci.ts:58`).
3. **Server internals.** `EvalRepository` is already `ownerKind`-generic on
   every case and run path (`modules/eval/repository.ts:134,195,243,272,317`).
   What is agent-only is the **route surface** — every route is
   `/agents/:id/eval/*` (`eval/routes.ts:41,72,78,88,121`) — the service's
   hardcoded `'agent'` literals (`eval/service.ts:224,250,314,331,338,368`),
   and the dashboard's owner filter (`repository.ts:344`).
4. **UI slots.** The Skill editor already ships an `evals` tab in its tab bar
   (`client/.../SkillEditor/constants.ts:16`, `SkillsView/constants.ts:4`), a
   permanently-`disabled` "Run on evals" button in the editor header
   (`client/.../SkillsView/SkillsView.tsx:152-161`), and an `EvalsTab.tsx`
   whose entire body is an `EmptyState` under a comment that names this
   slice: *"an honest placeholder. `eval_cases.ownerKind` already accepts
   'skill', so nothing here needs re-designing when L06 lands"*
   (`client/.../SkillEditor/_components/EvalsTab/EvalsTab.tsx:1-3`). The i18n
   strings already exist and already say the runner is not built
   (`client/messages/en/skills.json:100-101,167-170`).

The reserved shapes fit better than SPEC-12's did — the polymorphism is real
and generic. The two places they do **not** stretch are the run's identity
columns (`eval_runs` records `agent_version` and nothing about a skill,
`eval.ts:77`) and the single-arm run model. Both are resolved explicitly
below.

## Goals / Non-goals

### Goals

- **G1** — Give a skill a runnable eval case set of its own, using the
  reserved `owner_kind = 'skill'` surface rather than any parallel concept.
- **G2** — Define what a skill-owned case *tests*: the skill's marginal
  effect on a fixed, frozen input, holding everything else — carrier agent,
  model, system prompt, other skills, diff — identical between the two arms.
- **G3** — Create cases from evidence the product already holds: a triaged
  finding from a review whose prompt **provably** contained this skill, with
  hand-authoring as the fallback for a skill that has never run.
- **G4** — Report the skill's effect as a **lift** per metric plus a per-case
  effect classification (helped / hurt / no effect), computed with zero LLM
  calls in the scoring path.
- **G5** — Keep SPEC-12's three metrics intact and unredefined, so every
  existing eval surface, contract and test keeps meaning what it means.
- **G6** — Make a skill body edit's effect legible: run the same case set
  against skill version *v(n)* and *v(n+1)* and read the difference, with a
  diff of the two skill bodies.
- **G7** — Put the skill's lift next to the skill's token cost, so "does this
  skill earn its tokens?" is answerable on one screen.
- **G8** — Make the doubled cost of an ablation run visible before it is
  incurred, and never incurred by merely looking at a surface.
- **G9** — Fill the reserved Skill-editor Evals tab and the reserved
  "Run on evals" button, and add skills to the existing Eval Dashboard as a
  distinct section — never merged into the agent table.

### Non-goals (explicitly out of scope for this slice)

- **N1 — Any LLM-based grading.** Inherited verbatim from SPEC-12 N1. Every
  number, classification and sentence this feature displays is computed
  deterministically from stored run data (AC-20, AC-42). Defining constraint,
  not a budget preference.
- **N2 — Changing anything about agent-owned eval cases or runs.** No
  existing route response, metric definition, scoring rule, surface or
  contract changes meaning; additions are additive only (AC-45).
- **N3 — Per-finding skill attribution.** This feature does **not** fix
  `run_skills`' run-level over-count. Making the model name a skill per
  finding is a `Review` schema change (`server/LEARNINGS.md`, 2026-08-03),
  explicitly out of scope; the ablation arm is a *substitute* signal, not a
  repair of that statistic.
- **N4 — Changing the Stats tab's existing observational numbers.**
  `pull_pct`, `accept_pct`, `findings_30d`, `by_category`, `avg_tokens`
  (`skills/service.ts:232-244`) keep their current definitions and their
  current honest-over-count captions.
- **N5 — Gating anything on lift.** A negative lift does not disable a skill,
  unlink it from an agent, block a body edit, fail CI, or block a merge.
- **N6 — An MCP tool** exposing skill eval cases, runs or lift.
- **N7 — An e2e browser flow**, consistent with the SPEC-09/10/11/12
  precedent.
- **N8 — Automatic runs.** No run is triggered by a skill body being saved, a
  skill being linked to an agent, a review completing, a page opening, a
  schedule, or CI. Every run is an explicit user action (SPEC-12 D11).
- **N9 — Cross-skill ranking.** Two skills' case sets are different sets over
  different carriers; the surface must not imply a leaderboard (AC-40,
  SPEC-12 N6's reasoning applied to skills).
- **N10 — Promote / auto-apply.** No action makes a skill version current
  because it scored better (SPEC-12 N12's posture, inherited).
- **N11 — Exporting or importing skill case sets** between workspaces or
  repos.
- **N12 — Any coupling to root `evals/`.** See the disambiguation note.

### Decisions

- **D1 — Adopt the reserved `'skill'` owner kind and the existing
  `ownerKind`-generic repository; introduce no parallel table, contract or
  owner concept.** `eval_cases.owner_kind`/`eval_runs.owner_kind` already
  admit `'skill'` (`schema/eval.ts:31,69`), `EvalOwnerKind` already exports
  both values (`knowledge.ts:198`), and `EvalRepository` already threads
  `ownerKind` through every case and run query
  (`repository.ts:134,195,243,272,317`). The work is widening the route
  surface, the service's `'agent'` literals and the dashboard filter
  (`repository.ts:344`) — not building a second eval system beside the first.
  This is the same trap `server/LEARNINGS.md` (2026-08-04) records and SPEC-12
  D1 already paid for once.

- **D2 — A skill cannot be run on its own; every skill-owned run executes
  through a *carrier agent*.** A skill row has no provider, model, system
  prompt or strategy (`schema/skills.ts:14-39`) and the executor requires all
  four (`modules/eval/executor.ts:55-64`, `modules/eval/ports.ts:20-28`).
  There is no coherent reading of "run this skill" that does not name an
  agent to run it inside. The carrier is therefore a required, recorded
  parameter of every skill-owned run, not an implementation detail.

- **D3 — A skill-owned suite run is *two-armed*: each case is executed twice
  against the same carrier, identical in every respect except the presence of
  this skill's rendered block. The skill's headline number is the difference
  between the arms.** This is the decision that answers "what does a
  skill-owned eval case test", and it is the one the rest of the spec hangs
  on. A one-armed run would produce recall/precision/citation-accuracy for
  *the carrier agent with this skill switched on* — a number SPEC-12 already
  produces, attributable to the carrier's prompt and model as much as to the
  skill, and therefore adding no information the product lacks. The product's
  existing skill-level signal is explicitly non-causal by its own recorded
  design (`server/LEARNINGS.md` 2026-08-03; `skills/repository.ts:398-401`),
  so a causal one is the whole reason to build this. The cost consequence is
  real and is stated rather than buried: a skill run is **2 × cases**
  executions, not *cases* (AC-25, AC-26).

- **D4 — SPEC-12's three metrics are retained verbatim and are computed on
  the *with-skill* arm; lift is an additional figure, never a redefinition.**
  `recall`, `precision` and `citation_accuracy` keep the exact definitions in
  SPEC-12 AC-18/AC-19/AC-21 and the exact code that computes them
  (`modules/eval/scoring.ts`). Every existing tile, trend point, delta and
  dashboard row therefore keeps rendering unchanged for a skill-owned run.
  Lift is `with_arm − without_arm` per metric, reported alongside.

- **D5 — Per-case effect is a closed, deterministic four-value
  classification.** For each case, both arms yield a pass/fail under SPEC-12
  AC-17's existing rule. The case's effect is exactly one of: `helped`
  (fails without, passes with), `hurt` (passes without, fails with),
  `no_effect_pass` (passes in both), `no_effect_fail` (fails in both). This
  is the skill-level analogue of SPEC-12 D12's "derived, not narrated"
  posture — the callout names the cases the classification identifies, and
  asserts nothing it cannot substantiate.

- **D6 — A skill-owned run records the skill version *and* the carrier agent
  identity and its configuration version.** SPEC-12 D4's reasoning applied to
  three identities instead of one. `skills.version` and `skill_versions.body`
  already exist (`schema/skills.ts:34,41-52`) and are already served
  (`skills/routes.ts:148-160`); `eval_runs` today records only `agent_version`
  (`schema/eval.ts:77`) and nothing about a skill or a carrier. Without all
  three, "which change moved the number?" is unanswerable and G6's body diff
  has no source. Whether that is new columns or a widened row is a planning
  decision, not a spec one.

- **D7 — The two arms of one case must be identical apart from the skill
  block.** The direct analogue of SPEC-12 AC-10, and the invariant the whole
  lift number depends on: if anything else differs between arms — ordering of
  the other skills, PR metadata, task line, diff bytes — the difference stops
  being attributable to the skill (AC-16).

- **D8 — The with-arm injects the skill's body regardless of both enable
  gates, and the surface says so.** A skill reaches a real review prompt only
  when `skills.enabled` (workspace/vetting gate, `schema/skills.ts:33`) **and**
  `agent_skills.enabled` (per-agent gate, `schema/agents.ts:65`) are both true
  — "TWO GATES, ONE RULE" (`skills/service.ts:36-41`). If an eval run honoured
  them, a disabled skill would produce a with-arm identical to its
  without-arm, a lift of exactly zero on every case, and a screen that looks
  like a measurement while measuring nothing. So the with-arm bypasses both
  gates. The consequence must be stated rather than discovered: imported
  skills land `enabled: false` *specifically* because a human has not read
  them yet (`schema/skills.ts:31-33`), so this path can send an unvetted,
  third-party-authored body to a provider. That is acceptable for a
  deliberate, per-run, explicitly-confirmed user action and unacceptable
  silently — hence AC-11 and AC-52.

- **D9 — Everything about a case's *input* is inherited from SPEC-12
  unchanged.** Frozen, self-contained input never re-fetched (SPEC-12 D8);
  prompt parity — no repo map, callers digest, project-context document, live
  PR description or derived intent (SPEC-12 D9, asserted in
  `modules/eval/executor.ts:15-19`); diff scoped to the expectation's own file
  (SPEC-12 D16); idempotent creation from a finding (SPEC-12 D17, enforced by
  `eval_cases_source_finding_uq`, `schema/eval.ts:57`); 15-minute stale-run
  reconciliation before the in-flight guard (SPEC-12 D19,
  `eval/service.ts:331-340`). None of these are re-litigated here.

- **D10 — A case is created either from a triaged finding whose run provably
  injected this skill, or by hand.** The first path is the true analogue of
  SPEC-12 G1 and it is backed by data the product already writes:
  `run_skills` records exactly which skills were in a given run's prompt and
  is written at assembly time precisely so it stays true after links are
  toggled (`schema/runs.ts:59-87`), and `reviews.run_id` (`schema/reviews.ts:19`)
  joins that run to its findings — the same join the Stats tab already
  performs (`skills/repository.ts:413-429`). So "this accepted finding came
  out of a review that had this skill loaded" is a deterministic, already-
  queryable fact, and the expectation type derives from the human's existing
  accept/dismiss decision exactly as in SPEC-12 AC-3/AC-4. The caveat is
  stated on the surface, not hidden: `run_skills` proves the skill was
  *present*, never that it *caused* the finding (N3) — which is precisely why
  the without-arm exists. The second path (hand-authored: a pasted diff
  fragment plus an expectation) is required because a newly created or
  imported skill has never run and therefore has no findings to draw on; it
  is subject to the same grounding validation as any other case (SPEC-12
  AC-6).

- **D11 — The carrier is chosen per run, not stored per case.** A set-level
  metric over cases with different carriers would not be one measurement. The
  carrier is selected from the agents currently linked to this skill
  (`agent_skills`), recorded on the run (D6), and a comparison between two
  runs with different carriers must state that difference rather than present
  a bare delta — the same guard SPEC-12 AC-33 applies to differing case sets.

- **D12 — Eval executions must not write `agent_runs` or `run_skills`.** They
  do not today: `EvalExecutor` calls `reviewPullRequest` directly and records
  nothing in the observability tables (`modules/eval/executor.ts:55-79`). That
  must remain true, and it becomes load-bearing here: if ablation runs wrote
  `run_skills` rows, this feature would corrupt `pull_pct`, `accept_pct` and
  `avg_tokens` — the very Stats-tab numbers it exists to complement
  (`skills/repository.ts:353-475`).

- **D13 — Lift is displayed against the skill's token cost.** G7's whole
  point. The block's real tokenizer count is already computed and already
  served by `GET /skills/:id/preview` (`skills/service.ts:210-231`), using the
  same tokenizer the run executor uses — so the cost side needs no new
  measurement, only placement next to the effect side.

- **D14 — Skills join the existing Eval Dashboard as a distinct section, and
  are never merged into the agent table.** They are not comparable to agents
  (different metric meaning: lift vs level) and not comparable to each other
  (different case sets, different carriers). SPEC-12 N6/AC-43's "not a
  ranking" statement applies twice over (N9, AC-40).

## User stories

- **US-1** — As a skill author looking at a skill that has been running for
  weeks, I can finally tell whether it is doing anything, instead of reading
  an accept-rate that credits it for every finding in every run it merely sat
  in. *(AC-17, AC-18, AC-19, AC-21, AC-34)*
- **US-2** — As a reviewer who accepted a finding, I turn it into an eval case
  for one of the skills that was actually in that review's prompt, and the
  case remembers that this skill should help find that problem there.
  *(AC-1, AC-2, AC-3, AC-4, AC-6, AC-7)*
- **US-3** — As a reviewer who dismissed a noisy finding, I turn it into a
  case for a skill that was in that prompt, and the case remembers that this
  skill should not provoke a comment there. *(AC-1, AC-2, AC-3, AC-5, AC-6,
  AC-7)*
- **US-4** — As the author of a skill I just created or imported, which has
  never run and so has no findings, I can still author a case by hand from a
  pasted diff fragment and an expectation. *(AC-8, AC-9, AC-10)*
- **US-5** — As a skill author, I run the skill's whole case set in one
  action, having picked which agent it runs inside, and get the skill's lift
  on recall, precision and citation accuracy. *(AC-11, AC-12, AC-13, AC-14,
  AC-15, AC-16, AC-17, AC-18, AC-19, AC-22)*
- **US-6** — As a skill author, I see per case whether the skill helped, hurt,
  or changed nothing — and can open the one case where it hurt.
  *(AC-20, AC-21, AC-35, AC-36)*
- **US-7** — As a skill author, I edit the skill body, run the same case set
  again, and see the lift move, with a line-by-line diff of the two bodies
  that produced the two runs. *(AC-30, AC-31, AC-32, AC-33)*
- **US-8** — As a skill author, I see the skill's lift next to what the skill
  costs per run in tokens, so I can decide whether it earns its place in the
  prompt. *(AC-34)*
- **US-9** — As a workspace owner, I know a skill run costs twice a case count
  before I trigger it, and what it cost after. *(AC-25, AC-26, AC-27, AC-28)*
- **US-10** — As a workspace owner, opening any eval surface — including the
  new skill ones — never spends money. *(AC-29)*
- **US-11** — As a workspace owner, I open the Eval Dashboard and see skills
  as their own section with their own headline number, never mixed into or
  ranked against the agent table. *(AC-39, AC-40)*
- **US-12** — As a skill author comparing two runs that used different
  carriers or different case sets, I am told they differ and how, instead of
  being handed a delta that quietly compares two different things. *(AC-32)*
- **US-13** — As someone whose run partly failed, I get the run with the
  failed cases named and excluded from every metric and from lift, not a
  silently skewed number. *(AC-23, AC-24)*
- **US-14** — As a skill author whose skill has no cases, no linked agent, or
  no completed run, each surface tells me what is missing and what to do,
  instead of showing zeroes or a zero lift I would misread. *(AC-37, AC-38,
  AC-41, AC-49)*
- **US-15** — As a workspace owner, running an eval never quietly changes what
  my *reviews* do: it does not enable a skill, does not link it to an agent,
  and does not move any Stats-tab number or any agent-owned eval number.
  *(AC-42, AC-44, AC-45, AC-46)*
- **US-16** — As a security-conscious owner, I am told when an eval run is
  about to send a skill body that no human in my workspace has vetted, and a
  hostile skill body, diff or finding text cannot issue instructions to my
  model or inject markup into my browser. *(AC-11, AC-50, AC-51, AC-52)*
- **US-17** — As a workspace member, I can never read or run another
  workspace's skill cases, runs, or use another workspace's agent as a
  carrier. *(AC-53)*
- **US-18** — As a keyboard or screen-reader user, I can create a case, pick a
  carrier, run a set, and read the lift and the per-case effect without a
  mouse and without relying on colour. *(AC-47, AC-48)*
- **US-19** — As a skill author whose skill I deleted, no unreachable eval
  cases or runs are left behind in the workspace. *(AC-43)*
- **US-20** — As a maintainer, one command tells me this feature is wired end
  to end, including that both `vendor/shared` copies still agree.
  *(AC-54, AC-55)*

## Acceptance criteria (EARS)

*Terms used below.* A **skill case** is a stored eval case whose owner is a
skill. A **carrier** is the agent a skill-owned run executes inside (D2). The
**with-arm** is the execution of one case whose prompt contains this skill's
rendered block; the **without-arm** is the otherwise-identical execution
whose prompt does not (D3). A case's **effect** is one of `helped`, `hurt`,
`no_effect_pass`, `no_effect_fail` (D5). **Lift** for a metric is that
metric's with-arm value minus its without-arm value over the same cases.
*Expectation*, *matches*, *frozen input*, *suite run* and *pass/fail* carry
SPEC-12's definitions unchanged.

### Case creation from a triaged finding

- **AC-1** — WHEN a user activates the turn-into-skill-eval-case action on a
  triaged finding for a given skill, the system shall create one case owned by
  that skill; IF a case already exists for that finding and that skill, THEN
  the system shall return the existing case rather than creating a duplicate.
  *Verify: activating the action twice on the same finding and skill yields
  exactly one case in that skill's set.*
- **AC-2** — The system shall offer a skill as a target for that action only
  WHERE the finding's review was produced by a run whose recorded injected-
  skill set contains that skill.
  *Verify: a skill that was linked to the agent but not injected into that
  run is not offered, and a skill that was injected is.*
- **AC-3** — WHEN a case is created from a finding, the system shall derive
  the expectation type from the human triage decision already recorded —
  accepted → `must_find`, dismissed → `must_not_flag` — and shall require no
  further input.
- **AC-4** — WHEN a case is created from an **accepted** finding, the case's
  expectation shall carry the finding's file and its `start_line`–`end_line`
  range with type `must_find`.
- **AC-5** — WHEN a case is created from a **dismissed** finding, the case's
  expectation shall carry the finding's file and its `start_line`–`end_line`
  range with type `must_not_flag`.
- **AC-6** — WHEN a case is created, the system shall store on it a frozen,
  self-contained input — unified diff, file list and pull-request metadata —
  and shall not store a reference that must be re-fetched at run time.
  *Verify: a skill case still runs unchanged after its source pull request,
  review and repository record are deleted.*
- **AC-7** — The system shall keep a skill case's expectation fixed after
  creation, so that a later change to its source finding's triage state, or a
  later change to which skills that agent links, does not alter the case.

### Hand-authored cases

- **AC-8** — The system shall allow a case to be authored for a skill directly
  from a supplied diff fragment, expectation and name, without requiring a
  source finding.
- **AC-9** — IF a supplied or edited expectation's line range does not
  intersect any hunk of the case's diff for that file, THEN the system shall
  refuse to create or update the case and state that reason.
  *Verify: authoring a case whose expectation lines fall outside every hunk is
  refused with a stated reason and creates no case.*
- **AC-10** — IF a supplied case payload fails validation against the case and
  expectation contracts, THEN the system shall reject it, name the failing
  field, and leave any stored case unchanged.

### Running a two-armed suite

- **AC-11** — WHEN a user requests a run for a skill, the system shall require
  the user to select a carrier from the agents currently linked to that skill,
  and shall state, before any execution starts, the number of cases, the total
  execution count, and — WHERE either enable gate is currently off for this
  skill and carrier — that the run will inject the skill's body despite it not
  being active in real reviews.
  *Verify: requesting a run for a workspace-disabled skill surfaces that
  statement before any provider call.*
- **AC-12** — WHEN a run is started, the system shall execute every case in
  the skill's set twice against the selected carrier — once with the skill's
  rendered block present in the prompt and once with it absent — using the
  existing review execution path and supplying each case's frozen input as the
  diff.
- **AC-13** — The prompt assembled for either arm shall contain only the
  carrier's versioned identity — system prompt, model, strategy and its other
  linked skill bodies — together with the case's frozen input, and shall
  contain no repository map, callers digest, project-context document, live
  pull-request description or derived intent.
- **AC-14** — WHILE a suite run is in flight for a skill, the system shall not
  start a second run for that skill, and shall surface the in-flight state
  rather than queueing or duplicating it.
- **AC-15** — IF a run for a skill has been in flight beyond the product's
  existing staleness timeout, THEN the system shall mark it interrupted before
  evaluating AC-14's guard, so a restart cannot deadlock the skill's runs.
- **AC-16** — The system shall supply, for each case, model input for the
  two arms that is byte-identical except for this skill's rendered block —
  including the ordering and content of the carrier's other skill blocks, the
  frozen diff, and the pull-request metadata.
  *Verify: assemble both arms for one case and assert the two inputs differ
  only by this skill's block.*

### Scoring — deterministic, zero LLM calls

- **AC-17** — The system shall compute, for each arm of a run, `recall`,
  `precision` and `citation_accuracy` using the product's existing metric
  definitions, without redefining, re-implementing or varying any of them.
- **AC-18** — The system shall report a run's `recall`, `precision` and
  `citation_accuracy` as the with-arm values, so that a skill-owned run
  renders through the same metric surfaces as an agent-owned run.
- **AC-19** — The system shall compute a `lift` for each of the three metrics
  as the with-arm value minus the without-arm value over the cases scored in
  both arms.
  *Verify: a run whose without-arm recall is 0.5 and with-arm recall is 0.75
  reports a recall lift of +0.25.*
- **AC-20** — The system shall classify each case's effect as exactly one of
  `helped`, `hurt`, `no_effect_pass` or `no_effect_fail`, derived from the
  case's pass/fail outcome in each arm under the existing per-case pass rule.
- **AC-21** — The system shall compute every metric, lift, per-case effect,
  delta, trend point and callout sentence without making any LLM call.
  *Verify: score a run from stored execution outputs against a stubbed
  provider and assert zero provider calls.*
- **AC-22** — WHERE a metric's denominator is zero in either arm, the system
  shall report that metric, and its lift, as not applicable rather than as
  zero, one, or an error.
  *Verify: a run over only `must_not_flag` cases reports recall and recall
  lift as not applicable rather than 0.*
- **AC-23** — IF either arm of a case fails to execute — provider error,
  timeout, or an unvalidatable response — THEN the system shall complete the
  run, mark that case errored with its reason, exclude it from both arms'
  metrics and from every lift, and record how many cases errored.
  *Verify: a run in which one arm of one case fails yields stored metrics
  computed over the remaining cases and an errored-case count of one.*
- **AC-24** — WHEN a run completes, the system shall store both arms' metrics,
  the per-metric lift, the per-case effects and outcomes, the skill version it
  ran, the carrier's identity and configuration version, the exact set of case
  ids it covered, its duration, its errored-case count and its cost.

### Cost and spend control

- **AC-25** — WHEN a user requests a run, the system shall state that the run
  executes twice per case and shall state the resulting total execution count
  before any execution starts.
  *Verify: an estimate for a skill with 8 cases states 16 executions, not 8.*
- **AC-26** — WHEN a user requests a run of every skill at once, the system
  shall require an explicit confirmation stating the total number of
  executions, and shall start no execution until that confirmation is given.
- **AC-27** — WHEN a run completes, the system shall display its total cost
  and duration alongside its metrics and lift.
- **AC-28** — The system shall rate-limit skill run triggering per workspace
  under the product's existing run rate limit, so that a repeated or automated
  trigger cannot start an unbounded number of executions.
- **AC-29** — WHEN a user opens any skill eval surface — the skill's Evals
  tab, a skill case editor, the dashboard's skills section, or a skill run
  comparison — the system shall make no LLM call.
  *Verify: repeated loads of every skill eval surface against a stubbed
  provider produce zero provider calls.*

### The demonstration this feature must support

- **AC-30** — The system shall run and score, as one two-armed suite run, a
  skill whose case set contains at least four cases including at least one
  `must_find` and at least one `must_not_flag` case.
- **AC-31** — WHERE a skill's body is edited between two runs over the same
  case set with the same carrier, the system shall attribute each run to the
  distinct skill version that produced it and present the difference between
  the two runs' metrics and lifts.
  *Verify: run a fixed case set, edit the body so the skill stops naming the
  pattern a `must_find` case targets, re-run the same set with the same
  carrier, and read the recall lift fall.*

### Compare

- **AC-32** — WHEN two skill runs are compared, the system shall present each
  metric's and each lift's old value, new value and delta; IF the two runs
  covered different case sets **or** used different carriers, THEN the system
  shall state that they differ, name the difference, and compute the deltas
  over the cases common to both.
  *Verify: comparing two runs of one skill taken under different carriers
  states the carrier difference rather than presenting a bare delta.*
- **AC-33** — WHEN two skill runs attributed to different skill versions are
  compared, the system shall present a line-oriented difference between the
  two skill bodies, distinguishing removed from added lines.

### Client surface — the Skill editor's Evals tab

- **AC-34** — The Skill editor's Evals tab shall present, for the selected
  skill: the latest run's three metrics with their lifts; a count of cases
  helped, hurt and unaffected; the skill's per-run token cost; the case list;
  and the run history.
- **AC-35** — Each case in the list shall show its name, its expectation type,
  its origin (which finding, or hand-authored), its effect classification from
  the latest run, and actions to open, edit and delete it.
- **AC-36** — WHEN a user opens a skill case, the system shall present its
  name, its frozen input separated into diff, files and pull-request metadata,
  its expectation in an editable form, and — for the latest run that covered
  it — its outcome and findings in **both** arms side by side.
- **AC-37** — WHERE a skill has no cases, the Evals tab shall state that no
  cases exist and how to create one, and shall display no metric or lift
  values.
- **AC-38** — WHERE a skill has cases but no completed run, the Evals tab
  shall state that it has never been run, and shall display no metric values,
  no lift and no trend.

### Client surface — Eval Dashboard

- **AC-39** — The Eval Dashboard shall present skills in a section distinct
  from its agent section, listing every skill that owns at least one case with
  its latest run's lift, its cases-helped/hurt counts and its carrier.
- **AC-40** — The dashboard shall state that a skill's numbers are computed
  over that skill's own case set inside a chosen carrier, and shall not
  present skills' numbers as a ranking, nor merge them into the agent table.
- **AC-41** — WHERE a skill's latest run reports a lift of zero on every
  metric, the surface shall state that the skill changed no outcome on this
  case set, rather than presenting an unlabelled zero.

### Preserving existing behaviour

- **AC-42** — Every existing agent-owned eval route, response shape, metric
  value and surface shall behave exactly as before this feature.
  *Verify: the existing agent eval route and scoring suites pass unchanged.*
- **AC-43** — WHEN a skill is deleted, the system shall delete that skill's
  eval cases and their runs, leaving no unreachable eval rows in the
  workspace.
  *Verify: after deleting a skill that owned cases, no eval case or run rows
  remain for that owner id.*
- **AC-44** — A skill eval run shall not enable a skill, link it to any agent,
  change any `agent_skills` or `skills` row, or otherwise alter what a real
  review would inject.
- **AC-45** — A skill eval execution shall not be recorded as an agent run and
  shall not record injected-skill rows, so that the Skill Stats tab's pull
  frequency, accept rate, findings and tokens-per-run figures are unchanged by
  any number of eval runs.
  *Verify: a skill's Stats-tab payload is byte-identical before and after a
  completed eval run.*
- **AC-46** — WHERE this feature reads or displays the existing Stats-tab
  figures alongside its own, it shall keep their existing run-level
  attribution caption and shall not present them as caused by the skill.

### Accessibility

- **AC-47** — Every metric, lift, delta and per-case effect shall be
  distinguishable without relying on colour alone, and any trend shall have a
  non-graphical equivalent conveying the same values.
- **AC-48** — Creating a case, selecting a carrier, starting a run, selecting
  two runs and opening a case shall each be operable from the keyboard, and a
  change in a run's status shall be announced to assistive technology.

### Failure states, contracts, security and access

- **AC-49** — IF a run cannot start — no cases, no agent linked to the skill,
  no provider key configured for the selected carrier's provider, or a run
  already in flight — THEN the system shall state which of those applies and
  shall create no run record.
- **AC-50** — The system shall treat a case's stored diff, file list,
  pull-request metadata, text carried over from its source finding, **and the
  skill body itself** as untrusted data, passing them to the model under the
  product's existing shared injection guard and never as instructions.
- **AC-51** — The system shall render all skill-authored, case-authored and
  model-authored text — skill bodies and body diffs, case names, notes,
  expectation contents, and both arms' finding titles and rationales —
  through the product's existing sanitised renderer, and shall not render
  supplied markup as markup.
  *Verify: a skill body containing a script tag renders it as visible text in
  the body diff.*
- **AC-52** — WHERE a run would inject a skill body that is not currently
  active in real reviews under either enable gate, the system shall record
  that fact on the run and display it on every surface presenting that run's
  numbers.
- **AC-53** — WHERE a skill eval case, run, or a carrier agent belonging to
  another workspace is requested — for read, run, edit, delete or comparison —
  the system shall not disclose it and shall not act on it, over any surface.
  *Verify: a request naming another workspace's agent as a carrier is refused
  before any case row is read.*
- **AC-54** — Every contract this feature adds or reshapes shall be present
  and identical in both `vendor/shared` copies, and the feature shall not
  increase the existing divergence between them.
- **AC-55** — The existing mechanical verification command shall be extended
  to cover this feature and shall pass, checking at least: that this feature's
  migrations apply cleanly; that both `vendor/shared` copies of the affected
  contracts agree (AC-54); that the skill eval routes respond over their
  documented surface; and that the two-arm scoring unit suite — covering
  AC-17 through AC-23, including AC-22's zero-denominator cases — is green.

## Edge cases

- **A skill linked to zero agents.** There is no carrier, so no run can be
  formed. Refused with that stated reason and no run record (AC-49), rather
  than silently running against an arbitrary agent.
- **A skill switched off at either gate.** The with-arm still injects it (D8);
  the run says so before it starts (AC-11) and every surface presenting its
  numbers repeats it (AC-52). Without D8 the run would silently measure
  nothing and report a lift of exactly 0.0 on every case — the most dangerous
  possible failure mode for this feature, because it looks like a result.
- **An imported, never-vetted skill body.** `enabled: false` on import exists
  precisely because a human has not read it (`schema/skills.ts:31-33`). An
  eval run is a deliberate, confirmed user action that sends it to a provider
  anyway; AC-11 makes that visible at the moment of the decision.
- **Both arms produce identical findings.** Legitimate and common: this skill
  changed nothing on this case set. It must render as a stated no-effect
  result (AC-41), never as a bare zero the reader mistakes for a failure or
  for "not measured".
- **The skill hurts.** A `hurt` case is a real, publishable result, not an
  error state; the surface must present it as a finding about the skill
  (AC-20, AC-35), not as a broken case.
- **The carrier's system prompt already says what the skill says.** Lift is
  near zero and that is the correct answer — the skill is redundant *for this
  carrier*. The carrier is recorded on the run (D6) so the number is never
  read as carrier-independent.
- **Carrier changed between two runs.** Stated, and deltas computed over the
  intersection (AC-32) — the same guard SPEC-12 applies to differing case
  sets, extended to a second axis.
- **Skill body edited mid-run.** The run is attributed to the version it
  started with (AC-24); past runs remain readable as what they scored at the
  time and are never recomputed.
- **A case created from a finding, then the agent unlinks the skill.** The
  case is unaffected (AC-7) — it holds a frozen input and a fixed expectation,
  and its owner is the skill, not the link.
- **The same finding turned into cases for three different injected skills.**
  Allowed and meaningful: `run_skills` says all three were present, and only
  the ablation can distinguish them. Each is a separate case under a separate
  owner; AC-1's idempotency is per finding *and* skill.
- **A finding whose review predates this feature.** Works as long as the run's
  injected-skill rows exist; runs that never wrote them offer no skills
  (AC-2), which is a correct empty state rather than a guess.
- **A skill deleted while it still owns cases.** `eval_cases.owner_id` is
  polymorphic with no foreign key (`schema/eval.ts:32`), so nothing cascades
  at the database level even though `agent_skills`/`run_skills` do
  (`schema/skills.ts:41-52`, `schema/runs.ts:72-77`). Explicit deletion is
  required (AC-43) — the SPEC-12 D18 problem, second instance.
- **A skill and an agent both running evals at once.** Allowed; the in-flight
  guard is per owner (AC-14). Combined provider load is why AC-26 and AC-28
  exist, and it is worse here because each skill case is two executions.
- **A very large skill body.** Replayed into the with-arm of every case on
  every run, forever, on top of the frozen diff. A single oversized skill
  taxes every future run of its set at double the case count.
- **A skill whose body is edited to something malformed or hostile.** Rendered
  sanitised in the body diff (AC-51) and passed to the model as data (AC-50);
  the existing body size cap (`skills/service.ts:475-482`) still applies.
- **One arm succeeds and the other errors.** The case is unusable for a
  comparison it is half of, so it is excluded from both arms and from lift
  (AC-23) — never scored as a `helped`/`hurt` on one arm's data.

## Non-functional

- **Attribution validity.** This is the feature's primary quality attribute.
  If the two arms differ by anything other than the skill's block, the lift
  number is not about the skill and the feature is worse than nothing —
  because it *looks* like a measurement. AC-16 states the invariant; D7 and
  D9's inherited freezing and prompt-parity decisions are what make it
  achievable.
- **Cost.** A skill run is 2 × cases executions, and "run all skills" is
  2 × skills × cases. Stated before the action (AC-25, AC-26), attributed
  after it (AC-24, AC-27), rate-limited (AC-28), never incurred by looking
  (AC-29). Scoring is free by construction (AC-21).
- **Security — an unvetted body reaching a provider (A01/A06 posture).** D8's
  gate bypass is a deliberate, argued exception to the product's two-gate rule
  and the one genuinely new exposure this feature creates. It is bounded to an
  explicit per-run user action, surfaced before the spend (AC-11) and recorded
  on the run (AC-52). It must never become a path by which a skill reaches a
  real *review* prompt (AC-44).
- **Security — untrusted input to the model.** A case's frozen diff, file
  paths and PR metadata are contributor-controlled on any repo accepting
  outside contributions; a skill body may be third-party (`source:
  'imported_url'` / `'community'`, `schema/skills.ts:27-29`). All travel under
  the product's existing shared injection guard as data (AC-50); no
  per-feature keyword scanning is introduced, consistent with
  `reviewer-core/CLAUDE.md` §Do-not-touch.
- **Security — untrusted output rendered in a browser.** Both arms' findings
  are displayed side by side in the case editor, and skill bodies are
  displayed as a line diff. All of it goes through the existing sanitised
  renderer with no raw markup (AC-51).
- **Security — workspace scoping.** Three identities must be resolved against
  the caller's workspace before any row is touched: the skill, the carrier
  agent, and the case/run (AC-53). `eval_runs` reaches a workspace only
  transitively through its case, and the carrier introduces a second
  cross-entity reference this feature adds.
- **Privacy of logs.** Run logging records case identifiers, counts, metrics,
  lifts, skill and carrier ids and versions, model, tokens and cost — never
  diff content, skill body text, expectation content, or finding prose.
- **Isolation from observability.** Eval executions stay out of `agent_runs`
  and `run_skills` (D12, AC-45). Without this, the feature would silently
  degrade the Stats tab it was built to complement.
- **Performance.** Scoring is a pure in-memory comparison over two arms'
  findings and the expectations, and must not re-fetch a diff, read a
  checkout, or contact the host. Every read surface renders from stored run
  data alone (AC-29). A run's latency is dominated by its 2 × N model calls
  and must not block the surface that triggered it.
- **Backwards compatibility.** A skill with no cases renders its editor
  exactly as today, with the reserved Evals tab filled and the reserved
  "Run on evals" button enabled (AC-37); no agent-owned eval behaviour changes
  (AC-42, N2).
- **Accessibility.** Metrics, lifts and effect classifications are legible
  without colour, trends have a non-graphical equivalent, every action is
  keyboard-operable, and run status transitions are announced (AC-47, AC-48).

## Inputs (provenance)

| Input | Provenance |
|---|---|
| Which skills were in a given review's prompt (drives AC-2's offer list) | `[reused: the injected-skill rows the run executor already writes at prompt-assembly time]` |
| Source finding's file, line range, severity, category, title | `[reused: the persisted finding record produced by an earlier review run]` |
| Expectation type (must_find / must_not_flag) | `[deterministic: derived from the finding's existing accepted/dismissed timestamps — no new judgement]` |
| A case's frozen diff, file list and PR metadata | `[deterministic: captured once from the pull request's already-stored per-file patch at case-creation time, then immutable]` |
| A hand-authored case's diff and expectation | `[deterministic: user-supplied, schema-validated and grounding-checked at the boundary; no model involved]` |
| Carrier identity for a run (system prompt, model, strategy, its other linked skill bodies) | `[reused: the existing agent record and its stored configuration-version snapshots]` |
| The skill body injected into the with-arm | `[reused: the skill's current stored body, or an archived version body; rendered by the existing shared skill-block renderer]` |
| The skill's per-run token cost shown beside lift | `[reused: the existing tokenizer count already served by the skill preview surface — no new measurement]` |
| Findings for each case, in each arm | `[new: 2N LLM call(s) per run — two review executions per case through the existing review path; the carrier's configured strategy determines calls per execution]` |
| Which findings survived citation grounding, per arm | `[reused: the existing citation-grounding gate, already computed inside every review execution — no additional call]` |
| Per-arm recall, precision, citation accuracy | `[deterministic: the product's existing code-only scorer, unchanged]` |
| Per-metric lift, per-case effect classification, helped/hurt counts | `[deterministic: arithmetic over the two arms' stored outcomes — never model-authored (N1, D5)]` |
| Run cost and duration | `[reused: the product's existing per-run token accounting and cost estimation]` |
| Skill-body diff shown when comparing two runs | `[reused: the two stored skill version bodies the runs were attributed to]` |

## Untrusted inputs

- **The skill body.** New to this feature relative to SPEC-12. Workspace-
  authored at best, third-party-authored at worst (`source: 'imported_url'` /
  `'community'`), and injected into the with-arm *bypassing the vetting gate
  that exists to hold it back* (D8). Data, never instructions; rendered as
  text, never markup.
- **A case's frozen diff, including code content and file paths.** Originates
  from a pull request, contributor-controlled on any repo accepting outside
  contributions, and replayed on every run of that case indefinitely — here at
  double the exposure of an agent case, since it reaches the model twice per
  run. Data, never instructions.
- **Pull-request metadata stored on a case** (title, body). Author-controlled
  free text reaching the model. Data, never instructions.
- **Text carried over from the source finding** (title, rationale,
  suggestion). Model-authored over attacker-influenceable input, then
  displayed in the case editor. Untrusted for rendering.
- **A hand-authored case's diff, name, notes and expectation.** User-supplied
  structured data consumed by a code scorer: schema-validated at the boundary,
  never evaluated, executed, or interpolated into a query.
- **Both arms' findings produced during a run.** Untrusted for citation truth
  — which is what the grounding gate and citation accuracy measure — and for
  rendering in the side-by-side view.
- **The carrier's system prompt and its other skill bodies**, insofar as they
  are rendered in any comparison view. Workspace-authored configuration
  displayed as text; must render as text, never as markup.

## Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as PR review · FindingCard
    participant S as Skill editor · Evals tab
    participant API as Server
    participant DB as eval_cases / eval_runs (owner_kind='skill')
    participant R as Review engine (existing path)
    participant M as Model

    Note over U,F: 1 — build the dataset, provably linked to this skill
    U->>F: Accept (or Dismiss) a finding
    F->>API: which skills were in this review's prompt?
    API-->>F: only skills the run actually injected (AC-2)
    U->>F: "Turn into eval case for <skill>"
    API->>API: expectation type from accept/dismiss; freeze diff + files + PR meta
    API->>API: refuse if expectation lines miss every hunk (AC-9)
    API->>DB: store case (owner_kind='skill', immutable input, fixed expectation)

    Note over U,S: 2 — run the ablation (the only path that spends)
    U->>S: Run on evals → pick a carrier agent
    S->>API: start suite run for this skill + carrier
    API->>API: state 2 × cases executions; warn if either enable gate is off (AC-11)
    API->>API: guard in-flight run; reconcile stale run
    loop once per case
        API->>R: WITH-arm — carrier identity + this skill's block + frozen diff
        R->>M: review call(s)
        M-->>R: candidate findings → grounding gate
        R-->>API: kept findings + kept-of-total
        API->>R: WITHOUT-arm — byte-identical minus this skill's block (AC-16)
        R->>M: review call(s)
        M-->>R: candidate findings → grounding gate
        R-->>API: kept findings + kept-of-total
    end

    Note over API: 3 — score both arms, in code, zero LLM calls
    API->>API: per-arm recall · precision · citation accuracy (existing scorer, D4)
    API->>API: lift = with − without;  effect = helped / hurt / no_effect (D5)
    API->>DB: store run + skill version + carrier id & version + covered case ids + cost

    Note over U,S: 4 — read, compare, decide (spends nothing)
    U->>S: open Evals tab
    S->>API: read cases, runs, lift, token cost
    API-->>S: stored data only (0 LLM calls)
    U->>S: select 2 runs → Compare
    API-->>S: metric + lift deltas, skill-body diff, carrier/case-set difference if any
```

## Resolved decisions (post-draft)

Four of the seven originally-raised `[NEEDS CLARIFICATION]` items were the
user's call and are now decided; the remaining three are non-blocking notes
for the planning phase, kept below rather than silently dropped.

1. **The two-armed (ablation) model (D3) — confirmed.** User sign-off: run
   each case twice (with/without this skill's rendered block against the same
   carrier agent) and report **lift**, not a single-arm number. Rationale
   accepted as argued: a single-arm run would attribute an effect to the
   carrier agent as much as to the skill, which SPEC-12 already measures. The
   2× run-cost is accepted as the cost of measuring the right thing. D3, D5,
   D7 and every AC/US referencing lift stand as drafted; the single-arm
   alternative is dropped, not merely deferred.

2. **Adopting an agent-owned case into a skill's set — rejected, as
   drafted.** User confirmed: keep exactly the two creation paths already
   specified (from a finding whose run provably injected the skill, or
   hand-authored for a never-run skill). No copy/adopt flow is added. If a
   demo skill set needs populating without hand-authoring later, this can be
   revisited, but it is out of scope for this spec.

3. **No per-skill detail page — confirmed.** The Skill editor's Evals tab
   plus a section in the global Eval Dashboard is sufficient; SPEC-12's
   per-agent detail page (trend chart, run-history drill-down) is not
   mirrored for skills in this slice. AC-32/AC-33 (compare) and AC-39–AC-41
   (dashboard section) stand; nothing further is added.

4. **Demo minimum case count — 4, confirmed.** Accepted as proposed (AC-30),
   given each case costs two executions versus SPEC-12's one. Which seeded
   skill and carrier agent the four fixtures run against is an
   implementation-planning decision, not a spec one.

5. **Whether the without-arm's results are persisted per finding, or only as
   aggregate outcomes, is left to planning.** AC-36 shows both arms'
   findings side by side in the case editor, which implies persisting both
   arms' finding sets; the storage and privacy cost of keeping two full
   finding sets per case per run was not assessed here and should be sized
   during planning.

6. **Spec numbering — settled as SPEC-15.** `13-multi-agent-review.md` and
   `14-export-to-ci.md` already occupy 13–14; this spec keeps
   `15-skill-eval-cases.md`.

7. **Unverified system state — noted, not blocking.**
   `mcp__devdigest__get_conventions` and the blast-radius/findings tools could
   not be consulted because the DevDigest API at `localhost:3001` was not
   running at draft time; every claim in this spec is instead cited directly
   to source files. If accepted conventions exist that this spec contradicts,
   they have not been checked against it — worth a quick pass before or
   during planning if the API is available then.
