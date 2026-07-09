# Spec: CI Agent-Runner Pipeline

**Spec ID:** SPEC-2026-07-09-ci-agent-runner-pipeline
**Status:** approved
**Date:** 2026-07-09
**Affects:** full-stack (server, client)
**Supersedes:** —

> **Refinement (2026-07-09, same day):** Added the concrete Export Wizard UI (4 steps: Target → Preview → Configure → Install), the agent CI tab's bulk "Update CI config" republish action and staged "Fail CI on" control, a new per-installation workflow-version counter (a third additive schema/contract touchpoint, alongside AC-28 and the two shapeless capabilities in §9), and the CI Runs page's column set — sourced from screenshots reviewed in a follow-up interactive session. AC-1–AC-32 are unchanged; AC-33–AC-48 are new. The §11 runner-bundle sourcing question remains an open technical item, deliberately not resolved here. Status moves draft → ready-for-planning: no user decision remains pending.

> **Post-research finalization (2026-07-09):** R1 (runner-bundle sourcing) RESOLVED → build the `ncc` bundle during export/bulk-update handling, behind an injected adapter port (see §11). Status → **approved**. **v1 posture — keep it simple:** this is a deliberately minimal first cut. Implement each AC with the simplest seasoned mechanism, reuse existing patterns (mirror `blast/` + `reviews` review-all), and avoid speculative abstraction — the team iterates once real user needs are known. The implementation plan caps parallel implementers at **≤5**. Full technical grounding (adapter methods, ingest-via-artifact, runner env contract, migration path): `docs/plans/2026-07-09-research-export-to-ci.md`. **Planning decision (2026-07-09):** v1 supports one agent per repository with the flat `.devdigest/agents/<slug>.yaml` layout (AC-13 re-scoped to enforce this; multi-agent-per-repo deferred — see Non-goals), keeping the exported paths mockup-matching and the implementation simple.

## 1. Problem & Motivation

A DevDigest review today only happens when someone triggers it from inside the DevDigest application. Teams that want DevDigest's review feedback to appear inside their own GitHub pull request checks — the same place their other CI status checks and merge gates already live — currently cannot get it there automatically; someone has to remember to come back into DevDigest and run a review by hand for every single pull request.

A standalone CI-side runner already exists, fully built and tested: given a checked-in agent configuration and skill set, it runs the same review engine the in-app review path uses, posts the result to the pull request, and writes a machine-readable result file. What is missing is everything on DevDigest's own side: nothing composes that checked-in configuration from an existing agent, nothing generates the GitHub Actions workflow that would invoke the runner, no user-facing flow lets a workspace member turn this on for a repo, and nothing brings the runner's results back into DevDigest once they exist. This spec defines that missing producer (turning an agent into an installed CI workflow) and that missing ingest (turning a completed CI run back into workspace-visible history).

## 2. Goals / Non-goals

**Goals:**
- Let a workspace member with access to an agent export it to one of the workspace's already-connected GitHub repositories as a self-contained, automatically-triggered review workflow.
- Keep a repeatedly re-exported or renamed agent's installation stable — re-exporting always updates the same installation, never creates a duplicate.
- Prevent the exported workflow from ever exposing workspace secrets to a pull request from a fork.
- Let a workspace member bring completed — and in-progress — CI review results back into a DevDigest-visible history, correctly scoped to their own workspace.
- Let a workspace member stop DevDigest from tracking an installation.
- Let a workspace member push an agent's current configuration to every one of its existing CI installations at once, without repeating the export flow per repository.
- Let a workspace member see, at a glance, each of an agent's installations' health and how current its published configuration is relative to the agent's latest settings.

