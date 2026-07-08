# Spec: PR Why + Risk Brief

**Spec ID:** SPEC-2026-07-03-pr-why-risk-brief
**Status:** draft
**Date:** 2026-07-03
**Affects:** full-stack (server: extends `pr_brief` · client: new Overview card)
**Supersedes:** —

## 1. Problem & Motivation

A reviewer opening a PR today sees WHAT changed (diff, findings) but has to reconstruct WHY the change exists and WHERE the real risk concentrates by reading the whole diff and cross-referencing Blast Radius manually. The repository already composes a deterministic `PrBrief` (intent, blast radius, mechanically-derived risks, prior-PR history) with zero LLM calls after every review run, but it does not explain the change in plain language, does not assign an overall risk level, and does not give the reviewer an ordered "read these first" path. This feature adds that narrative and prioritization layer on top of the existing deterministic facts, using exactly one bounded structured LLM call, so a reviewer can decide in seconds what matters most before diving into the diff.

## 2. Goals / Non-goals

**Goals:**
- Add a "Why + Risk Brief" card to the PR Overview tab showing: what the PR does, why it exists, an overall risk level, a list of concrete risks grounded in real files/endpoints/symbols, and an ordered "review focus" reading list.
- Extend the existing `pr_brief` record (same object, same storage) additively with the new fields — never replace or duplicate the existing `intent`/`blast`/`risks`/`history` building blocks.
- Generate the new (LLM) part via exactly one structured LLM call, triggered explicitly by the user, using only bounded deterministic inputs already available in the platform (intent, blast radius, diff statistics, PR title/body, prior findings) — never the full diff or full file contents.
- Persist the generated result per PR; reopening the PR reads the cached result with zero new LLM calls.
- Validate every risk/review-focus file, symbol, and endpoint reference against real deterministic facts after the LLM responds; drop or repair anything that does not resolve to a real location — never render a broken link.

**Non-goals:**
- Replacing or regenerating the existing deterministic `intent`/`blast`/`risks`-from-findings composition — that auto-composition after every review run is unchanged and keeps making zero LLM calls.
- Full review generation, or any change to how findings/verdicts are produced.
- Any merge-blocking policy based on risk level.
- Sending the full diff, full file contents, or the whole repository tree to the LLM.
- Multi-PR comparison of briefs.
- A historical timeline of briefs across a PR's commits (see Stretch).
- Hand-editing brief content by a user.
- Automatic regeneration on every push — v1 regeneration is an explicit user action only.
- Building a new diff viewer or file-navigation surface — the feature reuses the existing GitHub blob-link convention and the existing Files-changed tab.

## 3. User Stories

- As a reviewer opening a PR, I want a short "what this PR does" and "why it exists" summary, so that I don't have to read the whole diff to understand intent.
- As a reviewer, I want an overall risk level (Low/Medium/High/Critical) shown prominently, so that I can triage which PRs need careful attention first.
- As a reviewer, I want a list of concrete risks that each point to a real file, endpoint, or symbol, so that I can jump straight to the risky code.
- As a reviewer, I want an ordered "review focus" list telling me which files to read first and why, so that I spend my limited review time on what matters most.
- As a reviewer, I want to reopen a PR and see the same brief instantly without waiting for a new LLM call, and to explicitly regenerate it when the PR has changed materially.
- As an operator, I want every brief generation logged with exactly one LLM call, its cost, and confirmation that the input stayed within the token budget, so that I can audit cost and catch regressions.

## 4. Workflow & Module Communication

