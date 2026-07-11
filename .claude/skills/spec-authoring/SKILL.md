---
name: spec-authoring
description: >-
  Requirements-engineering craft for Spec-Driven Development — how to turn a vague
  request into testable acceptance criteria. Use when authoring or reviewing a feature spec
  (SPEC-NN): writing EARS acceptance criteria, INVEST-shaped user stories, an edge-case
  checklist, and a non-functional taxonomy. This is the single source of truth for EARS in
  this repo — spec-creator and specs/TEMPLATE.md reference it by name instead of inlining it.
  Covers the "what/why", not the "how" (no implementation, no task breakdown).
---

# spec-authoring — writing testable specs

A spec captures **what** a feature must do and **why**, as statements a tester could turn
into pass/fail checks — *before* it is planned or implemented. This skill is the craft;
the DevDigest-specific rules (provenance tags, untrusted-input handling, `specs/` numbering,
frontmatter) live in the `spec-creator` agent and `specs/TEMPLATE.md`.

## Acceptance criteria — EARS

Every acceptance criterion is a **single testable statement** with an ID (`AC-1`, `AC-2`, …).
Use one of the five EARS patterns (Easy Approach to Requirements Syntax — Mavin, Rolls-Royce,
2009):

1. **Ubiquitous** (always true): "The system **shall** log every authentication attempt."
2. **Event-driven** — `WHEN <trigger>, the system **shall** <response>`: "**WHEN** a user
   submits the login form, the system **shall** validate credentials against the auth provider."
3. **State-driven** — `WHILE <state>, the system **shall** <response>`: "**WHILE** a sync is in
   progress, the system **shall** show a non-dismissible progress indicator."
4. **Unwanted behavior** — `IF <condition>, THEN the system **shall** <response>`: "**IF**
   credential validation fails three times within 60 seconds, **THEN** the system **shall**
   lock the account for 15 minutes."
5. **Optional feature** — `WHERE <feature is present>, the system **shall** <response>`:
   "**WHERE** MFA is enabled, the system **shall** require a TOTP code after the password."

The patterns are the easy part; the skill is translating a **vague** requirement into an
unambiguous trigger + response. Do that translation explicitly:

| Vague requirement | EARS criterion |
| --- | --- |
| "Should work fine on big repos" | **WHEN** a repository exceeds the indexing threshold, the system **shall** generate the overview from deterministic facts only, without reading full files |
| "Shouldn't crash if the model is down" | **IF** the structured model call fails, **THEN** the system **shall** render a deterministic review skeleton with the reason, instead of an error |
| "Should hint where to start reading" | The system **shall** order the reading path by file rank from the import graph, not alphabetically or by date |

**The test.** A criterion a tester could not turn into a pass/fail check is not done —
rewrite it until they could. Prefer measurable thresholds ("within 2 s", "≤ 500 findings")
over adjectives ("fast", "reasonable").

**Close the loop.** Every `AC-N` is a promise that something is testable — so each should be
traceable to the test that proves it. The spec need not name the test file, but it must be
written so that a downstream verifier can map `AC-N` → a concrete test one-to-one.

## User stories — INVEST

Write user stories as `As a <role>, I want <capability>, so that <outcome>.` Keep each one
**INVEST**: Independent, Negotiable, Valuable (the "so that" is real user value, not a
restatement of the capability), Estimable, Small, and **Testable** (it maps to at least one
`AC-N`). A story with no acceptance criterion, or an `AC-N` owned by no story, is a gap.

## Edge-case checklist

Walk this list for every feature and record the ones that apply as `Edge case` items or, if
they block writing, as clarifying questions:

- **Inputs:** empty, oversized, malformed, duplicate, out-of-order, wrong-encoding.
- **Concurrency:** two writers, race on shared state, idempotency of retried operations.
- **Failure:** partial failure, downstream timeout, retry/backoff, poison input.
- **Scale/limits:** pagination, truncation, rate limits, quota exhaustion.
- **Auth/permission:** unauthenticated, under-privileged, boundary between tenants/users.
- **Lifecycle:** first-run/empty state, deletion, migration of existing data.

## Non-functional taxonomy

Specify a non-functional only when it is a real constraint, and make it measurable:

- **Performance** — latency/throughput budget, payload size, cold-start.
- **Security** — trust boundary, authz rule, secret handling (defer detail to the `security` skill).
- **Accessibility** — keyboard path, focus, contrast, screen-reader labels for UI features.
- **Observability** — what must be logged/measured to prove the AC in production.
- **Reliability** — degradation behavior when a dependency is down (often an `IF … THEN` AC).

## Boundary — what a spec is NOT

A spec defines *what* and *why* and its acceptance criteria. It **may** carry schemas,
workflows, cross-service contracts, and the shape crossing a boundary when they sharpen the
*what*. It **stops short** of implementation detail — which code to write, internal
algorithms, file-level structure, task breakdown. That is the plan's and the implementer's
job. If a statement describes *how* rather than *what*, it does not belong in the spec.
