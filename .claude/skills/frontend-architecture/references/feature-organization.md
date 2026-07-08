# Feature Organization

Answers: **"How should I organize this feature internally, and how do features interact?"**

---

## Internal Feature Structure

A feature is a self-contained module that implements one business domain. Everything the feature needs to function lives inside its folder.

### Canonical Internal Structure (Bulletproof React)

```
features/
└── auth/
    ├── api/              # HTTP request functions + React Query hooks
    │   ├── authApi.ts    # Raw fetch/axios functions
    │   └── useLogin.ts   # React Query mutation hook
    ├── components/       # Feature-specific React components (UI layer)
    │   ├── LoginForm.tsx
    │   └── RegisterModal.tsx
    ├── hooks/            # Feature-specific custom hooks (non-API)
    │   ├── useAuthState.ts
    │   └── usePermissions.ts
    ├── stores/           # Feature-scoped state
    │   └── authStore.ts  # Zustand slice or Redux slice
    ├── types/            # Feature-specific TypeScript types
    │   └── auth.types.ts
    ├── utils/            # Feature-specific pure utility functions
    │   └── tokenHelpers.ts
    └── index.ts          # Public API — ONLY entry point for external consumers
```

### What Each Segment Is For

| Segment | Contains | Rules |
|---|---|---|
| `api/` | HTTP functions, React Query hooks, response mappers | One function per endpoint; no business logic; no JSX |
| `components/` | Feature-specific UI only | No API calls directly; use hooks for data |
| `hooks/` | Custom hooks for this feature | No JSX; one concern per hook |
| `stores/` | Zustand slices, Redux slices, or Jotai atoms | Feature-scoped state only; no cross-feature state |
| `types/` | TypeScript interfaces, enums, DTOs | No implementation code |
| `utils/` | Pure functions specific to this feature | No side effects; no React; testable without a browser |
| `index.ts` | Re-exports for external consumers | Only exports what external code actually needs |

### Minimum Viable Feature

Not every feature needs all 6 segments. Only create what is actually needed:

```
features/
└── notifications/
    ├── api/
    │   └── notificationsApi.ts
    ├── components/
    │   └── NotificationBell.tsx
    └── index.ts          # export { NotificationBell } from './components/NotificationBell'
```

---

## Public API Pattern

Every feature exposes a single entry point: `index.ts`. External code never imports from internal files.

### What to Export

```typescript
// features/auth/index.ts
// ONLY export what external consumers actually need

export { LoginForm } from './components/LoginForm'
export { RegisterModal } from './components/RegisterModal'
export { useLogin } from './api/useLogin'
export { usePermissions } from './hooks/usePermissions'
export type { AuthUser, LoginCredentials } from './types/auth.types'

// DO NOT export:
// - Internal implementation details (tokenHelpers, authStore internals)
// - Private hooks used only within the feature
// - API request functions (if they're wrapped by React Query hooks)
```

### Named Exports Only

```typescript
// ✅ Named exports — explicit, tree-shakeable
export { LoginForm } from './components/LoginForm'

// ❌ Wildcard re-export — opaque, breaks tree-shaking, prevents refactoring
export * from './components/LoginForm'
```

### Consuming a Feature

```typescript
// ✅ Always import from the public API (index.ts)
import { LoginForm, useLogin } from '@/features/auth'

// ❌ Never import from internal paths
import { LoginForm } from '@/features/auth/components/LoginForm'
```

---

## Barrel File Rules

A "barrel file" is any `index.ts` that re-exports from multiple internal files.

### When Barrel Files Are Valuable

- **At feature boundaries**: `features/auth/index.ts` — enforces a clean public API contract
- **At shared component libraries**: `shared/ui/index.ts` — groups UI primitives
- **At entity boundaries**: `entities/user/index.ts` — exposes domain object types and utilities

```typescript
// ✅ Barrel at feature boundary — intentional public API
// features/auth/index.ts
export { LoginForm } from './components/LoginForm'
export { useAuthState } from './hooks/useAuthState'
```

### When Barrel Files Are Harmful

- **Inside feature internals**: Do not create `features/auth/components/index.ts` — adds indirection without benefit
- **At deep nesting levels**: `components/ui/forms/inputs/index.ts` — every added barrel slows TypeScript resolution
- **Wildcard re-exports from all internal files**: breaks tree-shaking, creates hidden coupling

```typescript
// ❌ Barrel inside internals — unnecessary indirection
// features/auth/components/index.ts
export * from './LoginForm'
export * from './RegisterModal'
export * from './ForgotPassword'
```

### Performance Impact

