# Next.js App Router Organization

Where **non-route** code lives inside `app/`. Special-file mechanics — `page.tsx`/`layout.tsx`/`loading.tsx`/`error.tsx` semantics, dynamic segment syntax (`[slug]`, `[...slug]`, `[[...slug]]`), parallel routes (`@slot`), intercepting routes (`(.)`/`(..)`/`(...)`), and the `middleware.ts` → `proxy.ts` rename — belong to [`next-best-practices`](../next-best-practices/SKILL.md), not here. This file covers what to do with the code that *isn't* one of those special files.

## `src/app/` vs root `app/`

This repo uses `src/` (`client/src/app/`) — not a root-level `app/`. Settled; don't relitigate it per-PR.

## Thin pages

`page.tsx` composes and delegates to a colocated view component; it does not hold data-fetching logic, derived state, or rendering detail itself. The pattern to copy:

```tsx
// app/settings/[section]/page.tsx — 6 lines, the whole file
export default function SettingsPage({ params }: Props) {
  return <SettingsView section={params.section} />;
}
```

`app/agents/page.tsx` is the same shape. Four pages currently hold real logic in the page body instead of delegating (`app/page.tsx`, `app/agents/[id]/page.tsx`, `app/repos/[repoId]/pulls/page.tsx`, `app/repos/[repoId]/pulls/[number]/page.tsx`) — these are the pattern to move *away* from, not a second valid style. When touching one of these, extract the body into its `_components/<Name>/` view rather than adding more logic to the page.

## `_components/` and friends

A `_`-prefixed folder opts out of routing (mechanic owned by `next-best-practices`); what actually goes inside one is this skill's concern:

- **What belongs**: the view component(s) for that route only, each in its own `<Name>/` subfolder with a colocated `<Name>.test.tsx` — same one-component-per-folder shape as [component-organization.md](component-organization.md), just rooted at a route segment instead of `components/`.
- **`_lib`/`_hooks`**: justified only when the route has route-specific data logic that no other route needs. If the same hook or helper would be useful to a second route, it isn't route-private anymore — see the next point.
- **Graduating to `client/src/components/<feature>/`**: same second-consumer threshold as [folder-structure.md](folder-structure.md)'s promotion rule — a `_components/` item moves to the shared `components/` layer only when a second route actually needs it today, not preemptively. `components/app-shell` (cross-cutting chrome used by every route) is the example of something that correctly lives at the shared layer instead of inside one route's `_components/`.
- Nesting can go one level deep when a route's view genuinely has separable subviews (`SettingsView/_components/SettingsApiKeys/`), but see [component-organization.md](component-organization.md)'s nesting-depth ceiling — two levels is the practical limit before relative imports stop being readable.

## Route-segment support files

`app/repos/[repoId]/pulls/` is currently the only route segment with `constants.ts`/`helpers.ts`/`styles.ts` sitting at the segment root (siblings of `page.tsx`), instead of inside a `_components/<Name>/` folder. Rule: this placement is correct when the support file is shared by **2+ sibling `_components/`** within that same segment — a segment-root `helpers.ts` used by only one `_components/<Name>/` should be colocated inside that folder instead, per the usual promotion threshold.

## Route groups for organization

Zero route groups (`(group)/`) exist in this repo today — every route renders under the one root `layout.tsx`. That's fine as long as every route shares the same chrome and auth posture.

Introduce a route group when a set of routes needs a **genuinely different layout or chrome** — e.g. an unauthenticated `(onboarding)` flow that shouldn't render the authenticated app shell, or a `(marketing)` split with no sidebar. A route group added without its own `layout.tsx` buys nothing: it changes no URLs and provides no isolation, so don't add one just to visually cluster routes in the file tree — that's what a plain non-group folder already does.

## `"use client"` placement

Push the directive to the leaf component that actually needs interactivity or browser APIs — not up to the page, and not by habit on every new file.

Current state, stated plainly so it reads as a deliberate posture rather than an oversight: 63 files carry `"use client"`, 0 carry `"use server"`, and only 3 files are genuine server components (`app/layout.tsx`, `app/agents/page.tsx`, `app/settings/[section]/page.tsx`). All data flows through TanStack Query hooks in `lib/hooks/*`, not server-side fetching. This is effectively a client-rendered SPA under a thin server-rendered layout — a valid architecture for this app, not a violation of App Router conventions. New route/component work should follow the existing posture (client components + TanStack Query) rather than mixing in ad hoc server-fetched data on a per-page basis, since that would create two competing data-fetching patterns in the same app.

## Server Actions / Route Handlers

Neither exists in this repo today (no `route.ts`, no `"use server"`). If either is introduced: a route handler's helpers follow the same rule as everything else here — colocate next to the `route.ts` that uses them, promote to `lib/` only on a second consumer. See [`next-best-practices`](../next-best-practices/SKILL.md) for the handler mechanics themselves.
