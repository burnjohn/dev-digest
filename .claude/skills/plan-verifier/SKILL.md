---
name: plan-verifier
description: Verification methodology for Development Plans — how to parse plan requirements, gather codebase evidence, assign Done/Partial/Missing status, and format the verification report.
---

# Plan Verifier

## Purpose

This skill defines how to verify that each requirement in a plan document has a corresponding implementation in the codebase. It is about **completeness only** — not code quality, architecture correctness, or style.

## Input Format

A plan document (typically from `docs/plans/`) with these sections:
- Context
- Implementation Steps (bulleted list of concrete deliverables)
- Acceptance Criteria (measurable outcomes)
- Testing Plan (test file expectations)
- Out of Scope (explicit exclusions — skip these)

## Verification Process

Step-by-step:

1. Parse all bullet points from "Implementation Steps", "Acceptance Criteria", and "Testing Plan"
2. Number each requirement sequentially (R1, R2, …)
3. For each requirement, search the codebase for evidence (see evidence types table below)
4. Assign status: ✅ Done, ⚠️ Partial, or ❌ Missing
5. Record the file:line citation for each piece of evidence found
6. Output the verification report (see report format below)

## Evidence Types

| Evidence type | How to find it |
|---|---|
| File existence | `Glob` for the expected file path |
| Function / type definition | `Grep` for the symbol name in source files |
| Route registration | `Grep` for the route path string in `routes.ts` files |
| Test file coverage | `Glob` for `*.test.ts` and `*.it.test.ts` in the module directory |
| AGENTS.md update | `Grep` for the feature name in the relevant AGENTS.md |
| DB migration applied | `Glob` for the migration file in `server/drizzle/` |
| Schema type exported | `Grep` for the type name in `server/src/vendor/shared/` |

## Status Definitions

- ✅ **Done** — verifiable evidence exists in the codebase (file exists, symbol found, test exists)
- ⚠️ **Partial** — some evidence found but requirement is incomplete (e.g., file exists but the specific function is missing; test file exists but doesn't cover the case)
- ❌ **Missing** — no evidence found after exhaustive search

## Report Format

```
## Verification Report: <Plan Name>

| # | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| R1 | <requirement text> | ✅ | `path/file.ts:42` | — |
| R2 | <requirement text> | ⚠️ | `path/file.ts:10` | Function exists but return type wrong |
| R3 | <requirement text> | ❌ | — | No file or symbol found |

**Summary:** N ✅ Done · M ⚠️ Partial · P ❌ Missing
```

## Scope Boundary (Critical)

This skill checks **completeness only**:
- ✅ Does the code exist?
- ❌ Does NOT judge: is the code good? is the architecture correct? is the style right?

Those are separate concerns (architecture-reviewer for structure, code review for quality). Never add architectural commentary or style suggestions to a verification report.

## Output Destination

The verification report goes to stdout (agent's response text). It is NEVER written to a file by this skill. The user decides whether to save it.