Each barrel file forces TypeScript to load all re-exported modules for type resolution. In large projects with many `index.ts` files at every level, this measurably slows the TypeScript language server. The solution: barrel files at **module boundaries** only, not at every directory.

---

## Cross-Feature Communication

Features never import from each other. This is the most violated rule in feature-based architectures.

### The Rule

```typescript
// ❌ PROHIBITED — feature importing from another feature
// features/checkout/components/CheckoutForm.tsx
import { useAuthState } from '@/features/auth'  // WRONG
```

### Correct Patterns

**Pattern 1: Compose at the pages/app layer**

```typescript
// pages/checkout/ui/CheckoutPage.tsx
import { useAuthState } from '@/features/auth'
import { CheckoutForm } from '@/features/checkout'

export function CheckoutPage() {
  const { user } = useAuthState()
  return <CheckoutForm userId={user.id} />
  // User ID is passed as a prop — CheckoutForm doesn't know about auth
}
```

**Pattern 2: Promote to the entities layer (FSD)**

When two or more features need the same domain concept:

```typescript
// entities/user/model/types.ts
export interface User { id: string; email: string; role: Role }

// entities/user/index.ts
export type { User } from './model/types'
export { useCurrentUser } from './model/currentUser'

// Both auth and checkout can import from entities/user — not from each other
import type { User } from '@/entities/user'
```

**Pattern 3: Promote to shared**

For truly generic utilities used across 2+ features:

```typescript
// shared/lib/format.ts
export function formatCurrency(amount: number, currency: string): string { ... }

// Any feature can use shared — no cross-feature imports needed
import { formatCurrency } from '@/shared/lib/format'
```

**Pattern 4: Inversion of control via props**

```typescript
// The feature doesn't depend on another feature — the page wires them together
function ProductPage() {
  return (
    <ProductLayout>
      <ProductDetail />
      <AddToCartButton />   {/* feature: cart */}
      <WishlistButton />    {/* feature: wishlist */}
    </ProductLayout>
  )
}
```

### Why This Rule Exists

Cross-feature imports create hidden coupling:
- Changing `auth` feature internals breaks `checkout`
- Testing `checkout` requires mocking `auth`
- Features cannot be developed or deployed independently
- Onboarding developers must understand all features to change any one

---

## Promotion Rule

Code starts feature-scoped and is promoted upward only when a second consumer appears.

```
Single feature needs it → stays inside that feature
Two features need it   → promote to shared/ or entities/
Three+ features        → definitely shared/
```

### Promotion Process

```
Step 1: Code created inside features/auth/utils/tokenHelpers.ts

Step 2: features/notifications also needs tokenHelpers.ts
        → Time to promote

Step 3: Move tokenHelpers.ts to shared/lib/tokenHelpers.ts
        Update the import in both features
        Remove the copy from features/auth/utils/
```

### What Gets Promoted Where

| Promoted to | When |
|---|---|
| `shared/lib/` | Generic utility (no business domain) |
| `shared/ui/` | Generic UI component (no business domain) |
| `shared/api/` | Generic API helper (auth headers, pagination) |
| `entities/[domain]/` | Business domain object used by multiple features |

### What Does NOT Get Promoted

- Code used by only one feature, even if it looks "generic"
- Code where two features have similar-but-not-identical needs — duplication is often better than a shared abstraction that serves two slightly different purposes

---

## State Placement Within Features

Feature-scoped state belongs inside the feature. Only cross-feature state lives outside.

### Feature Store (Zustand)

```typescript
// features/auth/stores/authStore.ts
import { create } from 'zustand'

interface AuthStore {
  user: User | null
  token: string | null
  setUser: (user: User) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  setUser: (user) => set({ user }),
  clearAuth: () => set({ user: null, token: null }),
}))
```

```typescript
// features/auth/index.ts — export the hook, not the store internals
export { useAuthStore } from './stores/authStore'
```

### When to Lift State Out of a Feature

| Trigger | Where to lift |
|---|---|
| Two features need the same state | `entities/[domain]/model/` (if domain-specific) |
| Three+ features need the same state | `shared/stores/` (if truly global) |
| UI state shared across the whole app | `shared/stores/uiStore.ts` (theme, sidebar, toasts) |
| Server state | React Query cache — no global store needed |

### Anti-pattern: Global Store as Cross-Feature Glue

```typescript
// ❌ Features modifying each other's state via a global store
// features/checkout/hooks/useCheckout.ts
import { useAuthStore } from '@/stores/globalStore'  // bypass!
const { userId } = useAuthStore()

// ✅ Pass state down from the composition layer (page)
// pages/checkout/ui/CheckoutPage.tsx
const { user } = useCurrentUser()  // from entities/user
return <CheckoutFlow userId={user.id} />
```