**Non-goals:**
- Generating workflows for anything other than GitHub Actions. The target-platform vocabulary reserves room for others, but only GitHub Actions is built now — the CI-side runner itself only knows how to read a GitHub Actions run's environment, so generating workflows for platforms it can't run under would produce something nothing can execute.
- Any change to the CI-side runner's own source code or its published input/output contracts. This spec treats it as fixed and builds only the pieces around it.
- Any change to the existing in-app (live) review path.
- Installing a GitHub App or enforcing branch-protection "block merge on findings." v1 authenticates purely through the workflow's own automatically-issued, per-run GitHub token plus one user-supplied LLM provider secret — no separate app-installation flow.
- Real-time or streaming updates of CI run status. Results are only ever discovered by an explicit or periodic check, never pushed live.
- Exporting one agent to many repos, or many agents to one repo, in a single *installation* action — each individual export targets exactly one agent and one repo. This is distinct from the bulk "Update CI config" action (AC-40): that action only republishes to installations that already exist, one at a time under the hood (looping the same single-installation update-in-place behavior as AC-5/AC-10) — it never creates a new installation and is not an exception to this rule, only a convenience wrapper around it.
- Removing the workflow or configuration files from the target repository when a workspace member disconnects an installation (see AC-14 and its note) — v1 disconnect only stops DevDigest's own tracking.
- Installing more than one agent to the *same* repository. v1 supports exactly one agent per repository and uses the flat `.devdigest/agents/<slug>.yaml` layout the mockup shows (the CI-side runner hard-fails on more than one manifest under `.devdigest/agents/`). Multiple agents per repository is deferred to a later iteration (AC-13 is re-scoped to enforce the v1 limit). Installing one agent to many *different* repositories is unaffected.

**Shared foundation — both tracks build on this; neither owns changing it.**

This feature is delivered by two independently workable pieces of work: a *producer* side (turns an agent into an installed CI workflow) and an *ingest* side (turns CI results back into workspace-visible history). Both depend on ground that already exists and is frozen by this spec:

- The configuration, export-request/response, installation, run, and result-file data shapes that the runner and the rest of this pipeline already agree on. Neither track redefines these; see Contracts (§9) for the one place a shape may need to grow, and even there only additively.
- The installation and run-history tables already exist in the database, currently empty and unused. Both tracks read/write them; see the workspace-scoping requirement (AC-28) for the one schema change this spec requires.
- A GitHub-write capability that can atomically commit a set of files and open, or reuse, a pull request already exists and is reused as-is by the producer side — it is not new work.
- The CI-side runner's own environment-variable contract (which variables it reads, what each means, its default behaviors) is completely fixed. The producer side's workflow generator must satisfy it exactly; this spec does not renegotiate it.

Two items are genuinely shared and must be established once, by whichever implementer picks them up first, rather than built twice independently: the workspace-scoping schema change (AC-28) and any contract addition that turns out to be unavoidable (§9). By contrast, the two new GitHub-API capabilities this feature needs split cleanly with no overlap: discovering and downloading finished workflow-run results belongs entirely to the ingest side; committing files and opening/reusing a pull request belongs entirely to the producer side (and already exists) — neither track needs to touch the other's capability.

## 3. User Stories

- As a workspace member with access to an agent, I want to export it to one of the workspace's connected GitHub repositories, so that every pull request there gets an automatic DevDigest review without anyone manually triggering it from DevDigest.
- As a workspace member, I want to see a history of CI-triggered review runs — including ones still in progress — across repos and agents, so that I can tell whether an exported agent is working and what it is finding, without leaving DevDigest.
- As a developer on the target repository who may never use DevDigest directly, I want the automated review to appear as a normal GitHub review or comment on my pull request, so that I get the feedback inside my existing workflow.

## 4. Workflow & Module Communication

**Producer flow — exporting an agent to a repo:**

