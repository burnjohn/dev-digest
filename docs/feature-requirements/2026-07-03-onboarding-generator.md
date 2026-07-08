# Spec: Onboarding Generator

**Spec ID:** SPEC-2026-07-03-onboarding-generator
**Status:** draft
**Date:** 2026-07-03
**Affects:** full-stack (client · server · repo-intel facts)
**Supersedes:** —

## 1. Problem & Motivation

A newcomer to an unfamiliar repository has no fast, trustworthy way to understand its architecture, how to run it, and where to start reading, without either reading the whole codebase manually or dumping the whole repository into an LLM and paying for/waiting on that context. This feature generates a one-page "Onboarding Tour" per repository: deterministic code computes every fact (stack, structure, routes, scripts, import graph, file importance) at zero LLM cost, and exactly ONE structured LLM call turns those facts into readable narrative. The tour is persisted so it loads instantly and can be refreshed on demand.

## 2. Goals / Non-goals

**Goals:**
- Generate a 5-section Onboarding Tour for the repository currently selected in the workspace switcher: Architecture overview, Critical paths, How to run locally, Guided reading path, First tasks.
- Compute every underlying fact deterministically from `repo-intel` and the repository's clone/GitHub content — zero LLM calls.
- Make exactly one structured LLM call per full generation, to turn facts into narrative text.
- Persist the generated tour so re-opening the page is instant; support manual "Regenerate."
- Order the Guided reading path by computed importance rank — never alphabetically.
- Work usefully even when the repository has no managed clone/index yet, or when the index is degraded/partial — never a blank screen.

**Non-goals:**
- Automatic or continuous regeneration on repository changes — v1 is manual "Regenerate" only.
- Any spec-conformance or merge-blocking behavior (later lesson).
- Multi-repo comparison or cross-repo onboarding tours.
- Editing tour content by hand — the tour is generated, not authored.
- More than one LLM call per generation, or sending full file contents of the repository to the LLM.
- A hotness/churn signal in the ranking formula (deliberately deferred repo-wide; see §5 Ranking).
- Reading `.gitignore`-excluded, nested-repository, or dependency-folder content as part of any repo other than the selected one.

## 3. User Stories

- As a newcomer, I open the Onboarding Tour for the repository selected in my workspace and see all 5 sections generated from that repo's real facts — stack, structure, routes, scripts, and import graph.
- As a user, I can regenerate the tour on demand and see when it was last refreshed.
- As a user, I can share a link to the tour.
- As a user, the Guided reading path is ordered by importance rank, most central files first, never alphabetically.
- As a user, each Critical path and Guided reading path entry opens its source through a GitHub blob link.
- As a user, when the repository has no managed clone yet, I still get a useful "lite" tour built from what GitHub's API can tell me, clearly badged, with a way to start full indexing.
- As a user, when the repo index is degraded or partial, I still get a useful deterministic skeleton from whatever facts exist, plus an honest degraded/partial badge — never a blank screen.
- As an operator, I can see the generation cost in the logs, in cents, and confirm the tour was produced with exactly one LLM call.

## 4. Workflow & Module Communication

```mermaid
flowchart TD
    U[User opens Onboarding Tour for selected repo] --> Q{Persisted tour exists?}
    Q -- yes --> Show[Render sections + "last refreshed"]
    Q -- no / Regenerate clicked --> Gen[Generation]

    subgraph Gen[Generation — zero LLM until the last step]
      G1{Managed clone/index available?}
      G1 -- yes --> G2[repo-intel: rank, critical paths,\nsymbols, importers, file_facts endpoints]
      G2 --> G3[Clone-file reads: package.json, .env.example,\ndocker-compose — stack + run steps]
      G1 -- no --> G4[GitHub API: Git Trees + Contents\n(package.json, README) — lite fact set]
      G3 --> G5[Deterministic fact bundle + rank-ordered file list]
      G4 --> G5
      G5 --> G6[ONE structured LLM call:\nfacts in, 5 narrative sections out]
      G6 --> G7[Persist tour + generated_at + degraded/lite flags\n+ record LLM cost in cents]
    end

    G7 --> Show
    G1 -- no clone --> CTA[Offer "Clone & index for full tour"]
```

## 5. Screenshot-Derived UX Requirements

Layout, section order, and controls are taken directly from the provided design screenshots and are binding unless they conflict with a hard invariant below (in which case the conflict is called out explicitly):

