# Spec: Eval Pipeline

**Spec ID:** SPEC-2026-07-05-eval-pipeline
**Status:** implemented
**Date:** 2026-07-05
**Affects:** full-stack (server: new `eval` module registering existing `eval_cases`/`eval_runs` tables + one new batch table · client: new Evals tab inside the existing AgentEditor + a new action on FindingCard)
**Supersedes:** —

> **Publication note:** the canonical copy of this spec for the assignment's submission checklist is published to repo-root `specs/eval-pipeline.md` by the orchestrator after this draft is written — this agent does not write outside `docs/feature-requirements/`.

## 1. Problem & Motivation

An agent author who edits a reviewer agent's system prompt, model, or attached skills today has no way to know whether the edit made the agent better or worse without manually re-running it against a pile of past PRs and eyeballing the findings. There is no regression protection: a prompt change that silently stops catching a known bug class, or that starts flagging things it shouldn't, is invisible until it happens again in production. This feature gives every agent its own fixed, versioned set of expectations ("this finding must appear," "this must NOT be flagged"), lets the author re-run the agent over that set on demand, and turns the result into three deterministic numbers (recall, precision, citation accuracy) plus a trend over time — so "did my edit help or hurt" becomes a number, not a feeling. The persona is the agent's own author/maintainer; this is not an audit or read-only-viewer feature for a third party inspecting someone else's agent.

## 2. Goals / Non-goals

**Goals:**
- Let an agent author create an eval case in one click directly from a finding they already accepted or dismissed on a real PR — accepted → a `must_find` expectation at that finding's file/line-range; dismissed → a `must_not_flag` expectation at that same file/line-range.
- Let an agent author create and edit eval cases manually through a dedicated Case Editor: paste a diff fragment with a live preview, set the expectation type, file, and line range, and add notes.
- Show every case in an agent's set together with its most recent run outcome (passed / failed / error / flaked / never run).
- Run the agent over some or all of its case set on demand, producing one **batch**: a group of per-case runs sharing one agent-snapshot identity, so that runs of two different agent versions (different prompt, different attached skills, different model) are directly comparable and never confused with each other.
- Compute recall, precision, and citation accuracy for every batch using zero LLM calls in scoring — deterministic matching only.
- Show run history per agent, and let the author compare any two batches side by side (e.g. "old prompt vs new prompt").
- Show a trend chart of recall/precision/citation accuracy across an agent's full batches, with each point's tooltip carrying the agent-snapshot identity (prompt/skills/model) and the batch's cost.
- Make every agent in the workspace eligible for this feature uniformly — each agent has its own isolated case set, its own batches, its own history and trend, addressed by that agent's own id.

