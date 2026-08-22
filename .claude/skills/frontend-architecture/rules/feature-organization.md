# Feature Organization

## The `features/` Directory

Each feature is a self-contained vertical slice of the application. A feature owns everything it needs to function — components, hooks, API calls, types, utilities, and tests.

```
features/
└── auth/
    ├── components/           # UI components owned by this feature
    │   ├── LoginForm.tsx
    │   ├── LogoutButton.tsx
    │   └── AuthGuard.tsx
    ├── hooks/                # Custom hooks for this feature
    │   ├── useAuth.ts
    │   └── useLoginForm.ts
    ├── api/                  # Data fetching / mutations for this feature
    │   ├── authApi.ts        # Typed fetch functions (not hooks)
    │   └── authQueries.ts    # TanStack Query hooks wrapping authApi
    ├── types/                # TypeScript types for this feature
    │   └── auth.types.ts
    ├── utils/                # Pure utility functions for this feature
    │   └── tokenUtils.ts
    ├── constants.ts          # Feature-scoped constants
    └── index.ts              # Public API — the ONLY import point from outside
```

## Feature Boundary Rules

**Features are isolated islands.** They communicate through `shared/` or through the application layer, never directly.

```typescript
// ✅ Correct — import from shared or the feature's index
import { User } from '@/shared/types'
import { useAuth } from '@/features/auth'     // via index.ts barrel

// ❌ Wrong — direct deep import from another feature
import { tokenUtils } from '@/features/auth/utils/tokenUtils'
import { LoginForm } from '@/features/auth/components/LoginForm'
```

### The `index.ts` barrel pattern

`index.ts` defines the feature's public API. Only export what other parts of the app should use:

```typescript
// features/auth/index.ts
export { LoginForm } from './components/LoginForm'
export { LogoutButton } from './components/LogoutButton'
export { useAuth } from './hooks/useAuth'
export type { AuthUser, AuthState } from './types/auth.types'
// NOT exported: internal utilities, implementation details
```

## When to Create a New Feature

Create a new feature when:
- The domain is clearly distinct (auth, dashboard, billing, notifications)
- Multiple components + hooks + API calls share the same business context
- You'd say "the X feature" when talking to a teammate

Keep inside an existing feature when:
- It's a sub-component of an existing screen (e.g., a sub-form within `auth`)
- It has no API calls or hooks of its own

**Rule of thumb:** A feature maps to a user-facing capability, not a UI component.

## Next.js Route Integration

In Next.js, route segments in `app/` orchestrate features but don't implement them:

```tsx
// app/dashboard/page.tsx — thin route page, wires features together
import { DashboardStats } from '@/features/dashboard'
import { NotificationBell } from '@/features/notifications'

export default async function DashboardPage() {
  return (
    <main>
      <DashboardStats />
      <NotificationBell />
    </main>
  )
}
```

The actual logic lives in `features/`, not in `app/`. Route files stay thin.

## Shared Code (`shared/` or `components/`)

```
shared/
├── constants/          # App-wide constants (routes, config keys, etc.)
├── types/              # Shared TypeScript types used across features
├── helpers/            # Domain helpers used by 2+ features
└── hooks/              # Generic cross-feature hooks (useDebounce, useWindowSize)

components/
├── ui/                 # Generic UI primitives (Button, Input, Badge, Modal)
└── layout/             # App shell components (Header, Sidebar, Footer)
```

**Promotion rule:**
1. Write code colocated in the feature that first needs it
2. When a second feature needs the same code → move to `shared/` or `components/`
3. Never pre-emptively share — wait for the second use case

## Feature-Sliced Design (Advanced)

For very large applications, [Feature-Sliced Design](https://feature-sliced.design/docs) formalizes the structure into strict Layers:

```
src/
├── app/          # App initialization, providers, router (highest level)
├── pages/        # Route composition
├── widgets/      # Composite UI blocks from multiple features
├── features/     # User interactions and business logic
├── entities/     # Business entities (User, Product, Order)
└── shared/       # Reusable primitives (UI kit, utils, API)
```

**Strict import rule in FSD:** layers can only import from layers **below** them. `features/` can import from `entities/` and `shared/`, but never from `widgets/` or `pages/`.

FSD is a heavy methodology — consider it only for 10+ feature apps with multiple teams.

## Sources

- [Bulletproof React — Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
- [Feature-Sliced Design](https://feature-sliced.design/docs)
- [Feature-Based Folder Structure Guide](https://ahmad2point0.medium.com/react-app-feature-based-folder-structure-guide-848ddc7447d5)
- [Next.js — Server Actions organization](https://github.com/vercel/next.js/discussions/55908)
