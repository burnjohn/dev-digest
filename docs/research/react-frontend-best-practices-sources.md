# React and Next.js frontend architecture practices: research and source catalog

Research date: 2026-08-08
Purpose: evidence base for the React + Next.js App Router architecture skill and a future user-facing README.

This document is the canonical source ledger for the implemented skill and future README work. Keep source IDs and exact URLs when transferring material into the skill's `references/` files or a project README. `SKILL.md` stays concise and routes to those references rather than duplicating the entire catalog.

## Scope and evidence model

The research answers these recurring questions:

- Where should route, feature, shared, and design-system components live?
- When should a component be split?
- Where should constants, helpers, schemas, API adapters, and business rules live?
- What belongs in a custom hook, reducer, context, URL, server cache, or global store?
- How should module and Server/Client boundaries be expressed and enforced?
- How should App Router files, Server Components, Server Actions, Route Handlers, DALs, and DTOs divide responsibility?
- Which testing, accessibility, and security practices materially define or protect architectural boundaries?

Sources are classified by authority:

- **A — normative or language/platform authority:** W3C standards and official React, TypeScript, or framework documentation.
- **B — official ecosystem guidance:** official documentation for established libraries and tools.
- **C — opinionated architecture or practitioner guidance:** useful patterns, not universal rules. The skill must label these as choices or heuristics.

No source establishes a universal maximum number of component lines or props. Those numbers can be team review prompts, but should not be encoded as React correctness rules.

Performance optimization is deliberately outside the active scope. Older performance sources remain in the ledger so the research history is not lost, but the skill loads neither performance checklists nor asset-optimization guidance for an architecture-only request. Caching remains in scope only where it changes data correctness, invalidation ownership, rendering semantics, or version compatibility.

The target repository currently resolves `next@15.5.19` and `react@19.2.7`. Current Next.js documentation may describe Next.js 16 conventions, so every version-sensitive rule must state whether it applies to 15, 16+, or both.

## Executive conclusions

### 1. Prefer ownership and change locality over a universal folder tree

React does not prescribe one project structure, and Next.js deliberately supports multiple organization strategies. A resilient default is **feature-first organization with colocation and promotion**:

1. Start code beside its only consumer.
2. Move it to a feature boundary when multiple parts of that feature use it.
3. Promote it to a shared boundary only after reuse is real and its API is stable.
4. Keep business-neutral UI separate from domain-aware feature UI.

This yields a practical default for a Next.js App Router application. `app/` is the routing and composition layer, not a mandatory home for every business module:

```text
src/
  app/                         # routes, layouts, loading/error UI, composition
    (group)/route/
      page.tsx
      _components/             # private to this route subtree
      _lib/                    # private route helpers/adapters
  features/
    review-pr/
      ui/                      # domain-aware feature UI
      model/                   # rules, state transitions, selectors, types
      api/                     # queries, commands, query keys, DTO mappers
      config/                  # feature policy/configuration
      index.ts                 # deliberate public API, if useful
  entities/                    # optional: stable domain concepts used by features
    pull-request/
      ui/
      model/
      api/
  shared/
    ui/                        # business-neutral reusable primitives
    lib/                       # focused modules: dates/, money/, text/, etc.
    config/                    # public runtime config, routes, flags
  server/                      # cross-feature server-only DAL/infrastructure
    auth/
    data/
  app-providers/               # optional client-provider composition
```

Feature-owned server code should remain inside its feature when no other feature needs it; `server/` is for genuinely cross-cutting server-only infrastructure. This is a recommended baseline, not a mandatory taxonomy. Small applications should use fewer layers. A layer that has no clear ownership responsibility should not exist merely to make the tree symmetrical.

### 2. Treat App Router as a composition architecture

Next.js is explicit about route conventions but intentionally unopinionated about the rest of the project. Use each part of the tree for a distinct architectural purpose:

| Layer | Owns | Should not own |
|---|---|---|
| `app/` route segments | URL structure, layouts, pages, loading/error/not-found boundaries, metadata, Route Handler entrypoints, composition | Reusable domain internals merely because a page imports them |
| Route-private `_components/` and `_lib/` | Implementation used only by one route subtree | Cross-route contracts or generic shared code |
| `features/<feature>/` | A user capability: domain-aware UI, model, commands, queries, schemas, feature config | Framework route files or unrelated generic utilities |
| `entities/<entity>/` | Optional stable domain vocabulary reused by several features | Every API response type or database table by default |
| `shared/ui` | Business-neutral primitives and composition APIs | Authorization, fetching, domain status rules |
| `shared/lib/<capability>` | Focused domain-neutral functions | A generic `utils` bucket or feature policy |
| `server/` or feature-local `server/` | `server-only` DAL, authorization, repositories/adapters, safe DTOs | Client hooks, visual state, browser APIs |

A route becomes public only through `page` or `route`, so route-specific code can be safely colocated. Use private folders to signal ownership and protect against future file-convention collisions, not because ordinary colocated files would otherwise become endpoints.

### 3. Make the Server/Client module graph deliberate

Server Components are the default. Add `'use client'` at the smallest module whose subtree actually needs state, Effects, event handlers, context, or browser APIs. The directive marks the module and its transitive dependencies as client code; it is a dependency boundary, not a rendering-mode annotation to scatter everywhere.