- Left workspace sidebar gets an "Onboarding Tour" item under WORKSPACE, positioned between "Pull Requests" and "Project Context."
- Page header: title "Onboarding for `<repo>`" (repo name rendered in an accent color), subtitle "Generated from index of N files · last refreshed `<time>` ago," and two top-right actions: "Regenerate" and "Share link."
- An "ON THIS PAGE" table of contents lists all 5 sections in generation order.
- **Section 1 — Architecture overview:** a prose paragraph containing inline file references, plus a small boxed architecture diagram whose nodes represent layers/modules (color-outlined by kind — application code, middleware, datastores) and whose edges represent call/data flow.
- **Section 2 — Critical paths:** rows of file path + a one-line "why it matters," each with an "Open" action on the right that links to the file's GitHub blob URL.
- **Section 3 — How to run locally:** a numbered, ordered list of copyable shell commands (install, environment setup, local dependency services, dev server), each row with a copy-to-clipboard control.
- **Section 4 — Guided reading path:** a numbered, ordered list of files, each with a one-line rationale beneath it; order follows computed importance rank, never alphabetical.
- **Section 5 — First tasks:** horizontal cards, each with a bold title, a target path in muted text, and a complexity badge (Low / Medium / High, color-coded).
- Every section card has a collapse/expand control in its header.
- `[NEEDS CLARIFICATION]` — exact color tokens for the complexity badges and the architecture-diagram node categories are not specified numerically in the digest; implementer should match the existing severity/category color conventions already used elsewhere (e.g. blast node coloring) rather than invent a new palette. Non-blocking for this spec.

## 6. UX Requirements

- **Empty/no-clone state:** WHERE the selected repository has no managed clone or index, the page SHALL still render a "lite" tour (see §8) with a visible degraded/lite badge and a "Clone & index for full tour" call to action — never a disabled Generate action and never a blank page.
- **Loading state:** WHILE a generation is in progress, the page SHALL show a non-blocking in-progress indicator; the previously persisted tour (if any) SHALL remain visible until the new one is ready.
- **Error state:** IF generation fails outright (not a degraded/partial case, but a hard failure), THEN the page SHALL keep showing the last successfully persisted tour (if any) and surface an inline error with a retry action; if no tour was ever persisted, it SHALL show the deterministic skeleton (facts collected, narrative sections empty with a "narrative unavailable" note) rather than a blank page.
- **Share link:** the "Share link" action SHALL copy a URL that, when opened by another workspace member, deep-links to this repository's Onboarding Tour page.

## 7. API Requirements

- A read endpoint SHALL return the persisted Onboarding Tour for a given repository (workspace-scoped), including its 5 sections, generation timestamp, and index-health/degraded metadata — returning a well-formed "not yet generated" response (not an error) when no tour has ever been generated for that repository.
- A generation endpoint SHALL trigger fact-gathering, ranking, and the single structured LLM call for a given repository (workspace-scoped), persist the resulting tour, and return the refreshed tour (or accept the request and let the client poll/refresh, consistent with this codebase's existing async-generation conventions).
- Both endpoints SHALL enforce the same workspace-scoping discipline as existing repository-scoped endpoints (e.g. `GET /pulls/:id/blast`) — a cross-workspace request SHALL behave as not-found, not as a data leak.
- The generation endpoint SHALL be rate-limited to prevent repeated accidental fan-out of paid LLM calls from rapid Regenerate clicks (exact limit is an implementation-planner decision; the requirement is that an unlimited-click Regenerate is not acceptable).

## 8. Analyzer / repo-intel Requirements

The analyzer computes facts in two modes, selected by whether a managed clone/index exists for the repository:

**Full mode (managed clone/index present):**
- Stack + run steps: read `package.json` (dependencies + `scripts`), `.env.example`, and any docker-compose file directly from the repository's clone.
- Directory structure and architecture shape: derived from the top-ranked files and the import graph (edges), not a raw full-tree dump.
- Routes/API endpoints: aggregated repo-wide from the already-extracted per-file endpoint facts.
- Critical paths and Guided reading path: the existing dependency-chain and file-importance computations over the import graph.
- Symbols and caller reachability for context: existing symbol/importer lookups, reused as-is.
- GitHub blob links: built from the repository's owner/name plus a head/default-branch commit SHA — the same pattern already used for Blast Radius links.

**Lite mode (no managed clone/index):**
- Structure: fetched via the GitHub API's recursive tree listing.
- Stack + run steps: fetched via the GitHub API's file-contents endpoint for `package.json`.
- Architecture narrative seed: fetched via the GitHub API's file-contents endpoint for the repository's README, when present.
- Reading path: a documented heuristic (declared package entry points + top-level directories) — there is no import graph in this mode, so it is NOT rank-ordered by PageRank; the tour SHALL be badged lite/degraded so this distinction is visible to the user.
- Critical paths section SHALL still render (never omitted — see §2 Goals), using the same heuristic file list with an honest "based on limited data" framing.

**Repo isolation (hard invariant):** Onboarding SHALL derive facts only from files belonging to the selected target repo. Nested repositories, gitignored paths, generated dependency folders, and files outside the selected repository's identity/clone MUST be excluded from indexing, ranking, PageRank, critical paths, and generated tour content. Fact-gathering for the full mode SHALL run against a managed clean clone from origin, never a local development working tree, and SHALL skip any nested directory that itself contains its own repository metadata.

**Scale bound:** fact-gathering and ranking operate over at most the repository's indexed file set (capped at the platform's existing indexing ceiling); when that ceiling is hit the index is marked partial and the tour is generated from the partial fact set rather than failing.

