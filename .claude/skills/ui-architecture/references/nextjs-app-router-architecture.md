# Next.js App Router — Architectural Boundaries

Scope note: this file is about **where code lives and who is allowed to call whom** — not about caching, rendering performance, or RSC boundary *correctness* (invalid client/server combinations, serialization). Those are covered by the `next-best-practices` skill.

## Before applying this file: monolithic Next.js, or split frontend+backend?

Everything below — the Data Access Layer, Server Actions calling the DAL directly — assumes Next.js *is* the backend: Server Components, Route Handlers, and Server Actions all run in the same process as the database access code. That's a common Next.js setup, but not universal, and applying it blindly to a project that isn't built that way will point you at the wrong files.

**DevDigest is the split kind, not the monolithic kind.** `client` (`@devdigest/web`, this Next.js app) and `server` (`@devdigest/api`, Fastify + Drizzle/Postgres) are two separate packages. `client` talks to `server` exclusively over REST via TanStack Query — see [client/AGENTS.md](../../../../client/AGENTS.md) and [server/AGENTS.md](../../../../server/AGENTS.md). There is no `'use server'` file anywhere in this repo, and Next.js never imports Drizzle directly.

If you're working in DevDigest, translate the concepts in this file like this:

| Concept below | DevDigest equivalent |
|---|---|
| Data Access Layer (`lib/dal/`) | `server/src/modules/<domain>/repository.ts` — the only file in a module that runs Drizzle queries |
| Business-logic/service layer | `server/src/modules/<domain>/service.ts` — called by `routes.ts`, calls `repository.ts` |
| Server Action as a thin wrapper | Doesn't apply — there's no Server Actions pattern here. The equivalent "thin wrapper" is `server/src/modules/<domain>/routes.ts` (Fastify route → validates → calls `service.ts`) |
| Client-side call site for a mutation/query | A TanStack Query hook in `client/src/lib/hooks/<resource>.ts` (see `agents.ts`, `reviews.ts`, `repo-intel.ts` for the existing pattern), calling the REST endpoint via `client/src/lib/api.ts` |

If you're using this skill outside DevDigest, or DevDigest later grows actual Next.js Server Actions/direct DB access, the guidance below applies as written — just confirm which situation you're actually in first.

## `app/` is routing only

The App Router's file conventions (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts`, etc.) exist to define **routes**, not to host application code. The most common architectural mistake in App Router codebases is dropping components, hooks, and business logic directly into `app/` alongside the routes — it works at first, then makes it impossible to tell what's routing infrastructure and what's a reusable piece of the app.

Keep `app/` thin: a page composes components and calls into a feature; it doesn't contain the feature's logic itself.

Source: [Next.js Docs — Project Structure](https://nextjs.org/docs/app/getting-started/project-structure).

## `src/` + feature folders

Next.js officially supports moving application code under `src/`, so that `app/` (routing) sits inside `src/app/`, separate from root-level config files (`next.config.js`, `package.json`, etc.).

Combined with feature-based organization, a scalable layout looks like:

```
src/
  app/                    # routing only
    (marketing)/          # route group — no URL segment
      page.tsx
    (dashboard)/
      layout.tsx
      settings/
        page.tsx
  features/
    auth/
      components/
      hooks/
      actions/
      dal/
      types/
    billing/
      ...
  components/             # shared UI primitives only
  lib/
  types/
```

Sources: [Next.js Docs — src Directory](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder), [Wisp CMS — Ultimate Guide to Organizing Next.js 15 Project Structure](https://www.wisp.blog/blog/the-ultimate-guide-to-organizing-your-nextjs-15-project-structure), [MakerKit — Next.js 16 App Router Project Structure](https://makerkit.dev/blog/tutorials/nextjs-app-router-project-structure).

## Route groups and private folders

Two official file-system conventions help keep `app/` organized without adding business logic to it:

- **Route groups** `(groupName)` — group routes/layouts by category (e.g. separate layouts for a marketing site vs. an authenticated app sharing one domain) without adding a URL segment. `app/(marketing)/about/page.tsx` still resolves to `/about`.
- **Private folders** `_folderName` — explicitly opt a folder out of routing. Useful for route-local helpers that genuinely belong next to one specific route rather than in a feature folder (e.g. `app/dashboard/_components/DashboardHeader.tsx` used only by that one route).

Anything shared across *multiple* routes (a nav bar, a date-formatting util, a design-system button) does not belong in a private folder — it belongs in `components/`/`lib/`/`features/` outside `app/`.

Sources: [Next.js Docs — Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups), [Next.js Docs — Colocation](https://nextjs.org/docs/app/building-your-application/routing/colocation), [Shahin — Organizing Routes and Files in Next.js: Private Folders and Project Structure](https://shahin.page/article/nextjs-routing-private-folders-and-project-structure).

## The Data Access Layer (DAL)

The DAL is a dedicated abstraction boundary between application code and the data store: **no raw ORM/database calls anywhere except inside the DAL.** Server Components, Route Handlers, and Server Actions call DAL functions — they never import Prisma/Drizzle/whatever directly.

```
lib/dal/
  users.ts       # getUser(), updateUser() — the only place that touches the users table
  billing.ts
```
or, colocated per feature:
```
features/billing/dal/
  invoices.ts
```

Why this boundary specifically (not just "put it in a service"):

- **Security**: only the DAL sees `DATABASE_URL`/connection secrets — they never leak into component code.
- **Centralized auth**: permission checks and data sanitization happen once, in the DAL, instead of being re-implemented (and potentially forgotten) at every call site.
- **Testability**: Server Components/Actions can be tested by mocking DAL functions instead of a real database.

Sources: [Ayush Sharma — Understanding the Data Access Layer in Next.js](https://aysh.me/blogs/data-access-layer-nextjs), [MD Samrose — Structuring Your Data Access Layer in Next.js](https://medium.com/@samrose.mohammed/structuring-your-data-access-layer-in-next-js-patterns-that-actually-scale-2e4c07491866).

## Where Server Actions live

A Server Action file (`'use server'`) should be a **thin wrapper**, not where business logic lives:

```
auth check → validate input (e.g. Zod) → call the DAL → revalidatePath/revalidateTag
```

Colocate actions with the feature that owns them (`features/checkout/actions/createOrder.ts`), not in one global `actions.ts` that every feature dumps into — the same colocation-first rule as everywhere else in this skill. Return only what the UI actually needs (a success flag or a slim DTO), never the raw ORM result.

Sources: [Next.js Docs — Server Actions and Mutations](https://nextjs.org/docs/13/app/building-your-application/data-fetching/server-actions-and-mutations), [DigitalApplied — Next.js Server Actions in Production: 2026 Patterns](https://www.digitalapplied.com/blog/nextjs-server-actions-production-patterns-2026-guide).