```text
Server page/layout
  ├─ server-only feature query → DAL → database/external API
  ├─ Server Component presentation
  └─ Client interaction island
       ├─ local UI state
       ├─ browser APIs / event handlers
       └─ Server Action or public HTTP endpoint when needed
```

Important consequences:

- A Client Component can receive already-rendered Server Component JSX through `children` or another slot; the visual parent/child tree does not determine the module environment.
- Props crossing the boundary must use React's serialization contract, which is broader than JSON. React 19 supports values including `Date`, `Map`, `Set`, typed arrays, global symbols, Promises, JSX, and Server Functions; ordinary functions, classes, null-prototype objects, and non-global symbols are unsupported.
- Client Components also prerender on the server, but must be treated as browser-visible code. They must not import privileged modules or secrets.
- Put providers as deep as practical so only the subtree that consumes them becomes client-owned.
- Use `import 'server-only'` in privileged data/config modules so an invalid client import fails at build time.

### 4. Separate reads, mutations, and HTTP contracts

Choose the boundary by caller and semantic responsibility:

| Need | Entry point | Architectural rule |
|---|---|---|
| Internal read for server-rendered UI | Server Component calls feature query/DAL directly | Do not call the application's own Route Handler; that creates a needless HTTP boundary and can fail during prerendering |
| Existing external REST/GraphQL backend | Server Component calls that backend through a server-only adapter | Preserve the established zero-trust API boundary |
| Mutation initiated by this web UI | Thin Server Action | Validate input, authenticate, authorize ownership, delegate to DAL/domain operation, return a minimal result, then revalidate/redirect |
| Public API, webhook, callback, streaming endpoint, mobile/external client | Route Handler | Treat it as a public endpoint: validate, authenticate/authorize, rate-limit where needed, and return explicit HTTP responses |
| Browser-only or frequently polled/streamed read | Client query/SSE adapter | Use a client cache/stream when the interaction genuinely requires browser lifecycle or incremental updates |

Server Actions and Route Handlers are both externally invokable security surfaces. Hiding a button or returning `null` from a layout is not authorization. Each entry point must repeat the secure authorization check, normally by delegating to the same server-only DAL/policy.

For new applications, prefer one consistent server data strategy: a dedicated DAL that owns access, authorization, and DTO shaping. Direct database queries inside Server Components are acceptable for prototypes, but mixing component-level access, a DAL, and internal HTTP calls makes auditing and ownership ambiguous.

### 5. Let route boundaries express navigation and failure semantics

- `layout.tsx` owns stable UI shared by descendant routes and preserves state across navigation. Do not depend on it rerendering for current pathname/search-param behavior; use route props or a small Client Component where that state is needed.
- `template.tsx` is an intentional remount boundary. Use it only when navigation must reset child client state or rerun mount behavior.
- `loading.tsx` defines a route-segment Suspense boundary; add finer Suspense boundaries where independently meaningful content should stream or suspend.
- `error.tsx` defines the nearest recoverable unexpected-error boundary and is necessarily a Client Component. Model expected failures as return values; use `notFound`, `redirect`, and their route UIs for control-flow outcomes.
- Route groups organize teams/sections and select layouts without changing URLs. They are not domain modules by themselves.
- Parallel routes model simultaneous independently navigable slots. Intercepting routes model context-preserving navigation such as a modal over a list. Both are specialized routing tools, not a generic component-composition mechanism.
- Every parallel slot needs a meaningful `default.tsx` fallback for hard navigation when Next.js cannot recover its previous active state.

### 6. Treat caching as versioned data semantics, not an optimization checklist

In Next.js 15, ordinary `fetch` calls and `GET` Route Handlers are not cached by default; page segments are not reused for normal client navigation by default, while shared layouts and loading states remain reused. Therefore:

- Never infer freshness from the fact that code runs in a Server Component.
- Make cache ownership explicit at the data adapter/query and document the invalidation path next to the mutation.
- Use `revalidatePath` when the invalidation unit is a route and tags when the unit is shared data; avoid broad invalidation as a substitute for understanding ownership.
- Keep version-sensitive cache directives out of framework-neutral React rules.
- Re-check the Next.js version before applying Next.js 16 `use cache`, Cache Components, or `proxy.ts` guidance. DevDigest 15 uses `middleware.ts`, not the 16+ `proxy.ts` convention.

### 7. Adopt server-first architecture incrementally in an existing client-heavy app

Do not rewrite every `'use client'` page merely to satisfy a slogan. For each changed route:

1. Keep the route file responsible for params, composition, and server-readable data where practical.
2. Move interaction and browser lifecycle into client leaves.
3. Extract reusable business rules from components before changing their runtime boundary.
4. Preserve justified client flows such as DevDigest's incremental SSE aggregation; a server snapshot endpoint would duplicate its replay-aware client state path.
5. Add a DAL or feature query at a real authorization/data boundary rather than wrapping existing hooks in an extra layer with no new responsibility.

### 8. Place code by responsibility