```mermaid
sequenceDiagram
  participant U as Workspace member
  participant D as DevDigest server
  participant G as GitHub

  U->>D: Choose a connected repo + an agent, open the export flow
  D->>D: Compose the agent's configuration + linked skills into the checked-in shape the runner expects
  D->>D: Generate the review workflow (standard pull_request trigger only; explicit fork skip; required environment variables)
  D->>G: Reuse an already-open export pull request if one exists for this installation, otherwise open a new one with the generated files
  G-->>D: Pull request URL
  D->>D: Record the installation (stable identity, workspace-scoped)
  D-->>U: Show the pull request URL and the exact secret name + value to add to the repo
```

The "open the export flow" step above is, concretely, a 4-step wizard the workspace member walks through: choose the target platform (only GitHub Actions is functional — AC-33); preview every file the export will create, with only the generated workflow file editable (AC-34, AC-35); configure which pull-request events trigger the workflow and how results are posted (AC-38); and choose between opening a pull request or downloading the files for manual setup (AC-39). Editing the workflow file at the preview step is sticky — later changes to trigger or posting choices do not silently discard it (AC-36). The bundled CI-side runner itself ships in every export alongside these files even though it is not one of the files shown in the wizard (AC-37).

A workspace member can also republish an agent's current configuration to every one of its existing installations at once ("Update CI config"), without walking the wizard again — this reuses the same update-in-place logic per installation (AC-40, AC-41) and never opens a new pull request.

**Ingest flow — bringing results back:**

```mermaid
sequenceDiagram
  participant W as Target repo's GitHub Actions run
  participant U as Workspace member
  participant D as DevDigest server
  participant G as GitHub

  Note over W: A pull request triggers the installed workflow, independently of DevDigest
  W->>W: The runner reviews the PR, posts to GitHub, and writes its result file
  U->>D: Open the CI run history (or an automatic check fires while it's open)
  D->>G: Ask which workflow runs have happened recently for each tracked installation
  G-->>D: Run statuses (in progress / completed)
  D->>D: Show in-progress runs as running, keyed so a later check updates the same entry
  D->>G: For completed runs, retrieve the result file
  G-->>D: Result file contents
  D->>D: Validate the result before trusting it; attribute it to the installation/workspace it was fetched for, never to anything the file itself claims
  D-->>U: Updated run history + when it was last checked
```

The seam between the two flows is the result file the installed workflow produces: the producer side's generated workflow is responsible for making that file retrievable after the run finishes; the ingest side is responsible for retrieving it. Neither flow talks to the other directly — they only agree on that one artifact existing where the ingest side expects to find it.

## 5. Acceptance Criteria (EARS)

**Producer — composing and installing the workflow**

- **AC-1** (Event-driven): WHEN a workspace member with access to an agent starts the export flow, the system SHALL require choosing one of the workspace's already-connected repositories — the flow SHALL NOT accept an arbitrary, unvalidated repository name.
- **AC-2** (Ubiquitous): The system SHALL compose the exported configuration's name, model, system prompt, review strategy, and CI failure-gate policy directly from the source agent, and its skill list from that agent's currently linked, enabled skills.
- **AC-3** (Unwanted behavior): IF the source agent's configured provider is anything other than the CI-side runner's supported provider, THEN the exported configuration's provider field SHALL still be written as that supported provider.
  > *Why this is intentional, not a bug*: the CI-side runner always uses one specific LLM provider client at runtime and does not read the configuration's provider field to choose between providers — that field is validated but not acted on. Writing anything else into it would silently misrepresent what actually runs. A future implementer should not "fix" this by making the runner provider-switchable — that is a change to the runner's own fixed contract, out of scope here (see Non-goals).
- **AC-4** (Event-driven): WHEN an agent is exported to a given repository for the first time, the system SHALL assign that installation a configuration-file identity that remains stable for the lifetime of the installation, independent of later renames of the agent.
- **AC-5** (Unwanted behavior): IF an agent already installed to a repository is exported again, THEN the system SHALL overwrite the existing configuration file at its original stable identity rather than adding a second one.
  > *Why*: the CI-side runner fails outright if it finds more than one configuration file checked in. A drifting or re-derived identity across exports would eventually break every future CI run for that installation in a way invisible from inside DevDigest.
