# Spec: CI Agent-Runner Pipeline

**Spec ID:** SPEC-2026-07-09-ci-agent-runner-pipeline
**Status:** draft
**Date:** 2026-07-09
**Affects:** full-stack (server, client)
**Supersedes:** —

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

**Non-goals:**
- Generating workflows for anything other than GitHub Actions. The target-platform vocabulary reserves room for others, but only GitHub Actions is built now — the CI-side runner itself only knows how to read a GitHub Actions run's environment, so generating workflows for platforms it can't run under would produce something nothing can execute.
- Any change to the CI-side runner's own source code or its published input/output contracts. This spec treats it as fixed and builds only the pieces around it.
- Any change to the existing in-app (live) review path.
- Installing a GitHub App or enforcing branch-protection "block merge on findings." v1 authenticates purely through the workflow's own automatically-issued, per-run GitHub token plus one user-supplied LLM provider secret — no separate app-installation flow.
- Real-time or streaming updates of CI run status. Results are only ever discovered by an explicit or periodic check, never pushed live.
- Exporting one agent to many repos, or many agents to one repo, in a single action. Each export targets exactly one agent and one repo.
- Removing the workflow or configuration files from the target repository when a workspace member disconnects an installation (see AC-14 and its note) — v1 disconnect only stops DevDigest's own tracking.

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
- **AC-13** (Ubiquitous): The system SHALL allow more than one agent to be installed to the same repository, each as an independent installation with its own stable configuration-file identity.
- **AC-14** (Event-driven): WHEN a workspace member disconnects an installation, the system SHALL stop including it in future result checks and in the CI tab's active-installation state, and SHALL NOT modify any file in the target repository.
  > *Why disconnect is DB-only in v1*: the write capability this feature reuses can commit or update files but cannot express removing one — building real file removal would be new GitHub-write capability, not reuse, disproportionate to this feature's otherwise tightly-scoped v1. The target repository's own owner remains responsible for removing the workflow/configuration files if they want the automated reviews to actually stop running, the same way they would remove any other CI vendor's workflow. This is a deliberate scope boundary, not an oversight.
- **AC-15** (Ubiquitous): The system SHALL reject export requests beyond 2 per minute per workspace. *Verify: integration test asserting a 3rd export request within a 60-second window is rejected.*

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

**Shared data model**

- **AC-28** (Ubiquitous): The system SHALL scope every installation and every run record directly to the workspace that owns it, stored on the record itself rather than derived only by following its link to an agent or to its installation, so that a run's workspace remains correctly resolvable even after its installation has been disconnected.
  > *Why this needs a schema change, and why that's safe here*: neither of the two existing tables this feature uses currently stores a workspace reference directly — today it would have to be derived by joining through the agent (for an installation) and then through the installation (for a run), and a disconnected installation's runs would lose that path entirely. This repository's rule against altering an already-applied migration governs *changing* an existing column's definition — it does not forbid *adding* a new column via a new migration, which is what this is. Because both tables are currently unused (zero rows in any real deployment of this feature), the new column can be required from the start, with no backfill step needed.

**Agent editor surface**

- **AC-29** (Ubiquitous): The agent editor's CI surface SHALL summarize that agent's CI activity across all of its installations over the trailing 7 days, using the same rolling window as the run history's own recency filter.

**Security**

- **AC-30** (Ubiquitous): The system SHALL NEVER write, transmit, or commit the value of a workspace secret into a target repository — only the secret's required name ever appears in a generated file.
- **AC-31** (Event-driven): WHEN the export flow displays the required secret's value for the workspace member to copy, the system SHALL show it only to the authenticated workspace member performing that export, and SHALL NOT log it or persist it on the client.
- **AC-32** (Ubiquitous): Every new route this feature adds SHALL require the same authenticated, workspace-scoped access every other route in this codebase already requires — none of them are anonymously or cross-workspace reachable.

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
| Two different agents are exported to the same repository | Two independent installations, two stable configuration identities | AC-13 |
| An already-installed agent is renamed, then exported again | The same configuration identity is overwritten; no second file is created | AC-4, AC-5 |
| An installation is re-exported while its export pull request is still open | The new export adds to that pull request rather than opening a second one | AC-10 |
| An installation is disconnected while it has run history | That history remains visible and correctly workspace-scoped afterward | AC-14, AC-28 |
| A check's GitHub calls stall | The check fails visibly rather than hanging indefinitely | AC-27 |

