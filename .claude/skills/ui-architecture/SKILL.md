---
name: ui-architecture
description: "UI architecture and code organization for React/Next.js applications (also known as 'UI architecture / frontend architecture'). Covers WHERE code should live: component placement and splitting, feature-based vs type-based folder structure, colocation, where constants/utils/helpers/services/types belong, and where business logic should be extracted to. Includes Next.js App Router architectural boundaries — app/ as routing-only, src/features layout, route groups, private folders, the Data Access Layer pattern, and where Server Actions belong. Use whenever the user asks where a file/component/hook/constant should live, how to structure a new feature or folder, how to split up a large component, how to organize the app/ directory, or how to avoid a messy/inconsistent project structure — even if they don't use the word 'architecture'. This skill is about STRUCTURE AND ORGANIZATION only, not runtime correctness or performance: for React hook rules, memoization, and rendering anti-patterns use react-best-practices; for Next.js caching, RSC boundaries, and data-fetching performance use next-best-practices."
version: 0.1.0
---

# Frontend UI Architecture

Where code belongs in a React / Next.js codebase — components, hooks, constants, utils, services, types, and business logic. This skill answers **"where does X go?"**, not **"is X correct/fast?"**. For hook rules, memoization, and render anti-patterns, defer to `react-best-practices`. For Next.js caching, RSC boundaries, and data-fetching performance, defer to `next-best-practices`.

## Core Principle: Colocation First

Default to keeping everything one feature needs — components, hooks, services, types, constants, tests — **together**, in one feature folder. Only promote something to a shared/global location once at least two *unrelated* features need it. This single rule answers most "where does this go?" questions faster than any folder-naming taxonomy, and it's why `utils/`, `helpers/`, and `components/` folders tend to rot in older codebases: everything got dumped there "just in case" instead of living next to the one place that used it.

Two established methodologies formalize this instead of leaving it as a vibe — see [references/component-organization.md](references/component-organization.md) for the full comparison:
- **bulletproof-react** — `shared → features → app`, features are self-contained, imports flow one direction only.
- **Feature-Sliced Design (FSD)** — layers × slices × segments, with a linter that enforces the boundaries.

Pick whichever matches the team's appetite for formality; both agree on the same underlying rule above.

## Quick Decision Table

| Question | Answer |
|---|---|
| Where does a new component go? | Used by one feature → `features/<name>/components/`. Genuinely reusable UI primitive (Button, Modal, Card) → `components/ui/`. |
| Where does a hook with business logic go? | Colocated in the feature's `hooks/`. Promote to `shared/hooks/` only once 2+ unrelated features need it. |
| Where do constants go? | Local to one file/feature → colocated right next to it. Shared across features → `shared/constants/`, split by topic — never one giant `constants.ts`. |
| Where do types go? | Inline in the file → colocated `<name>.types.ts` in the feature → `shared/types/` only once used outside the feature. |
| Utils vs. services — what's the difference? | `utils/` = pure, stateless, no business rules (`formatDate`, `slugify`). `services/`/`api/` = business logic, API calls, DB/external integrations. Never mix the two in one file. |
| Where does business logic go? | Never in the component body. Into hooks (state/effects) or services (API calls, domain rules). Components stay presentational — props in, JSX out. |
| In Next.js, where does `app/` stop and "real" code start? | `app/` is routing only: `page`/`layout`/`loading`/`error`/`route`. Everything else lives in `src/features/<domain>/`. |
| In Next.js, who's allowed to touch the database? | Only the Data Access Layer (`lib/dal/` or `features/<domain>/dal/`). Server Components, Route Handlers, and Server Actions call the DAL — never the ORM directly. |

Full reasoning, code examples, and sources for each row: [references/component-organization.md](references/component-organization.md), [references/constants-utils-services.md](references/constants-utils-services.md), [references/types-organization.md](references/types-organization.md), [references/nextjs-app-router-architecture.md](references/nextjs-app-router-architecture.md).

## Component Organization

