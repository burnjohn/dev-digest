# Folder Structure

## Canonical Layout (Next.js 15 + React 19, TypeScript)

```
project-root/
├── app/                          # Next.js App Router (routes only)
│   ├── (marketing)/              # Route group — no URL segment
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── about/
│   │       └── page.tsx
│   ├── (dashboard)/              # Route group — shared layout
│   │   ├── layout.tsx
│   │   ├── dashboard/
│   │   │   └── page.tsx
│   │   └── settings/
│   │       └── page.tsx
│   ├── api/                      # Route Handlers (public HTTP endpoints only)
│   │   └── webhooks/
│   │       └── route.ts
│   ├── lib/
│   │   └── actions.ts            # Shared Server Actions
│   ├── layout.tsx                # Root layout (required: <html> + <body>)
│   ├── page.tsx                  # Home route
│   ├── loading.tsx               # Route-level loading UI
│   ├── error.tsx                 # Route-level error boundary
│   └── not-found.tsx
│
├── features/                     # Feature-scoped code (see feature-organization.md)
│   ├── auth/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── api/
│   │   ├── types/
│   │   ├── utils/
│   │   └── index.ts              # Public API barrel
│   └── dashboard/
│       └── ...
│
├── components/                   # Shared UI components (cross-feature)
│   ├── ui/                       # Generic primitives (Button, Input, Modal)
│   └── layout/                   # Shared layout components (Header, Sidebar)
│
├── hooks/                        # Shared custom hooks (cross-feature)
├── lib/                          # Shared utilities, API clients, configs
│   ├── api-client.ts
│   └── utils.ts
├── shared/
│   ├── constants/                # App-wide constants
│   ├── types/                    # Shared TypeScript types
│   └── helpers/                  # Domain helpers used cross-feature
│
├── public/                       # Static assets
├── styles/                       # Global CSS / Tailwind config
├── next.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

## Three Official Organization Strategies (Next.js)

Next.js supports all three — pick one and stay consistent:

### Strategy 1: Project files outside `app/`
```
project/
├── app/          # Routes only (page.tsx, layout.tsx, route.ts)
├── components/   # All components here
├── hooks/
├── lib/
└── types/
```
**Best for:** Simple apps, teams new to App Router, clear separation of routes from code.

### Strategy 2: Project files inside `app/`
```
project/
└── app/
    ├── _components/    # Underscore = private, not a route
    ├── _hooks/
    ├── _lib/
    └── (routes)/
        └── page.tsx
```
**Best for:** Keeping everything in one place, smaller projects.

### Strategy 3: Feature-colocated (recommended for medium/large apps)
```
project/
├── app/
│   ├── dashboard/
│   │   ├── _components/    # Dashboard-specific components, not routable
│   │   ├── page.tsx
│   │   └── loading.tsx
│   └── settings/
│       ├── _components/
│       └── page.tsx
└── components/             # Shared only
```
**Best for:** Large teams, clear feature ownership, natural colocation.

## Key Rules

- **Files in `app/` are NOT routable** unless they are `page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx`, `template.tsx`, `default.tsx`, or `not-found.tsx`
- **Private folders** (`_folder`) are never treated as route segments — use for colocated non-route files
- **Max 2 levels of component nesting** — if you're going deeper, it's likely a feature that should have its own folder
- **`src/` is optional** — Next.js supports it, but root-level `app/` is the convention in most projects

## When to Use `src/`

| `src/` layout | Root-level layout |
|---|---|
| Cleaner separation of source vs config | One less directory level |
| Some teams prefer it for clarity | Most Next.js examples and docs use root-level |
| Both are fully supported | Slightly simpler imports |

**Pick one at project start — changing later requires updating all imports.**

## Colocation Rule

> Code that changes together should live together.

- A component used only in `dashboard/` → lives in `app/dashboard/_components/` or `features/dashboard/components/`
- A component used in 3+ features → lives in `components/`
- A utility used only in `auth` → lives in `features/auth/utils.ts`
- A utility used everywhere → lives in `lib/utils.ts` or `shared/utils/`

## Sources

- [Next.js — Project Structure](https://nextjs.org/docs/app/getting-started/project-structure)
- [Next.js — Colocation](https://nextjs.org/docs/app/building-your-application/routing/colocation)
- [Robin Wieruch — React Folder Structure](https://www.robinwieruch.de/react-folder-structure/)
- [Bulletproof React — Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
