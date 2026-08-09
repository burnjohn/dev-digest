# React + Next.js Architecture Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a repo-scoped skill that guides React and Next.js App Router architecture decisions without turning performance advice or unsupported heuristics into correctness rules.

**Architecture:** Keep `SKILL.md` as a concise trigger and routing layer. Put detailed placement, React ownership, App Router, server/data, review, and source guidance in one-level `references/` files. Preserve the complete research ledger in `docs/research/react-frontend-best-practices-sources.md` and include a skill-local source index for provenance.

**Tech Stack:** Agent Skills specification, Markdown, YAML, React 19, Next.js 15 App Router, official `skill-creator` validation scripts.

## Global Constraints

- Create the skill at `.claude/skills/react-next-architecture`; `.agents/skills` already points to `.claude/skills`.
- Target the repository's resolved `next@15.5.19` and `react@19.2.7`; mark Next.js 16+ behavior explicitly.
- Keep performance optimization outside active skill scope; retain its sources only in the canonical research ledger.
- Do not encode numeric component-size, prop-count, branch-count, or “reuse twice” thresholds as rules.
- Do not add a README inside the skill.
- Do not modify vendored UI/shared contracts or application code.
- Do not commit or push unless the user asks.

## RED Baseline Evidence

Three fresh-context scenarios were run without the new skill:

- The structure scenario proposed sound route/feature colocation but then introduced “roughly 40–60 JSX lines or three or more distinct conditional branches,” contradicting its own warning against arbitrary size rules.
- The same scenario promoted UI to shared after use in two features, without requiring a stable business-neutral contract, and proposed `domain/`, `features/`, `components/`, and `lib/` without a clear dependency direction or public API rule.
- The data-flow and RSC scenarios correctly chose direct Server Component → application/DAL reads, thin Server Actions, public Route Handlers, client-owned SSE, `server-only`, deep providers, and the React 19 serialization contract. The skill should preserve these decisions concisely instead of adding redundant prose.

## GREEN Evidence

- The structure scenario rejected line/prop/branch/reuse-count thresholds, kept route-private and feature-owned code colocated, promoted only stable business-neutral contracts, and produced an enforceable `app → features → entities → shared` import graph.
- Its first run exposed an ambiguous arrow in the reference even though the prose was correct. The reference was clarified as import direction and a fresh retry produced a consistent graph.
- The data-flow scenario selected direct Server Component reads, thin Server Actions for UI mutations, Route Handlers for webhooks/SSE, server-only DAL/DTO boundaries, independent authorization, and invalidation after the successful commit.
- The RSC scenario produced an incremental server-page/client-leaf migration, deep provider placement, transitive client-module rules, and the React 19 serialization contract for `Date`, `Map`, `Set`, typed arrays, class instances, and ordinary callbacks.

### Task 1: Initialize the skill skeleton

**Files:**

- Create: `.claude/skills/react-next-architecture/SKILL.md`
- Create: `.claude/skills/react-next-architecture/agents/openai.yaml`
- Create: `.claude/skills/react-next-architecture/references/`

- [x] Run `init_skill.py react-next-architecture --path .claude/skills --resources references` with UI metadata.
- [x] Confirm the scaffold contains only `SKILL.md`, `agents/openai.yaml`, and `references/`.
- [x] Confirm the generated frontmatter name matches the directory.

### Task 2: Write focused architecture references

**Files:**

- Create: `.claude/skills/react-next-architecture/references/placement-and-boundaries.md`
- Create: `.claude/skills/react-next-architecture/references/components-and-state.md`
- Create: `.claude/skills/react-next-architecture/references/next-app-router.md`
- Create: `.claude/skills/react-next-architecture/references/server-client-and-data.md`
- Create: `.claude/skills/react-next-architecture/references/review-checklist.md`
- Create: `.claude/skills/react-next-architecture/references/source-catalog.md`

- [x] Write the feature-first colocation/promotion model and dependency direction.
- [x] Define placement for route-private UI, feature UI/model/API, shared UI/lib, constants, helpers, schemas, and server-only modules.
- [x] Define responsibility-based component splitting and explicitly reject magic-number limits.
- [x] Define state ownership, pure domain logic, hooks, Effects, reducers, context, URL state, and client streams.
- [x] Define App Router route/composition ownership, special-file semantics, and Next.js 15/16 naming/API differences.
- [x] Define the Server/Client module graph, React 19 serialization, DAL/DTO, Server Action/Route Handler selection, authorization, and cache invalidation ownership.
- [x] Add an architecture review checklist with finding severity based on correctness and boundary risk, not style preference.
- [x] Copy the architecture source IDs and exact URLs from the canonical research ledger; link back to the full ledger for archived sources.

### Task 3: Write the routing skill and register it

**Files:**

- Modify: `.claude/skills/react-next-architecture/SKILL.md`
- Modify: `.claude/skills/react-next-architecture/agents/openai.yaml`
- Modify: `.claude/skills/README.md`

- [x] Write trigger-only frontmatter beginning with “Use when” and covering React/Next architecture, component placement, App Router, RSC, DAL, Server Actions, Route Handlers, and refactors/reviews.
- [x] Keep `SKILL.md` under 500 words and route each observable task type to the minimum required reference files.
- [x] Add a short mandatory workflow: inspect versions/conventions, classify ownership, inspect runtime/data boundaries, then implement or review.
- [x] Add the skill to the repository catalog without creating a skill-local README.
- [x] Regenerate `agents/openai.yaml` after the final `SKILL.md` wording.

### Task 4: Validate and GREEN-test the skill

**Files:**

- Modify if needed: `.claude/skills/react-next-architecture/**`

- [x] Run `quick_validate.py` on the skill directory.
- [x] Check frontmatter fields, description length, SKILL word count, reference links, source IDs, URL syntax, balanced fences, and placeholder absence.
- [x] Rerun the three baseline scenarios with the new skill in fresh contexts.
- [x] Verify the structure response rejects magic-number thresholds and uses colocation plus stable-contract promotion.
- [x] Verify the data response uses direct server reads, DAL/DTO, thin Server Actions, public Route Handlers, independent authorization, and explicit invalidation ownership.
- [x] Verify the RSC response treats `'use client'` as a transitive module boundary and uses the React 19 serialization contract rather than JSON-only folklore.
- [x] Tighten reference routing or wording for any missed requirement, then rerun validation.

### Task 5: Final repository verification

**Files:**

- Verify: `.claude/skills/react-next-architecture/**`
- Verify: `.claude/skills/README.md`
- Verify: `docs/research/react-frontend-best-practices-sources.md`
- Verify: `client/INSIGHTS.md`

- [x] Run `git diff --check`.
- [x] Confirm `.agents/skills/react-next-architecture` resolves through the shared symlink.
- [x] Run the engineering-insights status/check workflow and capture only genuinely new findings.
- [x] Report created files, RED/GREEN evidence, validation output, and uncommitted worktree state.