- **AC-6** (Ubiquitous): The system SHALL generate a review workflow that triggers only on the standard pull-request event — never on the variant that would run in the base repository's context with full secret access for a fork-originated change.
- **AC-7** (Unwanted behavior): IF the pull request that triggered a run originates from a fork, THEN the generated workflow SHALL skip the review job entirely rather than run it and fail.
  > *Why*: GitHub does not hand out repository secrets to fork-triggered runs of the standard trigger, so an attempted run would fail for a reason invisible to the external contributor and — if the check is required for merge — could block outside contributions purely because of this feature. Skipping cleanly avoids a confusing, unnecessary failure. This is also the CI-side runner's own stated expectation of whatever generates its workflow: it computes fork status itself but relies entirely on the workflow never scheduling it for one.
- **AC-8** (Ubiquitous): The system SHALL generate a workflow that supplies every environment variable the CI-side runner requires to run correctly, including which of its three ways of posting results (as a review, as a comment, or not at all) the workspace member chose during export.
- **AC-9** (Event-driven): WHEN an installation does not yet have an open export pull request, the system SHALL open one containing the generated files.
- **AC-10** (Unwanted behavior): IF an installation already has an open export pull request from a prior export, THEN a new export SHALL add to that existing pull request rather than opening a second one.
- **AC-11** (Event-driven): WHEN an export completes successfully, the system SHALL show the pull request's location and the exact secret name and value the workspace member must add to the target repository themselves.
- **AC-12** (Unwanted behavior): IF the GitHub operations required to open or update the export pull request fail, THEN the system SHALL surface that failure to the workspace member and SHALL NOT record an installation that implies the export succeeded.
- **AC-13** (Unwanted behavior): IF a workspace member attempts to export an agent to a repository that already has a *different* agent installed, THEN the system SHALL prevent that second installation and explain that v1 supports exactly one agent per repository.
  > *Why v1 is one-agent-per-repo (re-scoped 2026-07-09)*: the CI-side runner hard-fails if it finds more than one manifest under `.devdigest/agents/`, and v1 deliberately uses the flat, mockup-matching layout `.devdigest/agents/<slug>.yaml` (the `<slug>` is fixed at first export and stored on the installation, so it stays stable across agent renames — this is the "stable configuration-file identity" of AC-4/AC-5) rather than per-installation path scoping. Supporting multiple agents in one repository is deferred to a later iteration (see Non-goals). Re-exporting the *same* agent to the same repository still overwrites in place (AC-5); installing one agent to many *different* repositories is unaffected.
- **AC-14** (Event-driven): WHEN a workspace member disconnects an installation, the system SHALL stop including it in future result checks and in the CI tab's active-installation state, and SHALL NOT modify any file in the target repository.
  > *Why disconnect is DB-only in v1*: the write capability this feature reuses can commit or update files but cannot express removing one — building real file removal would be new GitHub-write capability, not reuse, disproportionate to this feature's otherwise tightly-scoped v1. The target repository's own owner remains responsible for removing the workflow/configuration files if they want the automated reviews to actually stop running, the same way they would remove any other CI vendor's workflow. This is a deliberate scope boundary, not an oversight.
- **AC-15** (Ubiquitous): The system SHALL reject export requests beyond 2 per minute per workspace. *Verify: integration test asserting a 3rd export request within a 60-second window is rejected.*

**Producer — Export Wizard steps**

