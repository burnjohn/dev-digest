---
name: spec-authoring
description: How a prescriptive specification is written and read in this repo — the eleven-section template, the five EARS acceptance-criteria patterns, the three-way design partition, and the AC-n → REQ-n interlock with a plan. Use when writing a `<pkg>/specs/SPEC-NN-<slug>.md`, when validating requirements handed to you before planning, when turning a mockup into requirements, or when judging whether an acceptance criterion is falsifiable. Not for descriptive specs that document shipped behaviour.
---

# Spec authoring

A **prescriptive spec** states what should be built and what "done" means, before a plan and before
code. It lives at `<pkg>/specs/SPEC-NN-<feature-slug>.md` and carries a `Spec ID:` line — that line
is what distinguishes it from a *descriptive* spec (`<pkg>/specs/<feature>.md`), which documents
behaviour that already shipped and is `doc-writer`'s.

This skill is the canonical definition of the format. Two agents consume it from opposite ends:
`spec-creator` writes the file, and `implementation-planner` reads it to validate the requirements
it was handed and restate them as `REQ-n`.

## The interlock — why the format is shaped this way

```
spec-creator → SPEC-NN-<slug>.md  ──AC-n──→  implementation-planner → docs/plans/NN-slug.md
                                                                        │  **Spec:** <link>
                                                                        └─ REQ-n restates an AC
                                                                              ↓
                                                                         plan-verifier walks REQ
```

`plan-verifier` walks the plan's `REQ` list, never the spec's `AC` list. **An `AC` that no `REQ`
picked up is checked by nobody.** That is the whole reason a criterion has to survive being quoted
into a plan intact: it is copied across a boundary once, and never audited on its own side.

Consequences for whoever holds this skill:

- **Writing:** every `AC-n` is one sentence that reads correctly standing alone, out of the
  document, in someone else's file.
- **Planning:** the plan's header field `**Spec:**` names the spec file, and each `REQ-n` says which
  `AC-n` it restates. A spec `AC` with no `REQ` is a coverage gap to raise, not a detail to drop.

## The template — eleven sections

Header, then eleven `##` sections in this order, none omitted. A section with nothing in it says
`None.` **and says why** — an empty heading is indistinguishable from an overlooked one.

~~~markdown
# Spec: <Feature Name>
Spec ID: SPEC-NN
Status: draft
Supersedes: —

## Problem and user
## Goals / Non-goals
## User stories
## Acceptance criteria (EARS)
## Edge cases
## Module interactions
## Non-functional requirements
## Inputs and provenance
## Untrusted inputs
## Design review
## Open questions
~~~

| Section | What belongs in it | The failure mode it prevents |
|---|---|---|
| **Problem and user** | Who hits this, how often, and what they do today instead. Two paragraphs at most. | A feature nobody can name the victim of. |
| **Goals / Non-goals** | Non-goals are the load-bearing half — at least two, each one a thing a reasonable reader would otherwise assume is included. | Scope creep discovered at review time. |
| **User stories** | `As a <role>, I want <capability>, so that <outcome>.` Every story reaches at least one criterion, and every criterion traces back to a story. | Criteria that serve no user. |
| **Acceptance criteria (EARS)** | Numbered `AC-1..AC-n`, one EARS pattern each. See below. | Untestable prose. |
| **Edge cases** | Empty, one, many, too many. Concurrent, repeated, out-of-order. Expired, revoked, half-written. Each with the expected behaviour, not just the case. | The 3am bug. |
| **Module interactions** | Who calls whom, across which contract, and the behaviour on refusal, timeout and degradation. | A feature that works until the module it depends on says no. |
| **Non-functional requirements** | Latency, size limits, token budget, concurrency, accessibility — each with a number, or omitted. | "Should be fast." |
| **Inputs and provenance** | Every input, where it comes from, whether it is trusted. Name the contract when one exists. | Data whose origin nobody checked. |
| **Untrusted inputs** | The subset an attacker or a hostile repository controls, and what is done about it. | Injection through the content the product exists to read. |
| **Design review** | The three-way partition below, the gaps found, and only the improvements the owner accepted. | A mockup implemented literally, artefacts and all. |
| **Open questions** | What is undecided, who decides it, and what the spec assumes meanwhile. | Silent assumptions. |

