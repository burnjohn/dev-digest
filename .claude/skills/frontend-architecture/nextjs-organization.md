# Next.js (App Router) Organization

How to organize files and folders in a Next.js App Router app — *where things live*.
For RSC boundaries, data fetching, metadata, and route-handler mechanics, use `next-best-practices`.

## Contents
- [Colocation is safe by default](#colocation-is-safe-by-default)
- [Private folders `_folder`](#private-folders-_folder)
- [Route groups `(folder)`](#route-groups-folder)
- [The `src/` folder & where shared code lives](#the-src-folder--where-shared-code-lives)
- [Feature-driven architecture for large apps](#feature-driven-architecture-for-large-apps)
- [Where lib & server actions go](#where-lib--server-actions-go)
- [Anti-patterns](#anti-patterns)

## Colocation is safe by default

A folder under `app/` becomes a **public route only when it contains `page.tsx`/`route.ts`**. Everything
else colocated there (components, hooks, helpers, styles) stays private. So colocate freely:

```
app/repos/[repoId]/pulls/[number]/
├── page.tsx              # the route
├── _components/          # colocated UI, NOT routable
│   └── FindingsPanel.tsx
└── _lib/                 # colocated helpers, NOT routable
```

**Heuristic:** when in doubt, colocate with the route; globalize only when reused elsewhere.

## Private folders `_folder`

Prefix a folder with `_` to opt it out of routing. Not strictly required (colocation is already safe),
but useful to:
- separate UI/logic from routing,
- group internal files consistently,
- avoid clashing with future Next.js file conventions.

`_components` and `_lib` next to a route are the common convention.

## Route groups `(folder)`

Wrap a folder in parentheses to organize routes **without affecting the URL**:
```
app/
├── (marketing)/page.tsx     → /
├── (marketing)/about/...    → /about
├── (shop)/cart/...          → /cart
└── (auth)/login/...         → /login   # its own layout.tsx
```
Use for grouping by section/team and for applying different layouts.

**Pitfalls:**
- Multiple **root** layouts trigger a full page reload when navigating across them.
- Two groups must not resolve to the same path (`(a)/about` + `(b)/about` → conflict).

## The `src/` folder & where shared code lives

`src/` separates app code from root config. Shared, route-agnostic code lives at the top level inside it:
```
src/
├── app/                  # routing only (option 1) — or hosts shared code too (option 2)
├── components/ ui/        # shared primitives
├── lib/  hooks/  constants/
└── features/             # see below
```

**Three official strategies** (folder names like `components`/`lib` carry no framework meaning):
1. All app code in root shared folders; `app/` is routing-only.
2. All app code in shared folders **inside** `app/`.
3. Global code at `app/` root + route-specific code colocated in segments.

Use **module path aliases** (`@/components/...`) instead of `../../../`.

## Feature-driven architecture for large apps

Each feature owns everything it needs; expose a public surface via `index.ts`:
```
src/features/reviews/
├── actions/    # server actions
├── api/        # route handlers / fetchers
├── components/ # feature UI
├── hooks/  stores/        # client-side (implies "use client" in importers)
├── lib/  services/        # pure utils / business logic
├── schemas/    # zod
├── types/
└── index.ts
```

**Two competing top-level philosophies** — know both, pick one and stay consistent:
- **Feature-first** (most common at scale): group by feature, then by type inside.
- **Technical-layer-first**: group by layer (`components/`, `actions/`, …), then by feature within. Simpler discovery, less ambiguity about "where does this go".

## Where lib & server actions go

**`lib/` = the application core.** One-way dependency graph: `app → components → lib`. `lib/` must not
import from `components/` or `app/`. Keep client-only `hooks/`/`stores/` separate from `lib/` so the
client/server boundary is visible in the filesystem.

**Server actions:**
- Colocate with their route/feature (`_lib/reviews.actions.ts` or `features/reviews/actions/`). A central `lib/actions/` becomes unmanageable past ~50 actions.
- Keep them **thin**: validate input → call a service → handle the response. Push real business logic into a `services/` layer so it's unit-testable without Next.js internals (cookies/headers).
- Use **API routes** for mutations consumed by external clients (webhooks, mobile, third parties); use **server actions** for UI-triggered writes.
- Data-flow shape: Server Components read · Server Actions write · Client Components are the interactive surface.

## Anti-patterns

- Dumping all code into `app/`.
- `'use client'` at the top of `page.tsx` — push the directive down to the interactive leaf.
- A single `lib/actions/` holding every server action.
- A `utils.ts` "junk drawer" — if you can't name what a util belongs to, it wants a feature folder.
- Excessive nesting; premature extraction into packages; circular deps between features.