- **AC-33** (Event-driven): WHEN the Target step of the export wizard is shown, the system SHALL list GitHub Actions as the only selectable, functional target platform and SHALL show the remaining target-platform entries as non-functional placeholders that do not advance the wizard if chosen.
- **AC-34** (Ubiquitous): The Preview step SHALL list every file the export will create — a configuration file, one file per linked skill, and a persistent-memory file — and SHALL include the persistent-memory file in that list even when it currently has no content.
- **AC-35** (Ubiquitous): Of the files listed in Preview, only the generated workflow file SHALL be editable; the configuration, skill, and persistent-memory files SHALL be shown but SHALL NOT be editable there.
- **AC-36** (Event-driven): WHEN the workspace member edits the workflow file's contents during Preview, the system SHALL treat that edited text as authoritative for what is committed at Install, and SHALL NOT silently overwrite it with a freshly regenerated version if the workspace member subsequently changes a trigger or "post results as" choice in Configure.
- **AC-37** (Ubiquitous): The system SHALL include the bundled CI-side runner among the files committed by every export, even though it is not one of the files listed or editable in Preview.
  > *Note*: how the server obtains the runner's built bytes to include here is the unresolved integration point tracked in §11 — this criterion states that inclusion is required behavior, not that the sourcing mechanism is decided.
- **AC-38** (Ubiquitous): The Configure step SHALL let the workspace member choose which pull-request events trigger the workflow (opened and synchronize enabled by default; reopened available but optional) and how results are posted (a GitHub review — the only choice that produces a verdict —, a plain pull-request comment, or none).
- **AC-39** (Ubiquitous): The Install step SHALL offer opening a pull request with the generated files (recommended) or downloading the same files as an archive for manual setup, and both choices SHALL record the same installation — differing only in whether a pull-request location is present on it.

**Producer — bulk configuration update**

- **AC-40** (Event-driven): WHEN a workspace member triggers a bulk configuration update for an agent, the system SHALL regenerate that agent's configuration and update the existing export pull request (or previously downloaded files, for an archive-based installation) for every one of that agent's active installations, using the same update-in-place behavior as a single re-export (AC-5, AC-10), and SHALL NOT open a new pull request for any of them.
- **AC-41** (Ubiquitous): The system SHALL report the outcome of a bulk configuration update separately for each installation, rather than as a single all-or-nothing result.
- **AC-42** (Event-driven): WHEN a workspace member changes the CI failure-gate policy on an agent's CI surface, the system SHALL only update the source agent's own stored setting, and SHALL NOT modify any file in any target repository until the next explicit per-repo re-export or bulk configuration update.

**Ingest — bringing results back**

- **AC-16** (Ubiquitous): The system SHALL check for new CI results only in response to the CI run history being open (an automatic periodic check while it is open) or an explicit refresh action — never on an independent, always-on server schedule.
- **AC-17** (Event-driven): WHEN a check for new results runs, the system SHALL determine, for every installation still being tracked, whether any workflow runs have occurred since the previous check.
- **AC-18** (State-driven): WHILE a discovered workflow run has not yet finished, the system SHALL show it in the run history as in progress, with no findings or cost data yet.
- **AC-19** (Event-driven): WHEN a previously in-progress run finishes, the system SHALL update that same run-history entry to its finished status rather than adding a new entry.
- **AC-20** (Ubiquitous): The system SHALL never represent one underlying CI run as two separate run-history entries, no matter how many checks observe it.
- **AC-21** (Event-driven): WHEN a finished run's result file is retrieved, the system SHALL validate its shape before using any of its contents, and SHALL discard it — falling back to whatever outcome GitHub itself reports for that run — if validation fails.
- **AC-22** (Ubiquitous): The system SHALL determine which workspace and installation a retrieved result belongs to solely from which installation/repository the server queried to retrieve it, never from any field inside the retrieved file itself.
  > *Why*: the result file is produced by a build process on infrastructure DevDigest does not control, potentially reachable by any contributor whose pull request triggers it. Treat its contents as data to validate and display, never as a source of identity or authorization.