```mermaid
flowchart TD
    U[User opens PR Overview tab] --> Q{Cached brief has\nwhat/why/risk_level/review_focus?}
    Q -- yes --> Show[Render enhanced PR BRIEF/INTENT/BLAST RADIUS cards\n+ Review Focus card, from cache]
    Q -- no --> Empty[Render empty state:\n"Generate brief" action]

    Empty -- user clicks Generate --> Gen
    Show -- user clicks Regenerate --> Gen

    subgraph Gen[Generation — deterministic gather, then ONE LLM call]
        G1[Gather bounded deterministic inputs:\nintent, blast summary, diff stats/grouped files,\nPR title+body, prior CRITICAL/WARNING findings,\nbounded Project Context excerpts]
        G1 --> G2[ONE structured LLM call:\nwhat, why, risk_level, risks[], review_focus[]]
        G2 --> G3[Deterministic post-validation:\nevery file/endpoint/symbol reference\nmust resolve to a real changed file,\nblast file, endpoint, or known repo path]
        G3 --> G4{Reference resolves?}
        G4 -- yes --> G5[Keep reference + attach github_link]
        G4 -- no --> G6[Drop or repair the reference\n— never render a broken link]
        G5 --> G7[Merge LLM fields into the existing\npr_brief record — additive only]
        G6 --> G7
        G7 --> G8[Persist + log: 1 LLM call, cost,\ninput size, generation timestamp]
    end
    G8 --> Show
```

```mermaid
sequenceDiagram
    participant Client
    participant Server as Server (brief module)
    participant Deterministic as Deterministic sources\n(intent, blast, diff stats, findings, context docs)
    participant LLM as LLM provider

    Client->>Server: POST /pulls/:id/brief (Regenerate)
    Server->>Deterministic: gather bounded facts (zero LLM calls)
    Deterministic-->>Server: intent, blast summary, diff stats,\nfindings, context excerpts
    Server->>LLM: ONE structured call (bounded input, target <= 8K tokens)
    LLM-->>Server: what, why, risk_level, risks[], review_focus[]
    Server->>Server: validate every file/endpoint/symbol reference\nagainst deterministic facts; drop/repair unresolved ones
    Server->>Server: merge into pr_brief (additive), persist, log
    Server-->>Client: full pr_brief (existing fields + new fields)

    Client->>Server: GET /pulls/:id/brief (page open)
    Server-->>Client: cached pr_brief — zero LLM calls
```

## 5. Screenshot-Derived UX Requirements

Two authoritative design screenshots (empty state and fully populated state) define the layout. They supersede any assumption that this feature introduces a new standalone card in the existing Overview card grid: **the existing PR BRIEF (VerdictBanner), INTENT, and BLAST RADIUS cards keep their identity and position — only their content is enhanced — and exactly ONE new full-width section is added below them.**

**State 1 — empty (no brief generated yet):** the Overview tab shows only a "PR BRIEF" eyebrow label and one large centered empty-state card: a document icon, bold "No brief yet," a muted explanatory line, and a primary "Generate brief" action. No Intent/Blast Radius/Review Focus content is implied to be missing by this state — it describes specifically the not-yet-generated LLM part.

**State 2 — populated, top to bottom:**
1. Eyebrow "PR BRIEF."
2. **PR BRIEF card (top, full-width) — the existing VerdictBanner, enhanced, not replaced.** Left side keeps its existing verdict icon/label and findings/blockers pill (unchanged, deterministic, sourced from the latest review). The body paragraph is enhanced to carry the new `what` + `why` narrative as prose (e.g. summarizing the change and its main risk in 1-2 sentences). The right side of this same card gains three new affordances: a Regenerate icon (↻) action; a circular **"PR SCORE" gauge** showing a numeric score inside a color-coded ring (reusing existing color tokens — green/amber/red — never a new palette) — this gauge IS how `risk_level` is visualized; and an inline provenance line "$`<cost>` `<in>`K+`<out>`K" showing generation cost and input+output token counts (e.g. "$0.014 8.2K+1.3K"), satisfying the cost-logging and bounded-input observability requirement directly in the UI — the shown input-token count is what makes the ≤8K soft budget (§9) user-verifiable.
3. **Second row — the existing two-column grid, unchanged position, enhanced content:**
   - Left: the existing INTENT card — quote, IN SCOPE / OUT OF SCOPE (unchanged), plus its existing RISK AREAS section. RISK AREAS is the render surface for `risks[]`: each entry is enhanced from a plain non-clickable chip into an icon + bold title + a clickable monospace `path:line` reference + an expand chevron, backed by real file/endpoint/symbol grounding (§10).
   - Right: the existing BLAST RADIUS card — unchanged; still deterministic, still Tree/Graph toggle, still sourced from `GET /pulls/:id/blast`. Not part of this feature's new content.