## 7. Non-functional

- The system SHALL reject export or refresh requests beyond 2 per minute per workspace — see AC-15, AC-26. *Verify: integration test.*
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

No input in this feature requires a new LLM call. The only LLM call anywhere in this pipeline happens inside the CI-side runner's existing, unmodified review invocation — already built, already out of scope for change.

## 9. Contracts

**Export needs a way to identify one of the workspace's connected repositories**, not an arbitrary string. Preferred approach: keep the existing export-request shape's repository field as the plain "owner/name" display string it already is (needed for the GitHub calls and for the installation's own record) and carry the actual repository reference a different way — for instance, as part of which endpoint is called, rather than inside the request body. If a change to the existing shared shape turns out to be unavoidable, it must be additive only (a new optional-then-required field, never repurposing an existing one) and treated as shared-foundation work (§2) rather than something either track changes unilaterally.

**Two capabilities have no shape defined yet** (neither is a change to an existing frozen shape — both are new):
- *Disconnect*: something that identifies which installation to stop tracking, and confirms the new state.
- *Trigger a check*: something that asks the system to look for new results now, and reports back what changed (at minimum, an updated last-checked time; ideally which run entries changed).

Exact field names, and whether these are separate request/response pairs or folded into existing ones, are left to implementation planning.

**Fields already defined and reused as-is** (no change needed): the configuration shape's identity fields (name, provider, model, system prompt, skill list, strategy, failure-gate policy); the installation record's identity, repository, target-type, and installed-at fields; the run record's status, findings-count, cost, timestamp, and source-link fields; the result file's findings/severity counts, cost, duration, and identifying fields.

## 10. Untrusted Inputs

- **The retrieved CI result file** is authored by a build process running on infrastructure outside DevDigest's control (the target repository's own CI, triggered by whichever pull request the repository owner allowed to trigger it). It must be treated as data: schema-validated before any field is used, and never trusted to say which installation or workspace it belongs to (AC-21, AC-22) — that attribution comes only from which installation/repository the server itself queried to retrieve it.
- The pull request title, body, and diff that the CI-side runner reviews are already handled as untrusted content by that runner's own existing, unmodified pipeline (wrapped and never treated as instructions before reaching a model). This spec does not change that handling and does not re-derive it — it is out of scope because the runner itself is out of scope.

## 11. Open items

**User decisions pending: none.** Every open question raised while drafting this spec was resolved with the requesting user across five rounds of review; nothing here was assumed silently.

**Explicit open integration point — not a user decision, needs technical investigation before or during implementation:**

How the server obtains the built CI-side runner bundle to embed as part of the exported files is unresolved. This matters because: the runner package's own built output is excluded from version control by its own local ignore rule, and nothing in this repository currently builds it as part of any automated workflow — so, as of this spec, the bytes needed for export do not exist anywhere they could simply be copied from. (Note for whoever resolves this: there is also a standing contradiction between this repository's top-level ignore rules, which explicitly try to force the runner's built output to be committed with a comment stating it must be, and the runner package's own local ignore rule, which currently wins and excludes it anyway — worth resolving as part of the same investigation, since fixing that contradiction may itself be part of the answer.) Candidate approaches, none chosen: build it as part of handling the export request itself; build it once as part of the server's own build/release process and vendor the output; or commit a prebuilt copy and accept it goes stale until manually refreshed. This is named here so the researcher/implementation-planner resolves it deliberately, rather than a cold implementer discovering it mid-task with no guidance.