**Non-goals:**
- The harness-side eval tracks (the product's own skill-authoring eval in the `evals/` package, the PreToolUse hook, mutation testing) — unrelated infrastructure, not touched by this spec.
- The agent's Export-to-CI wizard and any CI-runner-side eval integration.
- Stats and CI tabs on the Agent Editor (adjacent, unrelated tabs).
- Exposing eval capability as an MCP tool — no `run_eval`-style tool is added to `mcp/` by this feature; adding one later is a small, separate follow-up.
- A workspace-wide "Eval Dashboard" sidebar page aggregating every agent's evals into one view — this capability is now covered by [SPEC-2026-07-07-agent-eval-dashboard](../docs/feature-requirements/2026-07-07-agent-eval-dashboard.md), which reuses this spec's per-agent endpoint/contract as its foundation.
- Any eval capability for `owner_kind = 'skill'' cases — the underlying schema/contract already supports a future skill-eval feature, but this spec's routes, UI, and scoring apply to `owner_kind = 'agent'` only; skill-owned cases are never silently mixed into an agent's view (see AC-2).
- A read-only auditor/viewer permission model distinct from the existing workspace-scoped agent-edit permission — this feature introduces no new permission tier.
- Populating `eval_cases.input_files` with any required content — left to the implementation planner's discretion.

## 3. User Stories

- As an agent author, I want to turn an accepted or dismissed finding into an eval case in one click, so that a real regression I just noticed becomes a permanent, re-runnable check without any manual data entry.
- As an agent author, I want to hand-author an eval case for a scenario I'm worried about (even one with no corresponding real finding yet), so that I can test hypotheses before they become real bugs.
- As an agent author, I want to see every case in my agent's set with its last outcome at a glance, so that I know immediately which expectations are currently being met.
- As an agent author, I want to run my whole case set with one click after editing my agent's prompt, model, or skills, so that I get an immediate, objective before/after comparison.
- As an agent author, I want to run a single case in isolation while I'm calibrating a case's expectations, so that I don't have to pay for and wait on a full batch just to check one case.
- As an agent author, I want a trend chart across all my full batches, so that I can see at a glance whether my agent has been getting better or worse over time, and what changed at each point.
- As an agent author, I want to compare two batches side by side, so that I can see exactly which cases and which metrics moved when I changed the prompt.

## 4. Workflow & Module Communication

```mermaid
flowchart TD
    A[Agent author opens Evals tab] --> B{Case set exists?}
    B -- no cases --> C[Empty state: two CTAs —\n'create from a finding' hint + '+ New eval case']
    B -- has cases --> D[Case list: status icon, name,\nsubtitle, expectation badge, per-row actions]

    D -- click 'Run all evals' --> E[POST eval run: full case set]
    D -- click per-row run ▷ --> F[POST eval run: case_ids=[this case]]
    D -- click per-row edit ✎ --> G[Case Editor, pre-filled]
    D -- click per-row delete --> H[Confirm modal → delete case]

    subgraph Finding[On a PR's Finding Card]
        I[Author clicks '→ eval case'\non an accepted or dismissed finding] --> J[Case created instantly —\nno modal, no extra save step]
    end
    J --> D

    E --> K[Batch: one agent-snapshot,\none run per case in the set]
    F --> K
    K --> L[Each case run: reviewPullRequest\nagainst the case's stored diff fragment]
    L --> M[Deterministic scoring:\nrecall / precision / citation_accuracy\nzero LLM calls]
    M --> N{case_ids narrowed\nto a subset?}
    N -- yes --> O[Calibration batch —\nnot plotted on the trend chart,\nskipped for 'previous batch' deltas]
    N -- no, full set --> P{any case errored\nat runtime?}
    P -- yes --> Q[Degraded batch —\nplotted with a marker,\nmetrics over successfully-scored cases]
    P -- no --> R[Clean full batch —\nplotted normally]
    O --> S[Batch history + KPI + trend + compare]
    Q --> S
    R --> S
```

```mermaid
sequenceDiagram
    participant Author as Agent author (browser)
    participant EvalModule as Server — eval module
    participant Agent as Agent's own configured LLM\n(existing reviewer-core pipeline)
    participant Scoring as Deterministic scoring\n(zero LLM calls)

    Author->>EvalModule: POST run (all cases, or case_ids subset)
    EvalModule->>EvalModule: snapshot agent identity\n(system_prompt + enabled skills in order + model + provider)
    loop each case in the batch
        EvalModule->>Agent: reviewPullRequest(case's diff fragment, agent config)
        Agent-->>EvalModule: kept findings + dropped findings + cost + tokens
        EvalModule->>Scoring: match kept findings against expected_output
        Scoring-->>EvalModule: recall, precision, citation_accuracy, per-case pass/fail/error
    end
    EvalModule-->>Author: batch result (per-case + aggregate metrics + cost)

    Author->>EvalModule: GET case list (with last-run outcome)
    EvalModule-->>Author: cases joined with latest eval_runs row per case

    Author->>EvalModule: GET batch history / trend / compare
    EvalModule-->>Author: full batches only for trend; any batch for history/compare
```

## 5. Acceptance Criteria (EARS)

### Case management

- **AC-1** (Event-driven): WHEN the agent author clicks the eval-case action on an accepted or dismissed finding, the system SHALL create a new eval case for that finding's owning agent immediately, with no confirmation dialog and no intermediate save step, and SHALL show a success confirmation.
- **AC-2** (Ubiquitous): Every eval listing, run, and scoring operation introduced by this feature SHALL operate only on cases whose `owner_kind` is `agent`; WHERE any `owner_kind = 'skill'` case exists for the workspace, the system SHALL make its exclusion visible (e.g. a count of excluded skill-owned cases) rather than silently omitting it from any total shown to the user.
- **AC-3** (Event-driven): WHEN a case is created from an accepted finding, the system SHALL set its expectation to `must_find` at that finding's file and start/end line range, carrying the finding's severity and category as display metadata.
- **AC-4** (Event-driven): WHEN a case is created from a dismissed finding, the system SHALL set its expectation to `must_not_flag` at that finding's file and start/end line range, carrying the finding's severity and category as display metadata.
- **AC-5** (Event-driven): WHEN a case is created from a finding, the system SHALL capture that finding's file's diff hunk(s) from the source PR's diff at creation time as the case's stored diff fragment — not the entire PR diff.
- **AC-6** (Ubiquitous): A created case's stored provenance SHALL record whether it originated from a finding (including the source finding's id and PR number) or was authored manually.
- **AC-7** (Event-driven): WHEN the agent author saves a manually authored or edited case in the Case Editor, the system SHALL validate that the pasted diff fragment parses as a unified diff referencing at least one file before allowing the save.
- **AC-8** (Unwanted behavior): IF the pasted diff fragment in the Case Editor does not parse as a unified diff referencing at least one file, THEN the system SHALL show an inline validation error and SHALL NOT save the case.
- **AC-9** (Ubiquitous): A case's expected output SHALL be an ordered list of expectations, each either `must_find` or `must_not_flag`, each carrying a file and a line range; a case with an empty expectation list SHALL be treated as a valid "clean diff" case (no special-cased scoring logic) and SHALL be displayed with an explicit empty-set indicator.
- **AC-10** (Event-driven): WHEN the agent author deletes a case, the system SHALL require an explicit confirmation step before deletion.

### Running

- **AC-11** (Event-driven): WHEN the agent author triggers "Run all evals," the system SHALL create one batch covering every case currently in that agent's case set (excluding any `owner_kind='skill'` case per AC-2) and SHALL run each case once.
- **AC-12** (Event-driven): WHEN the agent author triggers a per-row single-case run, the system SHALL create a batch scoped to only that one case, using the same run mechanism as a full-set run.
- **AC-13** (Ubiquitous): Every case run within a batch SHALL invoke the agent's own already-configured review call (provider, model, system prompt, enabled skills) against that case's stored diff fragment — the SAME call type already used for real PR reviews, at a new invocation site, never a newly introduced LLM call type.
- **AC-14** (Ubiquitous): A batch whose run was scoped to a strict subset of the agent's case set via an explicit case-selection input SHALL be recorded as a **calibration batch**.
- **AC-15** (Unwanted behavior): IF one case's run fails at runtime (provider error, timeout, or equivalent) within an otherwise full-set batch, THEN the system SHALL continue running the remaining cases in that batch, SHALL mark the failed case with a distinct error state (not the same as a deterministic scored failure), and SHALL record the batch as a **degraded batch**.
- **AC-16** (Ubiquitous): A degraded batch's aggregate metrics (recall, precision, citation accuracy) SHALL be computed only from the cases that were successfully scored in that batch.
- **AC-17** (Event-driven): WHEN a batch (full, calibration, or degraded) is created, the system SHALL record an agent-snapshot identity for that batch derived from the combination of the agent's system prompt, its enabled skills in their configured order, its model, and its provider — never from the system prompt alone.
- **AC-18** (Unwanted behavior): IF the agent author repeats "Run all evals" or a single-case run in rapid succession, THEN the system SHALL rate-limit and cap concurrent execution of the run route, so that a click-burst does not fan out multiple paid batches.

### Scoring (zero LLM calls)

- **AC-19** (Ubiquitous): A finding SHALL be considered a match for an expectation when the finding's file equals the expectation's file AND the finding's line range overlaps the expectation's line range.
- **AC-20** (Ubiquitous): A batch's recall SHALL be computed as the count of `must_find` expectations matched by at least one finding, divided by the total count of `must_find` expectations across the batch's scored cases.
- **AC-21** (Ubiquitous): A batch's precision SHALL be computed as the count of findings that do not fall inside any `must_not_flag` expectation's zone, divided by the total count of findings produced across the batch's scored cases.
- **AC-22** (Ubiquitous): A batch's citation accuracy SHALL be computed as the count of findings that survived the reviewer pipeline's mandatory citation-grounding gate, divided by the total count of findings produced before that gate was applied, across the batch's scored cases.
- **AC-23** (Ubiquitous): Computing recall, precision, and citation accuracy for a batch SHALL make zero LLM calls — scoring SHALL be pure deterministic matching over the review call's own already-returned findings (kept and dropped).
- **AC-24** (Ubiquitous): A `must_find`/`must_not_flag` expectation's `severity` and `kind` fields SHALL be treated as display metadata only and SHALL NOT participate in match evaluation for scoring in this feature's scope.

### History, trend, and comparison

- **AC-25** (Event-driven): WHEN the agent author opens the Evals tab, the system SHALL show every case in that agent's set joined with that case's most recent run outcome.
- **AC-26** (Ubiquitous): A case that has never been run SHALL be shown with a distinct "never run" state and SHALL NOT show any "expected N, got M" outcome text.
- **AC-27** (Event-driven): WHEN a case's outcome flips (pass → fail or fail → pass) across its three most recent consecutive full batches, the system SHALL mark that case as **flaked**, a state distinct from both a deterministic scored failure and a runtime error.
- **AC-28** (Ubiquitous): The trend chart SHALL plot one point per full batch (clean or degraded) for the agent, in chronological order; calibration batches SHALL NOT appear as points on the trend chart.
- **AC-29** (Event-driven): WHEN the agent author views a trend point's tooltip, the system SHALL show that batch's agent-snapshot identity and its cost.
- **AC-30** (Ubiquitous): A degraded batch's trend point SHALL be visually distinguishable (e.g. a marker) from a clean full batch's trend point.
- **AC-31** (Event-driven): WHEN computing a KPI delta (recall/precision/citation-accuracy change) against the previous batch, the system SHALL use the immediately preceding FULL batch (clean or degraded), skipping over any calibration batch in between.
- **AC-32** (Event-driven): WHEN the agent author selects any two batches from the batch history, the system SHALL show a side-by-side comparison of their aggregate metrics (with per-metric deltas) and their per-case outcomes, in an inline panel expanding under the batch history table.
- **AC-33** (Ubiquitous): The batch history SHALL show, per batch: timestamp, agent-snapshot identity, model, the three metrics, cost, and a status indicator (clean / degraded / calibration), and SHALL support per-case drill-down into any listed batch.

### Cost and observability

- **AC-34** (Ubiquitous): WHEN a batch runs against the cheap default model (`deepseek/deepseek-v4-flash`), the system SHALL keep the batch's total cost observable in the run's stored trace/cost fields, verifiably at or under $0.10 for the assignment's reference case set size.
- **AC-35** (Ubiquitous): Every case run's cost SHALL be attributable per case and aggregable per batch, using the same cost-accounting convention already used for real PR review runs.

### Scope / workspace boundaries

- **AC-36** (Ubiquitous): Every eval-case and eval-run query introduced by this feature SHALL be scoped to the requesting workspace — for case queries directly via the case's own workspace ownership, and for run queries transitively through the run's owning case's workspace ownership (`eval_runs` carries no direct workspace column).
- **AC-37** (Ubiquitous): The Evals tab and all eval capabilities described by this spec SHALL apply uniformly to every agent in the workspace; each agent SHALL have its own isolated case set, its own batches, and its own history/trend, addressed by that agent's own id.
- **AC-38** (Ubiquitous): The acceptance bar of "at least 8 cases — 5 seeded from the demo repo plus at least 3 authored from real accept/dismiss decisions" SHALL be met for at least one agent in the workspace (the primary demo agent) — it is not a requirement that every agent in the workspace independently meets this bar.
- **AC-39** (Ubiquitous): The seeded portion of the acceptance-bar case set SHALL be produced by the existing idempotent demo-data seed flow — re-running the seed SHALL NOT duplicate previously seeded cases.

### Sourced from SPEC-2026-07-07-agent-eval-dashboard

The following acceptance criteria (AC-1 through AC-27) are sourced verbatim from [SPEC-2026-07-07-agent-eval-dashboard](../docs/feature-requirements/2026-07-07-agent-eval-dashboard.md) §5, which builds the workspace-wide "Eval Dashboard" this spec deferred as a Non-goal (see §2). They are numbered independently within that spec's own document and are reproduced here unchanged.

#### Sidebar reachability

- **AC-1** (Ubiquitous): The sidebar's existing "SKILLS LAB" section SHALL include exactly one new navigation entry labeled "Eval Dashboard," positioned alongside the existing Skills, Agents, and Conventions entries, with its own keyboard shortcut registered consistently with every other navigation entry's shortcut convention.
- **AC-2** (Ubiquitous): The Eval Dashboard's landing route SHALL be reachable by clicking its sidebar entry from any page in the app — the feature SHALL NOT be considered complete while any other acceptance criterion in this spec is satisfied but the sidebar entry is missing.

#### Landing page — agent list

- **AC-3** (Ubiquitous): The landing page's agent list SHALL include only agents that have at least one eval case in the requesting workspace; an agent with zero eval cases SHALL NOT appear, regardless of how many real PR reviews that agent has otherwise run.
- **AC-4** (Event-driven): WHEN the landing page loads and at least one eval-configured agent exists, the system SHALL show, per agent, that agent's latest full batch's recall/precision/citation-accuracy, a recall sparkline built from that agent's own trend history, and a last-run summary (version label, timestamp, pass count out of total cases run in that batch).
- **AC-5** (Unwanted behavior): IF no agent in the workspace has any eval case, THEN the landing page SHALL show an explicit empty state instead of an empty list with no explanation, and SHALL NOT show a "Run all agents" affordance in a state that would have nothing to run.
- **AC-6** (Ubiquitous): An eval-configured agent whose latest batch is degraded (per the parent spec's degraded-batch definition) SHALL be visually distinguishable on its landing-page card from an agent whose latest batch is clean.
- **AC-7** (Event-driven): WHEN the author clicks an agent's card (its chevron affordance), the system SHALL navigate to that agent's detail page.

#### Landing page — recent runs across agents

- **AC-8** (Event-driven): WHEN the landing page loads, the system SHALL show a table of the most recent eval batches across every eval-configured agent, ordered newest-first, each row identifying the owning agent's name, the batch's timestamp, its version label, its recall/precision/citation-accuracy, and its pass count.
- **AC-9** (Ubiquitous): The recent-runs table SHALL show a fixed number of rows at a time (10) with vertical scrolling to reach any additional rows, and the server response feeding it SHALL be bounded to a fixed limit — the table SHALL NOT attempt to render every batch ever run across every agent unbounded.
- **AC-10** (Event-driven): WHEN the author clicks a row in the recent-runs table, the system SHALL navigate to that row's owning agent's detail page with that specific batch identifiable (e.g. pre-selected or scrolled into view) on arrival.

#### Landing page — run all agents

- **AC-11** (Event-driven): WHEN the author triggers "Run all agents," the system SHALL start one real eval batch per eval-configured agent in the workspace, each batch using that agent's own already-configured review call (provider, model, system prompt, enabled skills) against that agent's own case set — the same run mechanism a single agent's own "Run eval" already uses, never a distinct or cheaper simulation.
- **AC-12** (Unwanted behavior): IF the author triggers "Run all agents" while a prior workspace-wide run-all is still in flight, THEN the system SHALL rate-limit or reject the repeated trigger consistent with this codebase's existing fan-out precedent, so that a click-burst does not multiply the number of paid batches started.
- **AC-13** (Ubiquitous): The "Run all agents" fan-out SHALL apply a concurrency cap across the agents it runs, consistent with this codebase's existing multi-target fan-out precedent, so that it does not saturate the LLM provider by starting every agent's batch simultaneously.

#### Per-agent detail page

- **AC-14** (Ubiquitous): The per-agent detail page SHALL show that agent's name and model, a run count and case-set size in its subtitle, three KPI cards (recall, precision, citation accuracy) each with a value, a sparkline, and a delta versus the previous full batch, a metric-trend chart across full batches, and a recent-runs table scoped to that agent alone.
- **AC-15** (Event-driven): WHEN the KPI delta versus the previous full batch shows a meaningful change in any of the three metrics, the system SHALL show a warning or notice banner summarizing which metric moved and in which direction; WHERE no previous full batch exists yet, the system SHALL NOT show this banner.
- **AC-16** (Event-driven): WHEN the author selects an agent from the detail page's agent-switcher dropdown, the system SHALL replace the page's content with the selected agent's own KPI/trend/run data without requiring a return to the landing page; the dropdown's own list of selectable agents SHALL be limited to eval-configured agents (same criterion as AC-3).
- **AC-17** (Event-driven): WHEN the author triggers "Run eval" on the detail page, the system SHALL start one real batch for that agent alone, using the exact same run mechanism already defined by the parent eval-pipeline spec's full-set run (AC-11 there) — not a new call type.
- **AC-18** (Event-driven): WHEN the author selects exactly two runs from the detail page's recent-runs table, the system SHALL enable a "Compare" action; WHEN fewer than two or more than two are selected, the system SHALL keep that action disabled.

#### Compare modal

- **AC-19** (Event-driven): WHEN the author opens the compare modal for two selected batches, the system SHALL show, for recall, precision, citation accuracy, and cost, each batch's own value and the delta from the older to the newer of the two.
- **AC-20** (Ubiquitous): The compare modal SHALL show a word-level diff of the two batches' system-prompt text, with removed text marked distinctly from added text, and a control to toggle between viewing the older and the newer prompt in full.
- **AC-21** (Event-driven): WHEN the author clicks "Promote" on the newer of the two compared batches, the system SHALL set that batch's snapshot system-prompt text as the agent's current active system prompt, and SHALL show a confirmation that the promotion succeeded.
- **AC-22** (Unwanted behavior): IF the author attempts to promote a batch whose snapshot does not include full system-prompt text (see AC-23), THEN the system SHALL disable or reject the promote action for that batch with an explanation, rather than silently promoting an empty or truncated prompt.
- **AC-23** (Ubiquitous): Every eval batch created after this feature ships SHALL persist its agent-snapshot's full system-prompt text (not only an opaque fingerprint or a truncated summary), retrievable by the compare and promote operations; a batch created before this feature shipped, which carries no full-text snapshot, SHALL be treated by the compare/promote flow as a batch with unavailable prompt text (per AC-22), never as an empty-string prompt.

#### Cross-agent aggregation surface (server)

- **AC-24** (Ubiquitous): Every new cross-agent read introduced by this feature (the landing page's agent-summary list and its recent-runs feed) SHALL be scoped to the requesting workspace and SHALL include only agent-owned (`owner_kind='agent'`) eval data, mirroring the same scoping and ownership boundary the parent eval-pipeline spec already established for its per-agent routes.
- **AC-25** (Ubiquitous): The prompt-promote operation SHALL be scoped to the requesting workspace and SHALL verify that the batch being promoted belongs to the same agent whose system prompt is being changed, before applying the mutation.
- **AC-26** (Ubiquitous): The prompt-promote operation SHALL reuse the existing agent-versioning mechanism already used whenever an agent's configuration changes (the same mechanism that already snapshots a version on every agent update), so that a promote action is itself undoable through that existing history, not a bypass of it.
- **AC-27** (Ubiquitous): The agent-config version created by a promote SHALL record its provenance — that it originated from an eval-batch promotion, and which batch it came from — and the agent's config-version history SHALL surface that provenance (e.g. a "Promoted from batch vN" marker) distinctly from a manually-edited version; a manually-authored config version SHALL continue to carry no such marker, and any pre-existing/legacy config version with no recorded provenance SHALL be treated as manual.

## 6. Edge Cases

| Case | Expected behavior | Covered by |
|---|---|---|
| Agent has zero eval cases | Empty state with two CTAs: create-from-a-finding hint, and "+ New eval case" | AC-11 (implicitly — no cases to run), see UX requirements |
| Case has never been run | Gray "never run" state, no outcome numbers shown | AC-26 |
| One case in a full-set batch fails at runtime | Batch continues; that case → error state; batch marked degraded; metrics from remaining cases only | AC-15, AC-16 |
| Single-case calibration run | Same route, case_ids narrowed to one; excluded from trend and from "previous batch" delta calc | AC-12, AC-14, AC-28, AC-31 |
| Case outcome flips across the last 3 full batches | Marked "flaked," distinct from failed/error | AC-27 |
| Skill-owned (`owner_kind='skill'`) case exists in the workspace | Never silently mixed into an agent's totals; exclusion shown explicitly when non-empty | AC-2 |
| Rapid repeated "Run all evals" clicks | Rate-limited / concurrency-capped, not fanned out per click | AC-18 |
| Pasted diff fragment is malformed (not a valid unified diff, or references zero files) | Inline validation error on save; case not persisted | AC-7, AC-8 |
| Case created from a finding whose PR spans many files | Only that finding's own file's hunk(s) captured, not the whole PR diff | AC-5 |
| Agent's attached skills change (prompt text unchanged) | New batch's agent-snapshot identity differs from the prior batch's — treated as a different agent version for comparison purposes | AC-17 |
| Two calibration batches run back-to-back, then a full batch | KPI delta compares the full batch to the last full batch before the calibration batches, not to the calibration batches | AC-31 |
| Cross-workspace request for an agent's eval cases/runs | Behaves as not-found / empty, never leaks another workspace's data | AC-36 |
| A `must_not_flag`-only case (no `must_find` entries) | Recall is computed over zero `must_find` expectations for that case (does not divide by zero at the batch level — aggregated across all scored cases); precision still evaluated normally | AC-20, AC-21 |
| A "clean diff" case (`expected_output: []`) | Displayed with an explicit empty-set indicator; scored using the same general match logic, no special-cased branch | AC-9 |

## 7. Non-functional

- WHEN a batch runs against the cheap default model on the assignment's reference case set, the system SHALL keep total batch cost at or under $0.10, verifiable from the batch's own stored cost trace — verify: inspect the batch's persisted cost field(s) after a run.
- The eval run route SHALL be rate-limited and concurrency-capped consistent with the existing `POST /repos/:id/review-all` precedent in this codebase (exact numeric limits are an implementation-planner decision) — verify: automated test asserting a burst of rapid calls is throttled, not fully executed in parallel.
- Scoring (recall/precision/citation-accuracy computation) SHALL make zero LLM calls for any batch size — verify: unit test asserting no LLM provider mock is invoked during the scoring step in isolation from the review call.
- `pnpm verify:l06` (a new script mirroring the existing `verify:l03` convention in `server/package.json`) SHALL pass, gating typecheck plus the eval-pipeline's deterministic-scoring test suite — verify: CI / local run of the script exits 0.

## 8. Inputs (Provenance)

| Input | Provenance |
|---|---|
| Case expectations (`must_find`/`must_not_flag`, file, line range, severity, kind) derived from an accepted/dismissed finding | [reused: existing Finding record + accept/dismiss action] |
| Diff fragment for a finding-born case (that finding's file's hunk(s)) | [reused: existing PR diff already loaded for the review that produced the finding] |
| Diff fragment for a manually authored case | [new: user-authored input] — pasted directly by the agent author in the Case Editor, validated as a parseable unified diff |
| Agent configuration used for a run (system prompt, enabled skills in order, model, provider) | [reused: existing `agents` + `agent_skills` configuration] |
| Findings produced by a case run | [reused: existing reviewer-core pipeline] — the SAME `reviewPullRequest()` call type already used for real PR reviews, invoked against a synthetic diff fragment instead of a real PR; zero new LLM call sites introduced by this feature |
| Kept vs. dropped findings for citation-accuracy scoring | [deterministic: existing citation-grounding gate] — computed by the reviewer pipeline's own mandatory grounding step, already zero-LLM |
| recall / precision / citation_accuracy per batch | [deterministic: new eval-scoring logic] — pure matching over already-produced findings against stored expectations, zero LLM calls |
| Agent-snapshot identity (batch versioning key) | [deterministic: derived from existing agent + skill configuration] — hash/fingerprint of system prompt + enabled skills in order + model + provider |
| "Flaked" status | [deterministic: derived from stored run history] — computed from the outcome sequence of a case's last 3 full batches |
| Seeded demo-repo cases (5 of the ≥8 minimum) | [reused: existing demo repo + seed flow] — idempotent via the existing `pnpm db:seed` convention |

## 9. Contracts

The following are interface-level shapes this feature's server and client agree on. Field names and meanings only — no code, no schema syntax.

**Eval case (as listed to the client, joined with its last-run outcome):**

| Field | Type (conceptual) | Meaning | Null means |
|---|---|---|---|
| id | id | Case identifier | never null |
| owner_id | id | The agent this case belongs to | never null |
| name | text | Human-readable case name | never null |
| source | enum: finding \| manual | Provenance of the case | never null |
| source_finding_id | id | The finding this case was created from | not created from a finding |
| source_pr_number | number | The PR number the source finding came from | not created from a finding |
| expected_output | list of expectations | See "Expectation" below | empty list = "clean diff" case |
| last_run_status | enum: never_run \| passed \| failed \| error \| flaked | Outcome of the most recent run of this case | never null (defaults to `never_run`) |
| last_run_summary | text | e.g. "expected N finding(s), got M" — wording adapted per expectation type | no run yet |

**Expectation (element of `expected_output`):**

| Field | Type (conceptual) | Meaning | Null means |
|---|---|---|---|
| type | enum: must_find \| must_not_flag | Expectation kind | never null |
| file | text | File path the expectation applies to | never null |
| line_start | number | Start of the expected/guarded line range | never null |
| line_end | number | End of the expected/guarded line range | never null |
| severity | text | Display-only metadata, not matched in scoring | source finding had none |
| kind | text | Display-only metadata, not matched in scoring | source finding had none |

**Batch (one run of an agent over some or all of its cases):**

| Field | Type (conceptual) | Meaning | Null means |
|---|---|---|---|
| id | id | Batch identifier | never null |
| agent_id | id | The agent this batch ran | never null |
| kind | enum: full \| calibration | Whether the run covered the whole case set or an explicit subset | never null |
| status | enum: clean \| degraded | Whether every case in a full batch scored successfully, or at least one errored | calibration batches use a comparable per-case status without this label |
| agent_snapshot | opaque identity | Fingerprint of (system prompt + enabled skills in order + model + provider) at run time | never null |
| recall / precision / citation_accuracy | number 0–1 | Aggregate batch metrics, over successfully-scored cases | no cases were successfully scored |
| cost_usd | number | Total cost of the batch's case runs | cost unknown for at least one run |
| ran_at | timestamp | When the batch was started | never null |

**Trend point (one entry in the agent's trend chart):**

| Field | Type (conceptual) | Meaning | Null means |
|---|---|---|---|
| batch_id | id | The full batch this point represents | never null |
| ran_at | timestamp | When the batch ran | never null |
| recall / precision / citation_accuracy | number 0–1 | The batch's aggregate metrics | not applicable (see batch definition) |
| is_degraded | boolean | Whether this point represents a degraded batch (for the distinct marker) | never null |
| agent_snapshot | opaque identity | Shown in the tooltip | never null |
| cost_usd | number | Shown in the tooltip | cost unknown |

Calibration batches never produce a trend point (AC-28).

## 10. Untrusted Inputs

This feature reads two sources of text authored outside the system as part of its data flow:

- **Diff fragments** (both finding-derived hunk snapshots and manually pasted fragments) — the same trust class as a real PR diff already sent through the reviewer pipeline today; processed as data only, never as instructions, via the existing prompt-assembly wrapping already used for all diff content.
- **Case `name` and `notes` free text**, authored by the agent author — displayed back in the UI; covered by the product's existing default JSX-escaping safety net product-wide. No new untrusted-input class is introduced beyond what the existing review pipeline already handles.

## 11. [NEEDS CLARIFICATION]

- **Exact new-table name and shape for batch identity** (e.g. `eval_run_batches` vs. an alternative name, and whether `eval_runs` gains a nullable `batch_id` foreign key or batches are joined some other way) — deferred to the implementation planner; this spec requires only that the batch concept exist, that `eval_runs`' existing columns are never altered, and that a new table is used (new tables via new numbered migrations are allowed per this repo's conventions).
- **Exact seeding mechanics for the 5 demo-repo cases** (hand-authored fixtures vs. generated from real seeded PR data) — left to the implementation planner; this spec fixes only the acceptance bar (AC-38) and the idempotency requirement (AC-39).
- **Exact numeric rate limit / concurrency cap** for the eval-run route — left to the implementation planner, consistent with the existing `review-all` precedent (AC-18, §7).
- **Exact UI wording for a `must_not_flag`-only case's subtitle** (proposed: "expected 0 flagged in guarded zone(s), got M") — non-blocking; final copy goes through the product's existing translation-key convention regardless of exact wording chosen at implementation time.