4. **New bottom, full-width card — "REVIEW FOCUS — READ THESE FIRST" (with an entry-count badge).** This is the ONLY genuinely new UI surface introduced by this feature. It renders `review_focus[]` as an ordered list, each row a clickable monospace `path:line` reference, an em-dash, and a short one-line reason, ordered by deterministic priority (most important to read first at the top) — never alphabetically.

- Risk-level coloring (the gauge ring) and all risk/review-focus severity coloring SHALL reuse existing color tokens already used elsewhere in the product (the existing verdict/severity palette) — no new color palette is introduced.
- `[NEEDS CLARIFICATION]` — the exact click-navigation target for a `path:line` reference (GitHub blob URL, an internal Files-changed anchor, or both) is not fully resolved by code inspection; see §17.

## 6. UX Requirements

- **Empty state:** WHERE no LLM-generated brief content exists yet for a PR, the PR BRIEF card slot SHALL render the "No brief yet → Generate brief" empty state described in §5 State 1 — never a blank or missing card. This does not affect the INTENT or BLAST RADIUS cards, which render independently from their own existing data as they do today.
- **Loading state:** WHILE a generation is in progress, the PR BRIEF card SHALL show a non-blocking in-progress indicator; if a previously generated brief exists, its content SHALL remain visible until the new one is ready.
- **Cached state:** WHEN a generated brief exists, the system SHALL render the risk-level gauge, the `what`/`why` narrative, the enhanced RISK AREAS entries, and the Review Focus section immediately from the cached/persisted record on page open.
- **Error state:** IF generation fails and a previously generated brief already exists, THEN the PR BRIEF card SHALL keep showing the last good generated narrative/gauge plus an inline error and a retry action, rather than clearing it.
- **Error state, no prior brief:** IF generation fails and no brief was ever generated, THEN the PR BRIEF card SHALL show the empty state with an inline error and a retry action.
- **Regenerate action:** the PR BRIEF card SHALL expose an explicit Regenerate icon action once a brief already exists, distinct from the initial "Generate brief" action shown only in the empty state.
- The "PR SCORE" gauge SHALL be visually prominent (numeric value inside a color-coded ring), not just plain text.
- Every RISK AREAS entry and every "REVIEW FOCUS — READ THESE FIRST" row that carries a resolvable file/endpoint/symbol reference SHALL render that reference as a clickable navigation target (§7 Link Validation).
- "REVIEW FOCUS — READ THESE FIRST" rows SHALL render in priority order (ascending priority number = read first), each with a one-line reason, and the card SHALL show an entry-count badge.
- The PR BRIEF card's provenance line SHALL display the generation's cost and an input/output token estimate inline (format: cost + input-tokens + output-tokens), satisfying §12's observability requirement in the UI itself, not only in logs.

### Field → UI mapping

| Field | UI surface |
|---|---|
| `what`, `why` | PR BRIEF card narrative body (the enhanced verdict paragraph) |
| `risk_level` | PR BRIEF card's circular "PR SCORE" gauge (numeric value + existing color-coded ring) |
| `risks[]` (enhanced with file/line/endpoint/symbol/`github_link`) | RISK AREAS entries inside the existing INTENT card |
| `review_focus[]` | New bottom full-width "REVIEW FOCUS — READ THESE FIRST" card |
| Regenerate action | Refresh (↻) icon action on the PR BRIEF card |
| Cost / input+output token count (provenance) | Inline "$cost {in}K+{out}K" line on the PR BRIEF card |

## 7. API Requirements

- `GET /pulls/:id/brief` (existing, L04) SHALL continue to return the full `pr_brief` record unchanged in shape — backwards compatible — now additionally including the new fields when they have been generated (null/absent-equivalent when not yet generated).
- A new `POST /pulls/:id/brief` endpoint SHALL trigger explicit generate/regenerate of the LLM-derived part of the brief: it SHALL gather the bounded deterministic inputs (§9), make exactly one structured LLM call, deterministically validate every resulting file/endpoint/symbol reference (§10), merge the result into the existing `pr_brief` record additively, persist it, and return the full updated record.
- Both endpoints SHALL be workspace-scoped through the same PR → repository → workspace ownership chain already enforced by the existing `GET /pulls/:id/brief` and `GET /pulls/:id/blast` routes — a cross-workspace request SHALL behave as not-found, never as a data leak.
- `POST /pulls/:id/brief` SHALL be rate-limited to prevent repeated accidental fan-out of paid LLM calls from rapid Regenerate clicks (exact limit is an implementation-planner decision, consistent with existing per-route rate-limit conventions in this codebase).
- The deterministic auto-composition that already runs after every successful review run (intent/blast/history/findings-derived risks) SHALL continue to run unchanged, at zero LLM calls, and SHALL NOT be gated behind or replaced by the new endpoint.

