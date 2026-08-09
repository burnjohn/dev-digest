# Next.js App Router architecture

## Contents

- App as composition layer
- Route ownership
- Special files
- Advanced routing
- Version-sensitive conventions

## App as composition layer

Treat `app/` as the URL, route lifecycle, and composition layer. Next.js allows safe colocation but does not prescribe the full application architecture. [N01]

- A segment is public only when it contains `page` or `route`.
- Colocate route-private code in `_components/` and `_lib/` to signal ownership and avoid future convention collisions.
- Use route groups to organize sections/teams or select layouts without changing the URL.
- Keep reusable product capabilities in feature boundaries rather than promoting all route internals to global `components/` or `lib/`.

## Route ownership

`page.tsx` should normally:

- Receive and validate route/search params
- Compose the route UI
- Initiate server-readable route data through a feature query/DAL
- Select expected not-found/redirect outcomes

Keep framework route files thin enough that their composition intent is visible, but do not create wrappers solely to meet a line-count goal.

## Special files

| File | Architectural meaning |
|---|---|
| `layout.tsx` | Persistent shared UI for a route subtree; state is preserved across navigation |
| `template.tsx` | Intentional remount boundary; child client state resets and mount synchronization reruns |
| `loading.tsx` | Segment-level Suspense fallback |
| `error.tsx` | Nearest recoverable unexpected-error boundary; must be a Client Component |
| `global-error.tsx` | Root-layout failure boundary; supplies its own `html` and `body` |
| `not-found.tsx` | Segment-specific missing-resource UI |
| `default.tsx` | Fallback for a parallel slot when active state cannot be recovered |
| `route.ts` | Public HTTP endpoint; does not participate in layouts or client navigation |

Layouts do not rerender on normal navigation. Do not read current pathname/search params in a layout by assuming a fresh server render; pass stable route data or isolate navigation-sensitive UI in a small Client Component. [N18]

Model expected failures as explicit results and render them near the form/operation. Let unexpected render failures reach the closest `error.tsx`. Call `redirect`/`notFound` outside broad catches or rethrow Next.js control-flow errors. [N06]

## Advanced routing

Use advanced routes only when navigation semantics require them:

- Parallel routes (`@slot`) model simultaneous, independently navigable regions with independent loading/error states. Supply `default.tsx` for hard navigation. [N20]
- Intercepting routes model context-preserving navigation, such as opening a details route as a modal while direct URL access renders the full page. [N21]
- Route groups select layouts and organization; they are not domain layers.

Do not use route machinery as a substitute for ordinary component composition.

## Version-sensitive conventions

Inspect the resolved `next` version before applying a rule.

| Concern | Next.js 15 | Next.js 16+ |
|---|---|---|
| Request interception file | `middleware.ts` / `middleware()` | `proxy.ts` / `proxy()` |
| `params`, `searchParams`, `cookies`, `headers` | Async APIs; await them | Async APIs |
| Ordinary `fetch` | Uncached by default | Re-check current Cache Components semantics |
| GET Route Handler | Uncached by default | Re-check current route/cache semantics |
| Cache Components / `'use cache'` | Do not assume available project-wide | Apply only when configured and documented |

DevDigest resolves `next@15.5.19`; use version 15 conventions unless the dependency is upgraded. [N16–N17, N22]