`Status` has exactly one value, `draft`. There is no `approved` and no `implemented` — approval is a
conversation with the owner, not a field, and whether code satisfies the spec is a question for a
verification pass over the plan, not a word in a header.

## Acceptance criteria — the five EARS patterns

EARS (Easy Approach to Requirements Syntax) separates the **condition** from the **response**, so a
reader can tell exactly when a requirement applies and exactly what must then be true. Written in
English, with `shall` as the obligation marker.

| Pattern | Shape | Example |
|---|---|---|
| **Ubiquitous** | `The system shall <response>.` | The system shall log every authentication attempt. |
| **Event-driven** | `WHEN <trigger>, the system shall <response>.` | WHEN the user submits the sign-in form, the system shall validate the credentials. |
| **State-driven** | `WHILE <state>, the system shall <response>.` | WHILE a sync is running, the system shall display progress. |
| **Unwanted behaviour** | `IF <condition>, THEN the system shall <response>.` | IF validation fails three times within 60 seconds, THEN the system shall temporarily lock the account. |
| **Optional feature** | `WHERE <feature is enabled>, the system shall <response>.` | WHERE MFA is enabled, the system shall require a TOTP code after the password. |

### The test: name the observation that would prove it false

A criterion with no observable response is not a criterion. If you cannot state what a reader would
have to see to declare it broken, rewrite it or drop it.

| Vague | Checkable |
|---|---|
| "Should work fine on large repositories" | WHEN a repository exceeds the indexing threshold, the system shall build the overview from deterministic facts only, without reading every file in full. |
| "Should not crash if the model is unavailable" | IF a structured model call fails, THEN the system shall render a deterministic overview stating the reason for the degradation. |
| "Should hint where to start reading" | The system shall order the reading path by file rank in the import graph. |

Every `AC-n` names something observable — a status code, a rendered string, a stored row, an
ordering, a number. **"Correctly", "properly", "gracefully", "as expected" and "user-friendly" are
banned**: each one hides the criterion instead of stating it.

More worked pairs, including the ones that look checkable and are not: [examples.md](examples.md).

## The design partition

When a design exists — a mockup, a screenshot, a described screen, a live UI — transcribe it into
prose, then split it three ways:

1. **Where the design IS the spec** — binding: implement exactly this.
2. **Where the design is NOT the spec** — artistic licence, named *individually* so nobody
   implements it. Placeholder copy, invented data, a font nobody has, a state that cannot occur.
3. **What the design does not contradict** — left open, free for implementation to decide.

The middle bucket is the one that earns the convention. An unpartitioned mockup gets implemented
whole, lorem ipsum and all, because nothing told the implementer which pixels were decisions.

**A design that shows only the happy path is the normal case, not a defect.** Name the states it
omits — loading, empty, error, partial, too-many, offline — and specify them yourself; they are
usually the bulk of `## Edge cases`.

Provenance for this convention, and for EARS: [references.md](references.md).

## Numbering

`SPEC-NN` is a **single repo-wide counter** across `server/`, `client/`, `reviewer-core/` and
`mcp/`. **The filenames are the registry** — there is no index file. Glob `*/specs/SPEC-*.md`, take
the highest `NN`, add one, zero-pad. On an empty set the first spec is `SPEC-01`.

Because the registry is the filenames, allocation is a read-then-write race: two writers globbing at
the same moment both see the same highest number, both claim it, and the second write lands on the
first with no merge conflict to notice. **Allocate one at a time.** A number handed to you in a
dispatch prompt is authoritative — use it, do not re-derive it.

The two legacy specs — `server/specs/smart-diff.md` and `mcp/specs/mcp-server.md` — carry no
`Spec ID`, are descriptive, and are not part of the counter.