## 8. Input Provenance

| Input | Provenance |
|---|---|
| PR intent (`intent`, `in_scope`, `out_of_scope`) | [reused: L03/L04] — already stored in `pr_intent` / composed into `pr_brief.intent` |
| Blast radius summary (changed symbols, downstream callers, endpoint/cron attribution) | [reused: L04] — `container.blast.getBlast()` |
| Diff statistics grouped by file/category (additions/deletions, core/wiring/boilerplate grouping, per-file pseudocode summary) | [reused: L03] — Smart Diff facts |
| Changed file paths and source locations | [reused: L03/L04] — diff loader + blast index |
| PR title and body | [reused: existing PR record] |
| Existing findings (CRITICAL/WARNING) from the latest review, if any | [reused: L01] |
| Prior-PR history (files overlap with earlier merged PRs) | [reused: L04] — `pr_brief.history` |
| Relevant Project Context specs (bounded, attributed excerpts) | [reused: Project Context / Context Folder module] |
| Linked issue context | `[NEEDS CLARIFICATION]` — see §14 |
| GitHub blob link components (owner/name/head sha) | [reused: L04] — same `BlastLink` pattern already used by Blast Radius |
| `what`, `why`, `risk_level`, `risks[]` enrichment (file/endpoint/symbol/github_link on each risk), `review_focus[]` | [new: 1 LLM call] — justification: turning the above deterministic, already-computed facts into a plain-language "why," an overall risk judgment, and a prioritized reading order requires synthesis and judgment across heterogeneous signals (intent text, blast graph, diff shape, findings) that no deterministic rule set in this codebase currently produces; deterministic composition (existing `brief-composer.ts`) already covers everything that does NOT require this judgment. Bounded to exactly one call per generation. |

## 9. LLM and Bounded-Input Invariants

- One generation (the `POST /pulls/:id/brief` call) MUST make exactly one structured LLM call.
- Gathering every deterministic input in §8 MUST make zero LLM calls.
- The assembled LLM input MUST be bounded and SHALL target a maximum of 8,000 input tokens (or an equivalent byte/char budget agreed at planning time) as a soft target/practical cap — not necessarily a hard reject threshold — consistent with the existing per-model diff-budgeting pattern already used in `run-executor.ts`; the implementation plan MUST define the exact cap/truncation strategy (e.g. which facts are dropped first when over budget) and MUST decide whether an over-budget input is truncated or rejected.
- The actual input token count (and output token count) for the most recent generation SHALL be surfaced to the user inline on the PR BRIEF card's provenance line (§5, §6), not only recorded in logs — this is the user-facing verification surface for the bounded-input invariant.
- Allowed in the LLM input: file paths, line numbers, diff stats, changed-file summaries (including existing per-file pseudocode summaries), PR title/body, intent, blast summary, endpoint names, symbol names, linked-issue summary (when available), bounded and attributed Project Context spec excerpts, existing finding summaries.
- Disallowed in the LLM input: full file contents, full raw diff, the entire repository tree, secrets/credentials, unbounded README/spec/context dumps.
- Any repository-authored text included in the input (PR body, README/spec excerpts, linked-issue text) MUST be treated as data to summarize, never as instructions (§13 Untrusted Inputs).

## 10. Link Validation / Real-File Grounding Requirements

- After the LLM response is received, every risk's file/endpoint/symbol reference and every review-focus entry's path SHALL be deterministically checked against the PR's real changed files, the blast index's known files/endpoints/symbols, or another known repository path already available from the gathered facts.
- IF a reference resolves to a real location, THEN the system SHALL attach a `github_link` built from the repository's owner/name/head-sha and the resolved path/line — reusing the existing `BlastLink`/`githubBlobUrl` convention.
- IF a reference does NOT resolve to any known real location, THEN the system SHALL either drop the reference or repair it to the nearest known valid location per an implementation-defined rule — it SHALL NEVER render a broken or placeholder link.
- This validation step itself MUST make zero additional LLM calls — it is a deterministic post-processing step over the already-gathered facts.