- Group by **feature/domain**, not by technical type — a `features/checkout/` folder beats parallel `components/`, `hooks/`, `services/` trees that force you to jump between five folders to change one thing.
- `components/` (or `components/ui/`) is reserved for components with **no feature-specific knowledge** — they could be copy-pasted into a totally different app and still make sense.
- Container/Presentational split as a mental model: a component either *fetches data and holds state* or *renders props* — rarely both. It doesn't require literal separate files for small components, but if a component is doing both and growing, that's the seam to split along.
- Prefer composition (`children`, compound components) over deep prop-drilling or one giant configurable component — see [references/component-organization.md](references/component-organization.md) for the compound-components pattern.
- Colocate a feature's tests and styles with its component, not in a parallel `__tests__/` or `styles/` tree at the project root.

## Constants, Utils, Services & Business Logic

- **Constants**: colocate by default; graduate to `shared/constants/<topic>.ts` only when reused across unrelated features. Never one catch-all `constants.ts` — split by what the constants describe.
- **Utils**: pure, generic, stateless functions with zero business rules. If a "util" needs to know what a "checkout" or a "subscription" is, it's not a util — it's business logic and belongs in a service or hook.
- **Services/API layer**: business logic, external calls, domain rules. This is where "what does our app do" logic lives — as opposed to utils, which is "how do I format/parse this."
- **Business logic never lives in the component body.** Extract it into custom hooks (stateful, feature-specific) or services (stateless, business-rule/API logic) so the component itself stays a thin, testable, presentational layer.

Full detail, the `utils` vs `helpers` vs `services` vs `lib` distinction, and why "utils" folders tend to become dumping grounds: [references/constants-utils-services.md](references/constants-utils-services.md).

## Types

- Inline in the file when used once.
- Colocated `<name>.types.ts` when shared within a feature.
- `shared/types/` only when a type is genuinely needed by unrelated features.

Same colocation gradient as everything else in this skill — see [references/types-organization.md](references/types-organization.md).

## Next.js App Router — Architectural Boundaries

(Not performance — see `next-best-practices` for caching/RSC-performance concerns.)

**Check first: is this a monolithic full-stack Next.js app, or a split frontend+backend?** The DAL/Server Actions guidance below assumes Next.js talks to the database directly. **DevDigest itself does not** — `client` (Next.js) and `server` (Fastify + Drizzle) are separate packages, and `client` talks to `server` only over REST via TanStack Query (see [client/AGENTS.md](../../../client/AGENTS.md)); there is no Server Actions pattern in this repo. In that kind of split setup, translate the concepts below: "DAL" → `server/src/modules/<domain>/repository.ts`, "business logic/service layer" → `server/src/modules/<domain>/service.ts`, and "where does a Server Action live" → it doesn't apply — add a TanStack Query hook in `client/src/lib/hooks/` calling the REST endpoint instead.

- `app/` holds **routing only**: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts`. No business logic, no reusable components living permanently in `app/`.
- Application code lives in `src/features/<domain>/` (components, hooks, services, types, constants for that domain), combined with the `src/` directory convention (`src/app/` + `src/features/`).
- Route groups `(group)` organize routes/layouts without affecting the URL. Private folders `_folder` colocate route-local helpers while opting them out of routing.
- **Data Access Layer (DAL)**: a dedicated module (`lib/dal/` or per-domain) is the *only* code allowed to touch the ORM/database. Server Components, Route Handlers, and Server Actions call the DAL — this centralizes auth checks, keeps secrets out of component code, and makes data logic testable/mockable.
- **Server Actions**: thin wrappers — auth check → validate input → call the DAL → `revalidatePath`/`revalidateTag`. Business logic belongs in the DAL/services, not inside the `'use server'` file. Colocate actions with their feature (`features/<domain>/actions/`), not in one global `actions.ts`.

Full detail and example tree: [references/nextjs-app-router-architecture.md](references/nextjs-app-router-architecture.md).

## Example: Before / After

A full before/after folder tree — migrating a type-based `src/` layout to a feature-based one with a Next.js `app/` — is in [examples.md](examples.md).

## Related Skills

- **react-best-practices** — hooks correctness, memoization, rendering anti-patterns, accessibility.
- **next-best-practices** — Next.js caching, RSC boundaries, data-fetching, image/font/bundling optimization.
- **drizzle-orm-patterns** / **postgresql-table-design** — what sits *behind* the Data Access Layer described here.

## Sources

Every source used to write this skill, with what each one contributes: [README.md](README.md).