| Artifact | Default location | Move it when… | Avoid |
|---|---|---|---|
| Route entry, layout, loading, error boundary | Framework route folder | Never if it participates in routing | Hiding framework conventions behind generic folders |
| Route-only component | Beside route, often `_components/` | A feature or multiple routes own it | Publishing every route fragment as shared UI |
| Feature component | `features/<feature>/ui/` | It becomes genuinely business-neutral | Importing private internals across features |
| Design-system primitive | `shared/ui/<component>/` | It acquires domain behavior, in which case compose it in a feature | Putting API calls or business policy in shared UI |
| Local constant | Module top level beside consumer | Several modules share the same semantic owner | A repository-wide `constants.ts` dumping ground |
| Business constant or policy | Feature/entity `model/` or `config/` | It becomes application configuration | Hiding policy as a generic utility |
| Endpoint adapter, query key, DTO mapper | Feature/entity `api/` | It is truly infrastructure shared by unrelated features | Fetching directly from low-level visual components |
| Pure domain calculation | Feature/entity `model/` | Multiple bounded contexts share an identical, stable concept | Naming it `utils` and losing its domain meaning |
| Generic pure helper | Near consumer first; then a focused `shared/lib/<capability>/` | Reuse and a stable contract are demonstrated | A broad `helpers.ts` or `utils.ts` grab bag |
| Runtime schema/parser | At the I/O boundary that receives unknown data | Several boundary adapters share the same external contract | Trusting TypeScript types to validate runtime data |
| Server-only DAL/repository | Owning feature's `server/`; cross-feature infrastructure under top-level `server/` | Several features share the same authorized access contract | Importing it from Client Components or exposing raw records |
| Server Action | Beside the owning feature/route as a thin mutation adapter | Its underlying operation is shared, then extract the operation—not the action—into the DAL/model | Using it for general reads or trusting caller-supplied ownership |
| Route Handler | `app/**/route.ts` at the public HTTP URL | Never, while it defines that URL contract | Calling it from a Server Component in the same app |
| React stateful adapter | Feature-local hook near its consumers | It becomes a stable reusable React abstraction | Putting ordinary pure functions into hooks |
| Component tests/stories/styles | Beside the component | Tests become cross-feature workflows, then move to integration/e2e area | Separating all tests from their owner by file type |

### 9. Split components by responsibility and boundaries, not magic numbers

Split when at least one of these is true:

- A section has a different reason to change or a distinct domain responsibility.
- A subtree owns independent state or can expose a smaller intentional interface.
- A coherent visual unit is reused, tested, documented, or loaded independently.
- A Server/Client boundary can move closer to the interactive leaf.
- An asynchronous subtree benefits from its own Suspense or error boundary.
- Render logic obscures the component's main intent.
- A pure calculation or state transition can leave JSX and become independently testable.

Do not split solely because a component exceeds an arbitrary line or prop count. Conversely, a short component can still mix unrelated responsibilities. The review question is whether the boundary improves ownership, comprehension, testing, rendering behavior, or reuse.

Prefer composition to a large matrix of boolean props. Before adding another mode prop, consider named variants, slots/children, or separate domain components composed from a shared primitive.

### 10. Constants should retain semantic ownership

Use the narrowest sensible scope:

- **Module-local:** static labels, option arrays, regexes, and small lookup tables used by one module.
- **Feature model/config:** domain limits, workflow states, business copy keys, feature policies.
- **Feature API:** endpoint paths, cache/query keys, external status mappings.
- **App/shared config:** route names, non-secret public runtime configuration, locale setup, feature-flag declarations.
- **Theme/design system:** colors, spacing, typography, breakpoints, motion tokens.
- **Server-only configuration:** secrets and privileged configuration, protected by a server boundary.

Use literal inference tools such as `as const` or `satisfies` when they preserve a useful contract. Do not turn every literal into an exported constant; indirection is only valuable when it gives the value a stable meaning, prevents divergence, or enables reuse/configuration.

### 11. Helpers should be pure and focused; domain rules are not utilities

A useful extraction decision tree:

1. Does the code use React state, context, lifecycle, or an Effect? If yes, it may be a custom hook.
2. Is it a pure business rule, state transition, or domain calculation? Put it in the owning feature/entity model.
3. Does it parse, validate, map, or serialize external data? Put it at the relevant I/O boundary.
4. Is it generic, pure, and demonstrably reused? Put it in a focused shared library named for its capability.
5. Otherwise, keep it private beside the consumer.

Custom hooks share **stateful React logic**; they are not a replacement for ordinary functions or a mandatory home for data access. In Next.js App Router, Server Components can fetch data directly. Client-side query hooks remain appropriate when the browser needs cache coordination, polling, optimistic updates, or client-triggered refetching.

Apply the AHA rule: prefer a little duplication until the stable shared shape is understood. The wrong abstraction creates coupling that is harder to remove than a small amount of duplicated code.

### 12. Business logic should remain usable without rendering UI

Separate three concerns:

- **Pure domain logic:** eligibility rules, calculations, validation policy, state transitions, reducers, and selectors. Place in the owning feature/entity model.
- **Orchestration and I/O:** fetches, commands, persistence, DTO mapping, authorization checks, and use-case coordination. Place in feature API/server modules or a server-side data-access layer.
- **Presentation:** rendering, accessibility semantics, local interaction state, and translating user actions into domain intents.

Event handlers should describe user intent and call these operations. Effects should synchronize React with external systems; they should not be the default place for derived values or event-driven business logic.

For security-sensitive applications, the client is not an authorization boundary. Centralize authorization in a server-side data-access layer and return only the DTO fields the UI needs.