- **AC-23** (Ubiquitous): The run history SHALL support filtering by agent, by repository, by status, and by a recency window.
- **AC-24** (Ubiquitous): The run history SHALL present four distinguishable states: no run has ever occurred for this workspace; the current filters match no runs; the last check itself failed; and a run was skipped because its pull request came from a fork.
- **AC-25** (Ubiquitous): The system SHALL show when the run history was last successfully checked.
- **AC-26** (Ubiquitous): The system SHALL reject refresh requests beyond 2 per minute per workspace. *Verify: integration test asserting a 3rd refresh request within a 60-second window is rejected.*
- **AC-27** (Unwanted behavior): IF a check's GitHub operations do not complete within 30 seconds, THEN the system SHALL fail that check visibly rather than leave the screen loading indefinitely. *Verify: integration test using a stalled mock GitHub client.*
- **AC-43** (Ubiquitous): The run history SHALL display, per run, the pull request, repository, agent, verdict, findings count, cost, duration, and a link to the underlying GitHub Actions job.
- **AC-44** (Ubiquitous): The verdict shown for a run in the run history SHALL be its own completion status (succeeded, failed, no findings, or running); the findings count shown SHALL be the total, with the critical/warning/suggestion breakdown available without leaving the row.

**Shared data model**

- **AC-28** (Ubiquitous): The system SHALL scope every installation and every run record directly to the workspace that owns it, stored on the record itself rather than derived only by following its link to an agent or to its installation, so that a run's workspace remains correctly resolvable even after its installation has been disconnected.
  > *Why this needs a schema change, and why that's safe here*: neither of the two existing tables this feature uses currently stores a workspace reference directly — today it would have to be derived by joining through the agent (for an installation) and then through the installation (for a run), and a disconnected installation's runs would lose that path entirely. This repository's rule against altering an already-applied migration governs *changing* an existing column's definition — it does not forbid *adding* a new column via a new migration, which is what this is. Because both tables are currently unused (zero rows in any real deployment of this feature), the new column can be required from the start, with no backfill step needed.
- **AC-45** (Ubiquitous): The system SHALL maintain a workflow-version counter on every installation, starting at 1 and increasing by exactly 1 on every successful re-export or bulk configuration update of that installation.
  > *Why this is additive, like AC-28*: this is a new column on the same currently-unused installation table, added the same safe way — a new migration, never an edit to an applied one, required from the start since the table has zero real rows. It gives the agent's CI surface (AC-46) a cheap, purely-numeric way to show whether an installation reflects the agent's most recently published configuration — useful context for deciding whether a bulk update (AC-40) is worth running — without this spec having to define any drift-detection logic beyond the counter itself.

**Agent editor surface**

- **AC-29** (Ubiquitous): The agent editor's CI surface SHALL summarize that agent's CI activity across all of its installations over the trailing 7 days, using the same rolling window as the run history's own recency filter.
- **AC-46** (Ubiquitous): The agent editor's CI surface SHALL show, for each of the agent's installations, the target repository, the target platform, the installation's most recent run status, and its current workflow-version counter (AC-45).
- **AC-47** (Ubiquitous): The agent editor's CI surface SHALL show a count of that agent's currently-active (not disconnected) installations.

**Security**

- **AC-30** (Ubiquitous): The system SHALL NEVER write, transmit, or commit the value of a workspace secret into a target repository — only the secret's required name ever appears in a generated file.
- **AC-31** (Event-driven): WHEN the export flow displays the required secret's value for the workspace member to copy, the system SHALL show it only to the authenticated workspace member performing that export, and SHALL NOT log it or persist it on the client.
- **AC-32** (Ubiquitous): Every new route this feature adds SHALL require the same authenticated, workspace-scoped access every other route in this codebase already requires — none of them are anonymously or cross-workspace reachable.
- **AC-48** (Ubiquitous): The system SHALL reject bulk configuration update requests beyond 2 per minute per workspace, the same limit a single export is subject to. *Verify: integration test asserting a 3rd bulk-update request within a 60-second window is rejected.*

## 6. Edge Cases

