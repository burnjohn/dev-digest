---
name: frontend-architecture
description: "Frontend code architecture and organization for React and Next.js — decides WHERE code lives and HOW it is structured. Use when deciding where to put a component/file, splitting a large component, choosing a folder structure (flat / type-based / feature-based), placing business logic, constants, utils, helpers, or custom hooks, naming files, or organizing a Next.js App Router app (route groups, private folders, server actions, lib). NOT for runtime performance (use vercel-react-best-practices), React anti-patterns/hooks rules (use react-best-practices), or Next.js RSC/data-fetching mechanics (use next-best-practices)."
version: "1.0.0"
---

# Frontend Architecture & Code Organization

Decide **where code lives** and **how it is structured** in React / Next.js apps. This skill answers
"which file/folder does this belong in?" — not how to make it fast or which React API to call.

For provenance and full source links, see [README.md](README.md).

## When this skill applies (vs. neighbors)

| Question | Skill |
|----------|-------|
| Where does this component/hook/constant/util go? How do I split this file? | **this skill** |
| Is this hook usage / state pattern an anti-pattern? | `react-best-practices` |
| How do I make this render faster / cut bundle size? | `vercel-react-best-practices` |
| Server vs client component, data fetching, metadata, route handler mechanics | `next-best-practices` |

When a task mixes concerns, use them together — this skill decides placement, the others decide implementation.

## Core principles

1. **There is no single correct structure.** Scale it to project size: flat → type-based → feature-based. Don't spend more than a few minutes choosing up front; restructure once real code reveals the seams.
2. **Colocate by default.** Keep files used together stored together; promote code upward (to shared/global) only when a *second* consumer actually appears. Premature globalization is as costly as premature abstraction.
3. **One reason to change per unit.** A component, hook, or module should have a single responsibility. If you describe it with "and", or you must edit A to change B, split it.
4. **Layer by concern, not by habit.** UI rendering → component; React state/effects/data-fetching → hook; framework-agnostic rules → plain function; backend I/O → service. Only layer when real logic exists — don't wrap a trivial fetch in three files.
5. **Shallow over deep.** Cap nesting at ~3–4 levels. Prefer a longer component name over another folder. Use path aliases (`@/…`) instead of `../../../`.
6. **Be consistent, then enforce.** Naming and structure conventions matter less in their specifics than in being applied uniformly. Pick one, lint it.

## Decision framework

Apply in order when placing or restructuring code:

1. **Is it used by more than one feature/route?** No → colocate next to its only consumer. Yes → move to shared (`components/ui`, `lib`, `hooks`, `constants`) at the lowest common level.
2. **Is it routable (Next.js)?** Only `page`/`route`/`layout` files should be routes. Everything else colocated under `app/` goes in a private `_folder` or a non-route file.
3. **What kind of code is it?** Map to its layer (principle 4) before picking a folder.
4. **Is the file getting large (>~200 lines) or doing >1 thing?** Extract: constants → `*.constants.ts`, helpers → `*.utils.ts`, stateful logic → custom hook, sub-UI → child component.
5. **Could this folder grow past ~15–20 files?** Subdivide now (`components/ui` vs `components/form`, or switch to feature folders).

## Reference files — read the one that matches the task

- **Folder & file structure, colocation, naming, constants/utils/helpers placement** → [folder-structure.md](folder-structure.md)
- **Splitting components (SRP/composition), business-logic layering, extracting custom hooks** → [component-organization.md](component-organization.md)
- **Next.js App Router organization (route groups, private folders, `src/`, feature-driven, where `lib`/server actions live)** → [nextjs-organization.md](nextjs-organization.md)

Each reference file is self-contained and includes concrete examples. Load only the one relevant to the current task.