## 11. Persistence and Cache Requirements

- The new fields (`what`, `why`, `risk_level`, enriched `risks[]`, `review_focus[]`) SHALL be added additively to the existing per-PR `pr_brief` record — the same conceptual object and storage location already used for `intent`/`blast`/`risks`/`history` — never a new parallel per-PR brief object, and never by altering any existing stored column in place.
- The existing deterministic fields (`intent`, `blast`, `history`, and the findings-derived `risks`) SHALL keep being written by the existing zero-LLM auto-composer after every successful review run, exactly as today.
- The new LLM-derived fields SHALL be written only by the new explicit generate/regenerate action — the auto-composer SHALL NOT overwrite the LLM-derived fields, and the generate/regenerate action SHALL NOT overwrite the deterministic fields it did not itself recompute (each side owns and updates only its own fields).
- Reopening a PR whose brief already has generated `what`/`why`/`risk_level`/`review_focus` content SHALL render that cached content and SHALL NOT trigger a new LLM call.
- "Regenerate" SHALL overwrite only the LLM-derived fields with fresh content and a fresh generation timestamp — v1 keeps no history of prior generations (see Stretch).
- The persisted record SHALL include a generation timestamp for the LLM-derived part, and MAY include model/cost metadata if that is already this codebase's convention for LLM-backed features (it is — see the Onboarding Generator's `llm_cost_cents` precedent).
- IF a generation attempt fails and a previously generated brief already exists, THEN the system SHALL keep the last good generated content and surface an inline retryable error, never clearing already-persisted content.

## 12. Logging / Observability

- WHEN a generation completes, the system SHALL log exactly one LLM call attributed to that generation, its cost (when available from the provider), and an estimate of the input size (token or byte count), so that input-budget compliance (§9) is independently verifiable from the logs.
- WHEN a generation runs, the system SHALL log the outcome of the link-validation step (§10) — e.g. how many references were kept vs. dropped/repaired — so operators can detect a degraded grounding rate over time.
- The system SHALL NEVER log secrets, credentials, or full repository/diff content — only bounded summaries and metadata, consistent with existing logging conventions in `run-executor.ts` and `onboarding/service.ts`.

## 13. Untrusted Inputs

This feature reads several sources of text authored outside the system as part of its bounded LLM input: the PR title and body (author-controlled), existing finding rationale text (LLM-generated in a prior review run, but still external to this generation), bounded Project Context spec excerpts (repository-authored), and — if resolved — linked-issue text (author-controlled). All of these SHALL be treated strictly as data to summarize and reference, never as instructions to follow, consistent with the existing `wrapUntrusted`/system-prompt convention already used for PR bodies and Project Context documents in the review pipeline. The LLM's structured output SHALL be treated as untrusted content requiring the deterministic validation in §10 before any of it is rendered as a clickable link.

## 14. Delivery / Process Requirements (SDD Pipeline)

- This spec (`docs/feature-requirements/2026-07-03-pr-why-risk-brief.md`) SHALL be committed before any implementation plan or feature code exists for this feature.
- An implementation-planner-produced Development Plan SHALL exist and be committed before feature code is written, and SHALL explicitly address: the additive storage shape for the new `pr_brief` fields (new JSONB keys vs. new columns — no existing applied migration/column is to be altered), the exact input-budget/truncation strategy (§9), and the reference-validation/repair rule (§10).
- The Development Plan SHALL undergo cross-model review (a different model family than the implementer, in a staff-engineer reviewing capacity) before implementation begins.
- Implementation SHALL be gated by both an architecture-reviewer pass and a plan-verifier pass confirming every acceptance criterion in this spec (§15) is implemented, before merge.
- Any Project Context specs used as bounded input (§8) SHALL be attached and surfaced to the generation the same way they are already attached to reviewer agents via the Context Folder mechanism — not through a separate ad hoc selection path.
- A workflow-retro after delivery is optional, at the team's discretion.