| Case | Expected behavior | Covered by |
|---|---|---|
| Target repository has zero open pull requests at export time | Export still succeeds — the workflow applies to future pull requests, not existing ones | AC-9 |
| Agent has zero linked skills | The exported skill list is empty; export proceeds without error | AC-2 |
| GitHub operations fail partway through export | Failure surfaces to the user; no installation is recorded implying success | AC-12 |
| A fork-authored pull request triggers a repo with an active installation | The review job is skipped, not attempted and failed | AC-7 |
| The source agent is deleted after being exported | Its installation(s) are removed automatically as a consequence of the existing agent-deletion behavior — equivalent to an implicit disconnect | AC-14 |
| The same underlying CI run is observed across two separate checks | The same run-history entry is updated in place, never duplicated | AC-19, AC-20 |
| A retrieved result file is malformed or incomplete | The file is discarded rather than trusted; the run's status reflects only what GitHub itself reports | AC-21 |
| A second, *different* agent is exported to a repository that already has one | v1 prevents it with a clear "one agent per repository" message; multiple-agents-per-repo is deferred to a later iteration | AC-13 |
| An already-installed agent is renamed, then exported again | The same configuration identity is overwritten; no second file is created | AC-4, AC-5 |
| An installation is re-exported while its export pull request is still open | The new export adds to that pull request rather than opening a second one | AC-10 |
| An installation is disconnected while it has run history | That history remains visible and correctly workspace-scoped afterward | AC-14, AC-28 |
| A check's GitHub calls stall | The check fails visibly rather than hanging indefinitely | AC-27 |
| A non-GitHub-Actions target is chosen in the wizard's Target step | The wizard does not advance past Target | AC-33 |
| The linked agent has no persistent memory content yet | The memory file is still listed in Preview, just empty | AC-34 |
| The workspace member edits the workflow file in Preview, then changes a Configure toggle | The edited workflow text is still what gets committed, unchanged by the toggle | AC-36 |
| The workspace member downloads the archive instead of opening a pull request | The same installation is recorded either way; only the pull-request location differs | AC-39 |
| A bulk configuration update succeeds for some installations and fails for others | Each installation's outcome is reported individually, not as one combined result | AC-41 |
| The "Fail CI on" control is changed but no export or bulk update follows | No file in any repository changes; the new value is only staged | AC-42 |
| Two installations of the same agent were last published at different times | Each shows its own workflow-version counter on the agent's CI surface | AC-45, AC-46 |

## 7. Non-functional

- The system SHALL reject export, refresh, or bulk-configuration-update requests beyond 2 per minute per workspace — see AC-15, AC-26, AC-48. *Verify: integration test.*
- IF a result check's GitHub operations exceed 30 seconds, THEN the system SHALL fail visibly rather than hang — see AC-27. *Verify: integration test with a stalled mock.*

## 8. Inputs (Provenance)

