---
name: frontend-architecture
description: "Frontend architecture for React/Next.js: project structure, feature organization, where code belongs, architectural patterns (FSD, Feature-Based, Clean Architecture). Use when deciding WHERE code lives and WHY — not how to write React or how to use Next.js APIs."
---

# Frontend Architecture

Answers **"where does this code belong and why?"** in React/Next.js projects.

**Does NOT answer:**
- "How to write React components or hooks" → use `react-best-practices`
- "How to use Next.js APIs (routing, caching, Server Actions)" → use `next-best-practices`
- "How to test components" → use `react-testing-library`

---

## Trigger — invoke BEFORE creating files or planning structure

Trigger when the prompt contains any of:

> architecture · project structure · folder structure · feature folder · feature-based · FSD · Feature-Sliced Design · Clean Architecture · layered · where to put · where does X live · where should this go · business logic placement · services layer · API layer · cross-feature · module boundary · barrel file · code organization · shared vs feature · promotion rule · how to organize · what goes in shared · file naming · folder naming · where do I put · how to structure

---

## SKIP when

- Writing a specific React component, hook, or state logic → `react-best-practices`
- Working with Next.js routing, caching, Server Actions, RSC boundaries → `next-best-practices`
- Writing or reviewing tests → `react-testing-library`
- Validating schemas → `zod`
- Fixing a rendering bug with no structural implications

---

## Core Rules (always apply — no file load needed)

**1. Unidirectional flow**
`shared → entities → features → widgets → pages → app`
Never import upward. Never import sideways between peers at the same level.

**2. Public API via `index.ts`**
Every feature/module exposes exactly one entry point: its `index.ts`.
Never import from a module's internal files directly.

**3. Promotion rule**
Code starts feature-scoped. When a second feature needs it → promote to `shared/`.
Do not pre-emptively put code in `shared/` — wait for the second consumer.

**4. Cross-feature communication via the app layer**
Features never import each other directly.
Composition of multiple features happens at `pages/` or `app/` level only.

**5. Business logic testability**
If you need React Testing Library to test a piece of logic, it's probably in the wrong layer.
Pure business logic belongs in `utils/` (pure functions) or `services/` (orchestration).

**6. Start simple — evolve deliberately**
Do not impose FSD on a small project. Architecture must match actual complexity, not anticipated scale.
Add structure when you experience real pain — not in anticipation of hypothetical growth.

---

## Loading Strategy

**Default — load both for any architecture question:**
- `architecture-patterns.md` — pattern selection, comparison, FSD structure
- `feature-organization.md` — feature internals, public API, cross-feature rules

**Load on demand by task:**

| Task | Load |
|---|---|
| "Show me a folder structure" / "How to organize this project" | `project-structure.md` |
| "Where does this logic go" / "Service vs hook vs util" | `business-logic-placement.md` |
| "FSD + Next.js" / "Where does Server Action live" / "src/ pattern" | `nextjs-integration.md` |
| "Is this architecture correct" / "Code review" / "Architecture smell" | `anti-patterns.md` |

---

## References

| File | Answers |
|---|---|
| [architecture-patterns.md](references/architecture-patterns.md) | Which pattern to choose, FSD layers, comparison matrix, enforcement tools, adoption path |
| [project-structure.md](references/project-structure.md) | Canonical folder trees per scale, naming conventions, path aliases, state file placement |
| [feature-organization.md](references/feature-organization.md) | Feature internals, public API, barrel files, cross-feature rules, promotion, state in features |
| [business-logic-placement.md](references/business-logic-placement.md) | 4-level model, services layer, API layer, dependency injection for testability |
| [nextjs-integration.md](references/nextjs-integration.md) | FSD + App Router integration, src/ pattern, Server Actions in FSD, thin routing wrappers |
| [anti-patterns.md](references/anti-patterns.md) | Architecture anti-patterns with symptom, cause, and fix |

---

## Related Skills

| Skill | Handles |
|---|---|
| `react-best-practices` | Component design, hooks rules, memoization, state library choice, React anti-patterns |
| `next-best-practices` | Next.js APIs, RSC boundaries, routing conventions, caching, Server Actions implementation |
| `react-testing-library` | Test strategy, RTL queries, integration testing patterns |
| `typescript-expert` | TypeScript type-level programming, generics, advanced patterns |
| `zod` | Schema definition and validation patterns |