## 9. Ranking Requirements

- The Guided reading path rank SHALL be computed as `rank = pagerank × (1 + hotness)` over the repository's import graph.
- In v1, `hotness` is fixed at `0` for every file (no git-churn signal is computed), so the formula's effective value is `rank = pagerank`. The formula is stated in full so that adding a real hotness signal later requires no change to the reading-path ordering logic — only to how `hotness` is populated.
- The Guided reading path SHALL be sorted by this rank, descending. Alphabetical ordering is explicitly incorrect and SHALL NOT be used.
- Fact-gathering, ranking, and reading-path ordering SHALL make zero LLM calls.

## 10. Persistence and Cache Requirements

- The generated tour SHALL be persisted per repository (workspace-scoped through the repository's own workspace ownership), including: the 5 sections' content, a generation timestamp, and index-health metadata (mode: full/lite, status: full/partial/degraded/failed, degraded reason when applicable).
- Opening the Onboarding Tour page for a repository with a persisted tour SHALL render it immediately from storage, without triggering a new generation.
- "Regenerate" SHALL recompute facts and ranking, make exactly one new LLM call, and overwrite the persisted tour with the fresh result and a fresh timestamp — the previous tour is not kept as history in v1.
- The subtitle's "last refreshed `<time>` ago" SHALL be computed from the persisted generation timestamp.
- `[NEEDS CLARIFICATION]` — an existing but unregistered database table already models "one JSON blob + generation timestamp per repository," which is a structural fit for this requirement; it currently lacks workspace-scoping wired through its owning repository the way other per-repository tables do (see §11 for the provenance framing). Confirm at planning time whether that table is adopted with additive columns (index-health metadata is not currently modeled on it) or whether a new migration is warranted — no existing applied migration or table is to be altered in place.

## 11. LLM and Cost Invariants

- One full generation (full mode or lite mode) MUST make exactly one structured LLM call.
- Fact gathering, ranking, and reading-path ordering MUST make zero LLM calls.
- The single LLM call receives a bounded, rank-ordered subset of facts (top-N ranked files' summaries, aggregated route/script/stack facts, critical-path chains) — never the full contents of every file in the repository.
- The LLM call MUST produce exactly the 5 sections, in the fixed order defined in §5, as structured output — not free-form text requiring further parsing heuristics.

## 12. Degraded / Partial Index Behavior

- IF the repository has no managed clone or index, THEN the system SHALL generate a lite tour from GitHub API facts (§8) rather than blocking generation or showing an empty page.
- IF the repository's index status is `partial` or `degraded`, THEN the system SHALL generate the tour from whatever facts the partial/degraded index provides, and SHALL display a degraded/partial badge on the page.
- IF the repository's index status is `failed` and no GitHub API fallback data is available either, THEN the system SHALL still render a deterministic skeleton (section headers, honest "not enough data" notices per section) rather than a blank screen or a hard error page.
- The degraded/partial/lite vocabulary reuses the existing index-health model already used by Blast Radius (status ∈ full/partial/degraded/failed, plus a boolean degraded flag and a reason code).

## 13. Logging / Observability

- WHEN a generation completes, the system SHALL log exactly one LLM call attributed to that generation, together with its cost expressed in cents.
- WHEN a generation runs in lite mode, degraded mode, or hits the file-count ceiling, the system SHALL log which condition applied, so operators can distinguish a full-fidelity tour from a reduced one after the fact.

## 14. Acceptance Criteria (EARS)

- **AC-1** (Event-driven): WHEN a user opens the Onboarding Tour page for the repository currently selected in the workspace, the system SHALL show all 5 sections — Architecture overview, Critical paths, How to run locally, Guided reading path, First tasks — in that fixed order.
- **AC-2** (Event-driven): WHEN a persisted tour exists for the selected repository, the system SHALL render it immediately and SHALL NOT trigger a new generation.
- **AC-3** (Event-driven): WHEN a user activates "Regenerate," the system SHALL recompute facts and ranking, make exactly one structured LLM call, persist the resulting tour with a fresh generation timestamp, and update the "last refreshed" subtitle accordingly.
- **AC-4** (Ubiquitous): The system SHALL perform fact-gathering, ranking, and reading-path ordering with zero LLM calls.
- **AC-5** (Ubiquitous): One full generation SHALL make exactly one structured LLM call, regardless of full or lite mode.
- **AC-6** (Event-driven): WHEN generation completes, the system SHALL record, in the run log, exactly one LLM call and its cost expressed in cents.
- **AC-7** (Event-driven): WHEN the Guided reading path is rendered, the system SHALL order its entries by descending computed rank (`pagerank × (1 + hotness)`, with `hotness = 0` in v1) and SHALL NOT order them alphabetically.
- **AC-8** (Event-driven): WHEN a Critical path or Guided reading path entry has a resolvable source location, the system SHALL render an action that opens that file at GitHub via a blob URL built from the repository's owner, name, a head/default-branch commit SHA, and the file path.
- **AC-9** (Unwanted behavior): IF a Critical path or Guided reading path entry has no resolvable source location, THEN the system SHALL render that entry without an Open/blob-link action instead of a broken or placeholder link.
- **AC-10** (Optional feature): WHERE the selected repository has no managed clone or index, the system SHALL generate a lite tour from GitHub API facts (repository tree, `package.json`, README), badge it as lite/degraded, and offer a "Clone & index for full tour" action.
- **AC-11** (Unwanted behavior): IF the repository's index status is `partial` or `degraded`, THEN the system SHALL generate the tour from the available facts and SHALL display a degraded/partial badge.
- **AC-12** (Unwanted behavior): IF neither a managed index nor GitHub API fact data is available for the repository, THEN the system SHALL render a deterministic skeleton with per-section "not enough data" notices instead of a blank page or an unhandled error.
- **AC-13** (Ubiquitous): The system SHALL derive all onboarding facts only from files belonging to the selected repository — excluding gitignored paths, nested repositories (subdirectories containing their own repository metadata), and generated dependency folders — for indexing, ranking, critical paths, and generated content.
- **AC-14** (Ubiquitous): Full-mode fact-gathering SHALL run against a managed clean clone from origin, never against an arbitrary local working tree.
- **AC-15** (Event-driven): WHEN the user activates "Share link," the system SHALL copy a URL that deep-links another workspace member directly to this repository's Onboarding Tour page.
- **AC-16** (Unwanted behavior): IF a generation request is fired repeatedly in rapid succession, THEN the system SHALL rate-limit it rather than fanning out multiple paid LLM calls per click-burst.
- **AC-17** (Event-driven — acceptance scenario): WHEN onboarding is run on an unfamiliar indexed open-source repository, the system SHALL produce a tour where all 5 sections are present, the run log shows exactly one LLM call with its cost in cents, the Guided reading path is rank-ordered (not alphabetical), and Critical path / Guided reading path entries open their source through GitHub blob links — verify: manual acceptance run against a real seeded repo.
- **AC-18** (Event-driven): WHEN a generation fails outright after a previously successful generation exists, the system SHALL keep displaying the last successfully persisted tour and surface an inline retryable error, rather than clearing the page.

## 15. Edge Cases

| Case | Expected behavior | Covered by |
|---|---|---|
| Repository has no clone/index at all | Lite tour from GitHub API + "Clone & index" CTA | AC-10 |
| Index status is `partial` (file-count ceiling hit) | Tour generated from partial facts + degraded badge | AC-11 |
| Index status is `degraded` (fallback path) | Tour generated from degraded facts + degraded badge | AC-11 |
| No clone, no GitHub API data reachable | Deterministic skeleton with per-section "not enough data" notices | AC-12 |
| A Guided reading path file has no resolvable GitHub location | Entry renders without an Open action | AC-9 |
| Rapid repeated Regenerate clicks | Rate-limited, not fanned out | AC-16 |
| Nested repository directory inside the selected repo | Excluded from all facts and ranking | AC-13 |
| Gitignored directory inside the selected repo | Excluded from all facts and ranking | AC-13 |
| Repository exceeds the indexing file-count ceiling | Marked partial; tour still generated from the truncated set | AC-11 |
| User regenerates after a prior successful generation | Previous tour overwritten, no history kept in v1 | AC-3 |
| Generation fails after a tour was already persisted once | Last good tour stays visible + inline retry | AC-18 |

## 16. Inputs (Provenance)

| Input | Provenance |
|---|---|
| File importance rank (PageRank over import graph) | [deterministic: repo-intel] |
| Hotness component of rank (fixed at 0 in v1) | [deterministic: repo-intel] (constant, not computed) |
| Critical paths (dependency chains from top-ranked files) | [deterministic: repo-intel] |
| Symbols / caller reachability | [deterministic: repo-intel] |
| Repo-wide route/endpoint inventory | [deterministic: repo-intel] (aggregated from existing per-file endpoint facts) |
| Stack + npm scripts + env/docker facts (full mode) | [deterministic: repo-intel] (direct clone file reads) |
| Structure, package.json, README (lite mode) | [deterministic: repo-intel] (GitHub API reads) |
| GitHub blob link components (owner/name/sha) | [reused: L04] (same pattern as Blast Radius links) |
| Index health (status/degraded/reason) | [reused: L04] (same vocabulary as Blast Radius index health) |
| 5-section narrative (body text, diagram, links per section) | [new: 1 LLM call] — justification: turning a bounded, rank-ordered fact bundle into skimmable prose and a small architecture diagram requires language generation; deterministic templating cannot produce readable narrative explaining *why* a file matters. Bounded to exactly one call per generation (§11). |

## 17. Contracts

**Onboarding Tour (persisted / API response)**

| Field | Type (conceptual) | Meaning | Null means |
|---|---|---|---|
| repo_id | id | Owning repository | never null |
| generated_at | timestamp | When this tour was last (re)generated | never null once a tour exists; absent entirely = "never generated" |
| mode | enum (`full` / `lite`) | Whether facts came from the managed index or the GitHub API fallback | never null |
| index_status | enum (`full` / `partial` / `degraded` / `failed`) | Health of the underlying fact source at generation time | never null |
| degraded | boolean | Whether the tour should show a degraded/partial badge | never null |
| degraded_reason | string (code) | Why degraded/lite, when applicable | null = fully healthy |
| llm_cost_cents | integer ≥ 0 | Cost of the single structured LLM call for this generation | null = cost unknown (should not occur on a successful generation) |
| sections | ordered list of 5 | One entry per fixed section kind (architecture / critical_paths / how_to_run / reading_path / first_tasks) | never null; a section with insufficient facts still appears with an empty-state body |

**Section**

| Field | Type (conceptual) | Meaning | Null means |
|---|---|---|---|
| kind | enum (fixed 5 values) | Which of the 5 sections this is | never null |
| title | string | Section heading | never null |
| body | markdown string | Narrative content | empty string = no facts available for this section |
| diagram | mermaid string | Optional small diagram (architecture / how-to-run only) | null = no diagram for this section |
| entries | ordered list | Per-section structured rows (file + rationale, command + copy, card + badge, etc. — shape varies by kind) | empty list = nothing to show, not an error |

**Entry (Critical path / Guided reading path row)**

| Field | Type (conceptual) | Meaning | Null means |
|---|---|---|---|
| path | string | Repository-relative file path | never null |
| rationale | string | One-line "why it matters" / reading reason | never null |
| rank | number | Computed importance rank (reading path only) | null in lite mode (no import graph) |
| github_link | string (URL) | Blob URL to the file at the indexed commit | null = source location not resolvable (AC-9) |

## 18. Untrusted Inputs

None. This feature reads only mechanically-derived facts (file paths, dependency graph, package manifests, route strings, README text) as raw material for the single LLM call; it does not execute or follow instructions embedded in repository content. Consistent with the existing onboarding system prompt convention, any repository-sourced text passed to the LLM (e.g. README content in lite mode) SHALL be treated as data to summarize, never as instructions — the system prompt's existing untrusted-content handling already establishes this and SHALL be preserved.

## 19. [NEEDS CLARIFICATION]

- Exact persistence target: whether the existing unregistered per-repository JSON+timestamp table is extended with additive columns (mode, index_status, degraded, degraded_reason, llm_cost_cents) and proper workspace-scoping wired through its owning repository, or whether a new migration is created instead. No existing applied migration or table is to be altered in place either way — this is a planning-time choice, not a product-requirements gap.
- Exact color tokens for complexity badges (Low/Medium/High) and architecture-diagram node categories (§5) — non-blocking; implementer should reuse existing category-color conventions already established elsewhere in the product.