## 15. Acceptance Criteria (EARS)

- **AC-1** (Event-driven): WHEN the user opens a PR whose `pr_brief` already has generated `what`/`why`/`risk_level`/`review_focus` content, the system SHALL render the cached brief ("PR SCORE" gauge, narrative, enhanced RISK AREAS, "REVIEW FOCUS — READ THESE FIRST" card) without making a new LLM call.
- **AC-2** (Event-driven): WHEN the user activates "Generate brief" (empty state) or the Regenerate (↻) icon action (PR BRIEF card), the system SHALL gather the bounded deterministic inputs (§8) and make exactly one structured LLM call.
- **AC-3** (Ubiquitous): The system SHALL perform all deterministic input gathering for brief generation with zero LLM calls.
- **AC-4** (Ubiquitous): One brief generation SHALL make exactly one structured LLM call — never zero and never more than one.
- **AC-5** (Unwanted behavior): IF the assembled LLM input would exceed the agreed input-token/byte budget (target 8,000 tokens), THEN the system SHALL apply the implementation-defined truncation strategy before sending the request, rather than sending an unbounded input.
- **AC-6** (Unwanted behavior): IF the LLM response references a file, endpoint, or symbol that does not resolve to a real changed file, blast-index entry, or known repository path, THEN the system SHALL drop or repair that reference and SHALL NOT render a broken or placeholder link.
- **AC-7** (Event-driven): WHEN a risk or review-focus entry's reference resolves to a real location, the system SHALL attach a working GitHub blob link (or equivalent internal navigation target) built from the repository's owner/name/head-sha and the resolved path/line.
- **AC-8** (Event-driven): WHEN the user clicks a review-focus entry with a resolved reference, the system SHALL navigate to the corresponding file or diff location.
- **AC-9** (Event-driven): WHEN a generation completes, the system SHALL merge only the LLM-derived fields (`what`, `why`, `risk_level`, `review_focus`, and the enrichment fields on `risks[]`) into the existing `pr_brief` record, leaving the deterministic fields (`intent`, `blast`, `history`, findings-derived `risks` base data) exactly as last written by the auto-composer.
- **AC-10** (Unwanted behavior): IF the zero-LLM auto-composer runs after a review (as it already does today), THEN it SHALL NOT overwrite any LLM-derived field (`what`, `why`, `risk_level`, `review_focus`, or the enrichment fields on `risks[]`) that a prior generation already wrote.
- **AC-11** (Event-driven): WHEN a generation completes, the system SHALL persist the result with a fresh generation timestamp for the LLM-derived part and SHALL log exactly one LLM call, its cost when available, and an estimate of the input size.
- **AC-12** (Unwanted behavior): IF a generation attempt fails and a previously generated brief exists, THEN the PR BRIEF card SHALL continue showing the last good generated narrative/gauge plus an inline retryable error, rather than clearing it.
- **AC-13** (Unwanted behavior): IF a generation attempt fails and no brief was ever generated for that PR, THEN the PR BRIEF card SHALL show the empty state plus an inline retryable error.
- **AC-14** (Event-driven): WHEN neither a generated brief nor an in-progress generation exists for a PR, the PR BRIEF card slot SHALL show the "No brief yet → Generate brief" empty state — never a blank card, and never by hiding or altering the INTENT or BLAST RADIUS cards.
- **AC-15** (Ubiquitous): The PR BRIEF, INTENT, and BLAST RADIUS card content sourced from `pr_brief`, and both `pr_brief` endpoints, SHALL be workspace-scoped through the same PR → repository → workspace ownership chain as the existing `pr_brief`/blast endpoints — a cross-workspace request SHALL behave as not-found.
- **AC-16** (Unwanted behavior): IF `POST /pulls/:id/brief` is invoked repeatedly in rapid succession, THEN the system SHALL rate-limit it rather than issuing multiple paid LLM calls per click-burst.
- **AC-17** (Ubiquitous): `GET /pulls/:id/brief` SHALL remain backwards compatible — every field already returned before this feature SHALL continue to be returned in the same shape.
- **AC-18** (Ubiquitous): PR title/body, finding rationale text, Project Context excerpts, and linked-issue text (when available) included in the LLM input SHALL be treated strictly as data to summarize, never as instructions.
- **AC-19** (Ubiquitous): The system SHALL NOT add a new standalone card to the Overview card grid for this feature; it SHALL enhance the existing PR BRIEF, INTENT, and BLAST RADIUS cards in place, and SHALL add exactly one new "REVIEW FOCUS — READ THESE FIRST" section below them.
- **AC-20** (Event-driven): WHEN a brief is generated (or rendered from cache), the system SHALL render `risk_level` as the PR BRIEF card's "PR SCORE" gauge, `what`/`why` as the PR BRIEF card's narrative, `risks[]` as the INTENT card's RISK AREAS entries, and `review_focus[]` as the "REVIEW FOCUS — READ THESE FIRST" card — per the field-to-UI mapping in §6.
- **AC-21** (Ubiquitous): The system SHALL surface the generation's cost and an input-token estimate inline on the PR BRIEF card as user-visible provenance, in addition to the logged form required by §12.