### 13. Choose state storage by the nature of the state

| State kind | Preferred owner |
|---|---|
| Ephemeral visual state | Closest component that needs it |
| Shared state in one subtree | Lift to nearest common owner; consider reducer + context if updates are complex |
| Shareable filters, sort, pagination, selected tab | URL/search params |
| Remote/server data | Server Component or dedicated server-state cache/query library |
| Complex feature workflow | Feature reducer or explicit state machine/model |
| Truly app-wide dependency | Narrow context/provider placed as deep as practical |
| Derived value | Compute during render or with a selector; do not duplicate in state |

Keep state minimal, non-contradictory, and normalized enough to avoid duplicate sources of truth. A server-state cache and a client-state store solve different problems.

### 14. Make boundaries explicit and enforceable

- Keep a deliberate public API for a feature or slice; do not expose every internal file.
- Use relative imports inside the same boundary and public imports across boundaries.
- Avoid wildcard mega-barrels. They obscure dependencies, widen public contracts, and can create cycles; any build-performance impact is secondary to the architectural ambiguity.
- Enforce dependency direction with `no-restricted-imports`, Nx module-boundary rules, or an equivalent project rule.
- Treat `'use client'` as a module-graph boundary. Keep interactive client islands as small and deep as practical.
- Mark privileged modules with `server-only`; do not rely on naming conventions alone to protect secrets.
- Parse unknown data at runtime and infer TypeScript types from the schema when practical.

### 15. Testing follows behavior and ownership

- Colocate focused unit/component tests and stories with their owner.
- Test component contracts through accessible roles, names, labels, and realistic user interactions.
- Use integration/e2e tests for cross-feature workflows and critical paths.
- Prefer `userEvent` over low-level event dispatch for ordinary interactions.
- Use web-first assertions and stable user-visible locators in browser tests.
- Stories should capture meaningful states: default, loading, empty, error, long content, permissions, and responsive variants.

### 16. Accessibility and security constrain architecture

- Prefer native semantic HTML. ARIA is a contract with assistive technology, not decoration; test custom patterns against the APG.
- Preserve keyboard operation, visible focus, names/labels, error identification, contrast, reduced-motion preferences, and responsive reflow.
- Define responsive breakpoints from content failure, not a fixed device catalog.
- Treat raw HTML, URL construction, third-party scripts, and client-visible secrets as security boundaries. React escaping helps, but unsafe HTML still needs rigorous sanitization and policy.
- Treat route params, search params, FormData, headers, cookies, and Server Action arguments as untrusted inputs at their boundary.

### Architecture review questions implemented by the skill

1. Can every changed file name its owner: route, feature, entity, shared capability, or server infrastructure?
2. Does `app/` compose routes, or has reusable business logic accumulated there without route ownership?
3. Is every `'use client'` directive at an intentional dependency boundary, and are its transitive imports browser-safe?
4. Does a Server Component call the real server data boundary directly rather than its own Route Handler?
5. Does each Server Action and Route Handler validate input and authorize the resource independently of the UI?
6. Does the DAL return a minimal safe DTO instead of a raw database/external record?
7. Is state owned by the smallest correct system: component, URL, feature model, server cache, or client stream/query cache?
8. Are cache and invalidation semantics explicit for the resolved Next.js version?
9. Do layout, template, loading, error, not-found, parallel, and intercepting boundaries match navigation semantics rather than folder aesthetics?
10. Can dependency direction be enforced through imports/linting instead of relying on reviewer memory?

## Practices that should not become unconditional skill rules

| Claim | Why it is too absolute | Better formulation |
|---|---|---|
| “Every component must be under 200 lines.” | No React/Next source defines this threshold; formatting and JSX density distort it. | Split by responsibility, state ownership, boundaries, and change reasons. Use size only as a review signal. |
| “A component may have at most 5–7 props.” | A typed primitive can legitimately have more; a component with three unrelated mode props can already be poorly designed. | Review cohesion and prefer composition when the API becomes combinatorial. |
| “All data fetching belongs in custom hooks.” | Contradicts direct Server Component fetching in Next App Router. | Fetch at the appropriate server/client boundary; use hooks only for client React behavior. |
| “All application code belongs under `app/`.” | Next.js allows safe colocation but does not prescribe the application architecture. Route structure and domain ownership are different dimensions. | Keep `app/` as route/composition ownership; colocate route-private code and place reusable features at an explicit feature boundary. |
| “Server Components should fetch from our `/api` Route Handlers.” | An internal HTTP hop duplicates the boundary, fails during build-time prerendering, and obscures the real data owner. | Have Server Components call a server-only query/DAL directly; reserve Route Handlers for actual HTTP consumers. |
| “Server Actions are private because the function is not an API route.” | They are remotely invokable and receive untrusted client input. UI gating does not authorize the operation. | Authenticate, authorize resource ownership, validate, delegate, and minimize every action result. |
| “Server→Client props must be JSON-serializable.” | React 19's RSC serialization contract supports more than JSON, including `Date`, `Map`, `Set`, typed arrays, Promises, JSX, and Server Functions. | Follow React's documented serializable types; still prefer small DTOs to protect data boundaries. |
| “A Server Component fetch is cached.” | Next.js 15 changed ordinary `fetch` and GET Route Handlers to uncached by default. Other versions/configurations differ. | State cache and invalidation semantics explicitly and make the rule version-aware. |
| “Every page should be a Server Component immediately.” | Existing browser-dependent or streaming workflows can have a valid client owner; wholesale conversion mixes architecture work with behavioral migration. | Default new boundaries to server-first and migrate existing routes incrementally around stable seams. |
| “One component per file.” | Useful convention in some teams, not a correctness property. Small private helpers may improve locality. | Give public components focused files; allow tightly coupled private subcomponents nearby. |
| “Context is not global state.” | Context is a delivery mechanism and can carry reducer-managed state; the real issue is scope and update behavior. | Keep providers narrow and distinguish dependency delivery from server-state caching. |
| “Use Atomic Design/FSD exactly.” | Both are conceptual or opinionated models, not React standards. | Choose the smallest taxonomy that clarifies ownership and enforce its dependency direction. |
| “Everything reused twice belongs in shared.” | Early promotion can freeze the wrong abstraction and couple features. | Promote after the shared contract is stable; tolerate local duplication while learning. |