| Input | Provenance |
|---|---|
| Source agent's name, provider, model, system prompt, strategy, CI failure-gate policy | [reused: existing agent record] |
| Agent's linked, enabled skills | [reused: existing agent–skill linking] |
| Configuration, export-request/response, installation, run, and result-file shapes | [reused: existing shared contracts — frozen by this spec, see §9] |
| Atomic multi-file commit + pull-request open/reuse capability | [reused: existing GitHub-write capability] |
| Discover-recent-runs + retrieve-finished-run-result capability | [deterministic: new GitHub API orchestration — zero LLM calls] |
| Installation and run-history storage | [reused: existing tables, additive migration only — see AC-28] |
| Retrieved result file content | [deterministic: mechanically parsed and schema-validated; produced by the CI-side runner's own existing review invocation, itself unchanged and out of scope] |
| Bundled CI-side runner bytes included in every export (AC-37) | [reused: the CI-side runner's own existing build output — the exact sourcing mechanism is an unresolved technical item, see §11] |

No input in this feature requires a new LLM call. The only LLM call anywhere in this pipeline happens inside the CI-side runner's existing, unmodified review invocation — already built, already out of scope for change.

## 9. Contracts

**Export needs a way to identify one of the workspace's connected repositories**, not an arbitrary string. Preferred approach: keep the existing export-request shape's repository field as the plain "owner/name" display string it already is (needed for the GitHub calls and for the installation's own record) and carry the actual repository reference a different way — for instance, as part of which endpoint is called, rather than inside the request body. If a change to the existing shared shape turns out to be unavoidable, it must be additive only (a new optional-then-required field, never repurposing an existing one) and treated as shared-foundation work (§2) rather than something either track changes unilaterally.

**Two capabilities have no shape defined yet** (neither is a change to an existing frozen shape — both are new):
- *Disconnect*: something that identifies which installation to stop tracking, and confirms the new state.
- *Trigger a check*: something that asks the system to look for new results now, and reports back what changed (at minimum, an updated last-checked time; ideally which run entries changed).

Exact field names, and whether these are separate request/response pairs or folded into existing ones, are left to implementation planning.

**A third additive touchpoint, alongside AC-28**: the installation record needs a workflow-version counter (AC-45) it does not carry today. Same treatment as the workspace-scoping column: a new field on the installation shape, a new column on the same currently-unused table via a new migration — additive only, never a repurposing of an existing field, and safe to require from the start given the table has zero real rows.

Also needed: a way for a bulk configuration update (AC-40) to report a per-installation outcome list, and a way for the wizard's Install step to distinguish "opened/updated a pull request" from "produced a downloadable archive" in its response — both new, neither a change to an existing frozen shape.

**Fields already defined and reused as-is** (no change needed): the configuration shape's identity fields (name, provider, model, system prompt, skill list, strategy, failure-gate policy); the installation record's identity, repository, target-type, and installed-at fields; the run record's status, findings-count, cost, timestamp, and source-link fields; the result file's findings/severity counts, cost, duration, and identifying fields.

## 10. Untrusted Inputs

- **The retrieved CI result file** is authored by a build process running on infrastructure outside DevDigest's control (the target repository's own CI, triggered by whichever pull request the repository owner allowed to trigger it). It must be treated as data: schema-validated before any field is used, and never trusted to say which installation or workspace it belongs to (AC-21, AC-22) — that attribution comes only from which installation/repository the server itself queried to retrieve it.
- The pull request title, body, and diff that the CI-side runner reviews are already handled as untrusted content by that runner's own existing, unmodified pipeline (wrapped and never treated as instructions before reaching a model). This spec does not change that handling and does not re-derive it — it is out of scope because the runner itself is out of scope.

## 11. Open items

**User decisions pending: none.** Every open question raised while drafting this spec was resolved with the requesting user across five rounds of review; nothing here was assumed silently.

**Runner-bundle sourcing — RESOLVED (2026-07-09, post-research; evidence in `docs/plans/2026-07-09-research-export-to-ci.md` R1):**

The server obtains the CI-side runner bytes by **building the `ncc` bundle during export-request handling** (and during bulk update — AC-40), reading the freshly produced `dist/index.js`, and including it among the committed files (AC-37). This was chosen over vendoring-at-server-build or committing a prebuilt copy because the runner embeds `reviewer-core`'s grounding gate and deterministic verdict into every shipped artifact — a stale bundle is a correctness/security regression, not cosmetic, so building from current source on each export removes any staleness window. The `ncc` build MUST be placed behind an **injected adapter port** (invoked via the container), never called as raw `child_process`/filesystem code inside a service, to preserve the module's dependency discipline. The git-ignore contradiction (`agent-runner/.gitignore`'s blanket `dist/` overrides the root's negation, verified via `git check-ignore`) is **no longer blocking** under this approach — the bytes come from a fresh build, never from git; fixing it is only needed if the team later also wants `dist/index.js` committed for other reasons.

**No remaining open items.**