## 16. Edge Cases

| Case | Expected behavior | Covered by |
|---|---|---|
| PR has no prior review / no findings yet | Generation proceeds using intent, blast, and diff stats only; `risks[]` may be empty or based solely on blast/diff signals | AC-2, AC-3 |
| LLM references a file that was renamed/deleted since the diff was computed | Reference dropped/repaired, no broken link rendered | AC-6, AC-7 |
| Reopening a PR with a cached brief | Cached content shown, zero new LLM calls | AC-1 |
| Rapid repeated "Regenerate" clicks | Rate-limited, not fanned out | AC-16 |
| Generation fails after a good brief already exists | Last good brief stays visible + inline retry | AC-12 |
| Generation fails, brief never generated before | Empty state + inline retry | AC-13 |
| Deterministic auto-composer runs (new review) after a brief was already generated | LLM-derived fields untouched; only intent/blast/history/findings-derived risks refresh | AC-9, AC-10 |
| Assembled input exceeds the token/byte budget | Implementation-defined truncation applied before the LLM call | AC-5 |
| No linked issue resolvable for the PR | `why` is derived from PR title/body/intent alone; no broken issue reference rendered | AC-6, `[NEEDS CLARIFICATION]` (§17) |
| Cross-workspace request for a PR's brief | Behaves as not-found | AC-15 |
| A brief is generated for a PR that has no prior review/findings and no blast data | PR BRIEF, INTENT, and BLAST RADIUS cards still render in their existing positions (degraded/empty per their own existing rules); no separate new card is substituted for a missing one | AC-19 |

## 17. [NEEDS CLARIFICATION]

- **Linked issue source:** code inspection found no existing stored or inferred linked-issue concept for a PR anywhere in the server (`pulls`/`reviews` modules) — only a doc comment mentioning "linked issue" as a described field of the full PR detail response, with no corresponding implementation found. Until confirmed, `why` generation SHALL fall back to PR title/body/intent alone when no linked-issue source exists; if a linked-issue source is later confirmed (e.g. parsed from PR body "Closes #123" or a GitHub API field), it becomes an additive input, not a redesign.
- **Context Folder selection/bounding rule:** the Project Context / Context Folder module (`context-docs`) can list documents and resolve per-agent/per-skill attachments, but this spec does not have a confirmed rule for which Context Folder documents are relevant to a specific PR's Why + Risk Brief generation (e.g. same attachment mechanism as reviewer agents, or a different automatic relevance selection). The implementation plan MUST define this selection rule; it does not change this spec's product behavior (§8, §14 already require it go through the existing Context Folder mechanism).
- **Exact visual treatment of individual risk/review-focus rows** (chip vs. row vs. accordion) — no separate design-digest image was provided to this agent beyond the prose description in the request; implementer should extend the existing `IntentCard` risk-chip visual grammar (§5) rather than invent a new component style. Non-blocking.
- **Exact additive-migration shape** for the new `pr_brief` fields (new JSONB keys within the existing `json` column vs. new dedicated columns on the `pr_brief` table) — a planning-time decision per the repo's schema rules (additive migrations only, no existing applied migration/column altered in place); both are compatible with this spec's requirements, so this is explicitly deferred to the implementation-planner (§14).