## Source catalog

All sources below were reviewed on 2026-08-08. “Supports” describes the claim the skill may safely derive; it is not a quotation.

The GitHub-hosted architecture sources were revalidated with `gh api` on the research date. Their content blob SHAs were: FSD Layers `eb6374acc06c6b73e3cf1bcfa6355e42b2ce5465`, FSD Public API `a896c49bea163ea3f5bce5465bcf0ba16525997f`, Bulletproof React Project Structure `0af1c3206d59d7817929512a7d267a5af337265c`, and Bulletproof React Components and Styling `359fc5fb75c45fc119acf45571eaddb2e6004173`. Official Next.js MDX sources were also inspected through `gh` in `vercel/next.js` at canary commit `a677cf66af002fbdcf49a982ef435b03554817cc` (2026-08-08); stable `nextjs.org` URLs remain the public citations.

### React architecture and state

- **R01 · A · [Thinking in React](https://react.dev/learn/thinking-in-react)** — Supports component hierarchies based on data/UI responsibilities, single-responsibility thinking, minimal state, and identifying the state owner.
- **R02 · A · [Keeping Components Pure](https://react.dev/learn/keeping-components-pure)** — Supports render purity and keeping side effects out of render.
- **R03 · A · [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure)** — Supports avoiding contradictory, redundant, duplicated, and deeply nested state.
- **R04 · A · [Managing State](https://react.dev/learn/managing-state)** — Supports lifting state, preserving/resetting state, reducers, and context as a graduated toolkit.
- **R05 · A · [Extracting State Logic into a Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer)** — Supports moving complex update logic into a pure reducer outside the component.
- **R06 · A · [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks)** — Supports hooks for reusable stateful React logic, not generic utility extraction.
- **R07 · A · [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)** — Supports computing derived data during render and handling user events in event handlers rather than Effects.
- **R08 · A · [Separating Events from Effects](https://react.dev/learn/separating-events-from-effects)** — Supports distinguishing user-triggered operations from synchronization with external systems.
- **R09 · A · [Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context)** — Supports considering props/composition first and combining reducer + context for complex shared subtree state.
- **R10 · A · [Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state)** — Supports state ownership by tree position and intentional resets with keys/structure.
- **R14 · A · [Common React DOM components](https://react.dev/reference/react-dom/components/common)** — Supports the explicit XSS warning around `dangerouslySetInnerHTML`.
- **R15 · A · [`'use client'` and serializable types](https://react.dev/reference/rsc/use-client#serializable-types)** — Defines `'use client'` as a transitive module boundary and the actual React 19 serialization contract, including supported `Date`, `Map`, `Set`, typed arrays, JSX, Promises, and Server Functions.

### Next.js project and runtime boundaries

- **N01 · A · [Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure)** — Supports route conventions, safe colocation, private folders, route groups, `src`, and multiple valid organization strategies.
- **N02 · A · [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)** — Supports Server Components by default, small client boundaries, `'use client'` as a dependency boundary, `server-only`, and deeply placed providers.
- **N03 · A · [Fetching data](https://nextjs.org/docs/app/getting-started/fetching-data)** — Supports direct fetching in Server Components, proximity to the consumer, streaming, and Suspense.
- **N04 · A · [Authentication](https://nextjs.org/docs/app/guides/authentication)** — Supports a server-only data-access layer, DTOs, centralized authorization, and treating Server Actions/Route Handlers as public-facing security surfaces.
- **N05 · A · [Layouts and pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages)** and **[`useSearchParams`](https://nextjs.org/docs/app/api-reference/functions/use-search-params)** — Support URL/search-param ownership for filters, pagination, and other shareable state.
- **N06 · A · [Error handling](https://nextjs.org/docs/app/getting-started/error-handling)** — Supports expected errors as modeled return values and nested error boundaries for unexpected failures.
- **N08 · A · [CSS](https://nextjs.org/docs/app/getting-started/css)** — Supports truly global styles at app scope, component-scoped CSS/Tailwind, and predictable import ordering.
- **N12 · A · [Metadata and OG images](https://nextjs.org/docs/app/getting-started/metadata-and-og-images)** — Supports keeping route metadata and share imagery in framework-recognized route ownership.
- **N13 · A · [Backend for Frontend](https://nextjs.org/docs/app/guides/backend-for-frontend)** — Defines Route Handlers as public HTTP endpoints, says Next.js backend capabilities are an API layer rather than a full backend replacement, directs Server Components to read from the source instead of internal Route Handlers, and positions Server Actions primarily for UI mutations.
- **N14 · A · [Next.js 15 Data Security](https://nextjs.org/docs/15/app/guides/data-security)** — Recommends choosing a consistent data strategy, a server-only DAL for new projects, centralized authorization, minimal DTOs, `server-only`, thin mutation actions, and audits of client/action/route boundaries.
- **N15 · A · [Server Actions](https://nextjs.org/docs/app/guides/server-actions)** — Defines Server Actions as sequential client-invoked mutations and requires application-level authentication, authorization, input validation, and constrained return values despite framework protections.
- **N16 · A · [Upgrade guide: Next.js 15](https://nextjs.org/docs/app/guides/upgrading/version-15)** — Establishes the Next.js 15 async request APIs and uncached defaults for ordinary `fetch`, GET Route Handlers, and normal page-segment navigation.
- **N17 · A · [Next.js 15 Route Handlers and Middleware](https://nextjs.org/docs/15/app/getting-started/route-handlers-and-middleware)** — Supports `route.ts` as the lowest HTTP routing primitive, its non-participation in layouts/client navigation, uncached GET default, and `middleware.ts` naming/limitations in version 15.
- **N18 · A · [Next.js 15 `layout`](https://nextjs.org/docs/15/app/api-reference/file-conventions/layout)** — Supports layouts as persistent shared route UI, documents their navigation reuse, and explains why pathname/search-param-dependent behavior needs a different owner.
- **N19 · A · [`template` file convention](https://nextjs.org/docs/app/api-reference/file-conventions/template)** — Supports templates as explicit remount boundaries that reset child client state and rerun synchronization behavior on navigation.
- **N20 · A · [Parallel Routes](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes)** — Supports independently navigable slots, per-slot loading/error states, and `default.tsx` fallbacks for unmatched slots after hard navigation.
- **N21 · A · [Intercepting Routes](https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes)** — Supports context-preserving route presentation such as modals while retaining a directly addressable full-page route.
- **N22 · A · [Next.js 15 Caching](https://nextjs.org/docs/15/app/guides/caching)** — Defines the distinct Data, Full Route, Router, and request-memoization layers and documents route- versus tag-based invalidation semantics. Use it for correctness and ownership decisions, not as a performance checklist.

### Feature organization and enforceable module boundaries

- **A01 · B · [Redux Style Guide](https://redux.js.org/style-guide/)** — Supports feature folders, colocation, pure reducers, logic in reducers, minimal state, selectors, local form state by default, and static typing.
- **A02 · B · [Deriving Data with Selectors](https://redux.js.org/usage/deriving-data-selectors)** — Supports reusable/testable derived logic and selectors colocated with the state they understand.
- **A03 · B · [Nx: Enforce Module Boundaries](https://nx.dev/docs/features/enforce-module-boundaries)** — Supports executable dependency constraints instead of relying only on documentation.
- **A04 · B · [ESLint `no-restricted-imports`](https://eslint.org/docs/latest/rules/no-restricted-imports)** — Supports enforcing forbidden import paths and architectural boundaries without adopting Nx.
- **A05 · C · [Feature-Sliced Design: Layers](https://github.com/feature-sliced/documentation/blob/main/src/content/docs/docs/reference/layers.mdx)** — Supports downward dependency direction, business-neutral Shared UI, focused `shared/lib` domains, feature/entity ownership, and keeping page-specific code at page scope. Use as an optional architecture, not a React mandate.
- **A06 · C · [Feature-Sliced Design: Public API](https://github.com/feature-sliced/documentation/blob/main/src/content/docs/docs/reference/public-api.mdx)** — Supports explicit slice contracts, internal relative imports, cross-slice public imports, and cautions against wildcard exports and mega-barrels.
- **A07 · C · [Bulletproof React: Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)** — Provides a practical feature-first tree and unidirectional `shared → features → app` dependency model. Treat names and exact folders as an example.
- **A08 · C · [Bulletproof React: Components and Styling](https://github.com/alan2207/bulletproof-react/blob/master/docs/components-and-styling.md)** — Supports colocation, composition, keeping shared components application-wide, and locating feature components inside features.
- **A09 · C · [Colocation](https://kentcdodds.com/blog/colocation)** — Supports putting code as close as practical to where it is relevant and where it changes.
- **A10 · C · [AHA Programming](https://kentcdodds.com/blog/aha-progra)** — Supports avoiding hasty abstraction and allowing the shared shape to emerge.
- **A11 · C · [The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction)** — Supports preferring removable duplication over a premature shared abstraction.
- **A12 · C · [Atomic Design](https://atomicdesign.bradfrost.com/)** — Provides a vocabulary for design-system decomposition. It should not be treated as the application/domain folder architecture.

### Server state, TypeScript, and runtime contracts

- **D01 · B · [TanStack Query: Does this replace client state?](https://tanstack.com/query/latest/docs/framework/react/guides/does-this-replace-client-state)** — Supports distinguishing asynchronous server state from synchronous client state.
- **D02 · B · [TanStack Query: Query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)** — Supports treating query keys as a cache contract that includes every changing dependency.
- **D03 · B · [TanStack Query: Important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)** — Supports making freshness, refetch, retry, and garbage-collection behavior intentional.
- **T01 · A · [TypeScript Modules](https://www.typescriptlang.org/docs/handbook/2/modules.html)** and **[Modules Reference](https://www.typescriptlang.org/docs/handbook/modules/reference)** — Support explicit module boundaries and correct ESM/module-resolution behavior.
- **T02 · A · [`strict`](https://www.typescriptlang.org/tsconfig/strict)** and **[`noUncheckedIndexedAccess`](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html)** — Support strict type checking and acknowledging missing indexed values.
- **T03 · A · [TypeScript 4.9: `satisfies`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html)** and **[TypeScript 3.4: `const` assertions](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html)** — Support typed constant/config tables without unnecessarily widening literals.
- **T04 · B · [`consistent-type-imports`](https://typescript-eslint.io/rules/consistent-type-imports/)** — Supports making type-only dependencies explicit and avoiding avoidable runtime imports.
- **T05 · B · [Zod basics](https://zod.dev/basics)** — Supports validating unknown runtime values with `parse`/`safeParse` and deriving static types from schemas.

### Accessibility and responsive design

- **W01 · A · [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)** — Normative checklist source for perceivable, operable, understandable, and robust UI requirements.
- **W02 · A · [ARIA in HTML](https://www.w3.org/TR/html-aria/)** — Normative rules for valid ARIA use in HTML; prefer native semantics when available.
- **W03 · A · [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)** and **[Read Me First](https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/)** — Supports keyboard/focus patterns and the warning that incorrect ARIA can be worse than no ARIA.
- **W04 · B · [MDN: HTML accessibility](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Accessibility/HTML)** — Supports semantic elements, labels, meaningful text alternatives, and native controls.
- **W05 · B · [MDN: Responsive design](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design)** — Supports flexible layouts, relative sizing, content-driven breakpoints, and mobile-first enhancement.

### Performance archive — out of active skill scope

These sources are retained for provenance only. Do not load them for an architecture-only task.

- **R11 · A · [`useMemo`](https://react.dev/reference/react/useMemo)** — Supports treating memoization as a performance optimization rather than a semantic guarantee.
- **R12 · A · [`<Profiler>`](https://react.dev/reference/react/Profiler)** — Supports measuring render performance before optimizing.
- **R13 · A · [`lazy`](https://react.dev/reference/react/lazy)** and **[Suspense](https://react.dev/reference/react/Suspense)** — Support top-level lazy declarations and intentional async/code-splitting boundaries.
- **N07 · A · [Lazy loading](https://nextjs.org/docs/app/guides/lazy-loading)** — Supports code-splitting client components and heavy client libraries.
- **N09 · A · [Images](https://nextjs.org/docs/app/getting-started/images)** and **[Fonts](https://nextjs.org/docs/app/getting-started/fonts)** — Support built-in optimization, dimensions, self-hosted fonts, and reducing layout shift.
- **N10 · A · [Production checklist](https://nextjs.org/docs/app/guides/production-checklist)** — Supports an integrated production review across rendering, performance, accessibility, security, and metadata.
- **N11 · A · [Local development](https://nextjs.org/docs/app/guides/local-development)** — Supports caution around broad barrel files because of module loading and development-performance costs.
- **P01 · B · [Web Vitals](https://web.dev/articles/vitals)** — Defines the user-centered measurement model and current Core Web Vitals.
- **P02 · B · [Top Core Web Vitals recommendations](https://web.dev/articles/top-cwv)** — Supports prioritizing high-impact, field-measurable fixes and reducing unnecessary JavaScript.
- **P03 · B · [Browser-level image lazy loading](https://web.dev/articles/browser-level-image-lazy-loading)** — Supports explicit dimensions and avoiding lazy loading for likely LCP imagery.
- **P04 · B · [Font best practices](https://web.dev/articles/font-best-practices)** — Supports intentional font loading and layout-stability strategies.
- **P05 · B · [Optimize long tasks](https://web.dev/articles/optimize-long-tasks)** — Supports breaking up main-thread work to preserve responsiveness.
- **P06 · B · [Reduce JavaScript payloads with code splitting](https://web.dev/articles/reduce-javascript-payloads-with-code-splitting)** — Supports route/component-level delivery of code only when needed.

### Testing and component documentation

- **Q01 · B · [Testing Library guiding principles](https://testing-library.com/docs/guiding-principles/)** — Supports tests that resemble real use and avoid implementation details.
- **Q02 · B · [Testing Library query priority](https://testing-library.com/docs/queries/about/)** — Supports accessible roles, names, labels, and text as preferred test queries.
- **Q03 · B · [`user-event` introduction](https://testing-library.com/docs/user-event/intro/)** — Supports realistic interaction sequences over bare low-level event dispatch.
- **Q04 · B · [Playwright best practices](https://playwright.dev/docs/best-practices)** — Supports isolated tests, user-visible behavior, resilient role locators, and web-first assertions.
- **Q05 · B · [Storybook: What is a story?](https://storybook.js.org/docs/get-started/whats-a-story)** and **[Component documentation](https://storybook.js.org/docs/writing-docs/index)** — Support documenting components through important rendered states and usage contracts.
- **Q06 · B · [Storybook tests](https://storybook.js.org/docs/writing-tests)** — Supports interaction, accessibility, visual, and component-level checks from stories.
- **Q07 · B · [Vitest: Testing in practice](https://vitest.dev/guide/learn/testing-in-practice)** — Supports contract-based tests and avoiding implementation-coupled assertions.

### Frontend security

- **S01 · B · [OWASP Cross Site Scripting Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)** — Supports context-sensitive output handling, sanitization for HTML, and avoiding unsafe sinks.
- **S02 · B · [OWASP Content Security Policy Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)** — Supports CSP as defense in depth, rollout/reporting guidance, and restrictive script policies.
- **S03 · B · [OWASP Third Party JavaScript Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.html)** — Supports inventorying, constraining, and monitoring third-party scripts.

### Design systems and tokens

- **U01 · C · [Design Tokens Community Group format draft](https://www.designtokens.org/tr/drafts/format/)** — Supports portable token naming, types, references, and groups. It is a Community Group draft, not a W3C Recommendation.
- **U02 · C · [Atomic Design](https://atomicdesign.bradfrost.com/)** — Supports composing primitives into larger interface systems; use with the ownership caveat described under A12.

## Evaluated but excluded or downgraded

- **W3C “Using ARIA” Working Group Note:** excluded as a citation because W3C marked it a discontinued draft in 2026 and says it is inappropriate to cite except as abandoned work. Use W02/W03 instead.
- **React Router state-management guidance:** valid for React Router applications, but not part of the core catalog because the target repository uses Next.js App Router. The URL-state conclusions are already supported by N05.
- **Generic “clean code” component-size rules:** excluded because they do not establish React-specific evidence and encourage false precision.
- **Feature-Sliced Design and Bulletproof React:** retained as C-level architecture examples, never as framework requirements.
- **The repository's current React skill:** treated as an audit input, not an authority. Its 200-line/5–7-prop thresholds and all-fetching-in-hooks rule require revision before reuse.
- **The repository's current Next skill:** treated as an audit input, not an authority. Its Server/Client guide incorrectly narrows React serialization to JSON and bans supported `Date`, `Map`, and `Set` values; R15 is the source of truth.
- **Performance and asset optimization:** retained in the source ledger but excluded from the proposed architecture skill. Caching stays only as versioned data/invalidation semantics.

## Implemented reference layout

The skill stays discoverable without becoming one oversized instruction file:

```text
react-next-architecture/
  SKILL.md
  agents/
    openai.yaml
  references/
    placement-and-boundaries.md
    components-and-state.md
    next-app-router.md
    server-client-and-data.md
    review-checklist.md
    source-catalog.md
```

Implemented `SKILL.md` routing:

- Always load `placement-and-boundaries.md` for structure/refactoring questions.
- Load `components-and-state.md` for component APIs, splitting, hooks, context, reducers, stores, or business rules.
- Load `next-app-router.md` when the project uses Next.js or the request mentions route structure, layouts, special files, middleware/proxy, or version migration.
- Load `server-client-and-data.md` for RSC boundaries, serialization, DALs, DTOs, Server Actions, Route Handlers, browser queries/streams, caching semantics, or authorization.
- Load `review-checklist.md` for architecture reviews, severity, false-positive control, testing boundaries, and migration sequencing.
- Keep `source-catalog.md` as the exact provenance ledger derived from this document.

## README transfer manifest

When a README is created later, retain these source groups instead of copying only a short “inspiration” list:

| README section | Required source IDs |
|---|---|
| Philosophy and component ownership | R01–R10, N01–N03, A09–A11 |
| Folder and import architecture | N01–N02, N13, A01–A08 |
| App Router composition and route ownership | N01, N05–N06, N12, N17–N21 |
| Constants, helpers, and business logic | R02, R05–R08, A02, A05, T03–T05 |
| State and data | R03–R10, N03–N05, D01–D03 |
| Server/Client module graph and serialization | N02, N14, R15, T01, T04–T05 |
| DAL, DTO, actions, and HTTP contracts | N03–N04, N13–N17, T05, S01–S03 |
| Version-sensitive Next.js 15/16 rules | N01, N16–N19, N22 |
| Server/client security boundaries | N02, N04, N13–N15, R14–R15, S01–S03 |
| Accessibility and responsive UI | W01–W05 |
| Testing and documentation | Q01–Q07 |
| Optional architecture variants | A05–A08, A12, U01–U02 |
| Performance archive, not part of the skill | R11–R13, N07, N09–N11, P01–P06 |

Maintenance rules for the source list:

1. Preserve source IDs so later rules can cite provenance unambiguously.
2. Prefer stable official URLs; for GitHub architecture guides, pin a commit when the final skill is released if reproducibility matters more than following the latest revision.
3. Record a new review date whenever a source is revalidated.
4. Label C-level guidance as opinionated in both the skill and README.
5. Do not add a numeric threshold unless it is explicitly identified as a configurable team heuristic.
6. Keep framework-specific rules conditional; React-only, Next.js, SPA, and React Native constraints are not interchangeable.
7. Record the project's resolved Next.js version before applying cache, async API, middleware/proxy, or Cache Components rules.
8. Keep performance references in the provenance ledger but outside the architecture skill's loading routes.
