# Constants, Utils, Helpers & Services

## The Taxonomy

| Type | What it is | Naming | Location |
|---|---|---|---|
| **Constants** | Immutable scalar/object values | `UPPER_SNAKE_CASE` | `constants.ts` colocated or `shared/constants/` |
| **Utils** | Pure functions, no React, no side effects | `camelCase` | `utils.ts` or `lib/utils.ts` |
| **Helpers** | Domain-specific pure functions | `camelCase` | `<feature>/utils.ts` or `shared/helpers/` |
| **Services** | External integrations, API clients, I/O | `camelCase` class or function | `services/` or `lib/` |

---

## Constants

### What belongs here
```typescript
// ✅ Constants — stable values that never change at runtime
export const MAX_FILE_SIZE_MB = 10
export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const ROUTES = {
  HOME: '/',
  DASHBOARD: '/dashboard',
  SETTINGS: '/settings',
} as const
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL
```

### Where to put constants

```
Used in one place?     → define inline in the file (don't extract yet)
Used in one feature?   → features/<name>/constants.ts
Used across features?  → shared/constants/<domain>.constants.ts
App-wide config?       → lib/config.ts or shared/constants/app.constants.ts
```

### Anti-patterns

```typescript
// ❌ Magic strings scattered in components
if (user.role === 'admin') { ... }
navigate('/dashboard/settings')

// ✅ Named constants
import { USER_ROLES, ROUTES } from '@/shared/constants'
if (user.role === USER_ROLES.ADMIN) { ... }
navigate(ROUTES.SETTINGS)
```

### Domain string literals — always extract to constants

Any domain-specific string literal that appears in JSX or logic must be a named constant. This includes enum member names referenced as strings when the enum isn't available as a runtime value.

```typescript
// ❌ Hardcoded domain strings in JSX/logic
if (finding.severity === 'CRITICAL') { ... }
<span className={sev === 'WARNING' ? 'warn' : ''}>

const SEVERITY_LABELS = {
  'CRITICAL': 'Critical',   // ← raw string keys
  'WARNING': 'Warning',
  'SUGGESTION': 'Suggestion',
}

// ✅ Extract to constants.ts, or use the Zod enum value directly
import { Severity } from '@devdigest/shared'  // import as VALUE, not `import type`

if (finding.severity === Severity.enum.CRITICAL) { ... }

// When the enum isn't accessible as a value, mirror it in constants.ts:
export const SEVERITY = {
  CRITICAL: 'CRITICAL',
  WARNING: 'WARNING',
  SUGGESTION: 'SUGGESTION',
} as const
```

**Rule:** if you find yourself typing `'CRITICAL'`, `'WARNING'`, `'open'`, `'closed'` or any other domain string literal — stop and check whether an enum/constant already exists. If it does, import it. If it doesn't, create it in `constants.ts`.

---

## Utils (Pure Functions)

Utils are **stateless, framework-agnostic, side-effect-free functions**. They take input and return output. No `useState`, no `fetch`, no `document`.

```typescript
// ✅ Utils — pure, no dependencies, portable
export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')
}
```

### Where to put utils

```
No React dependency + pure?
├── Used in 1 feature → features/<name>/utils.ts
└── Used in 2+ features → lib/utils.ts or shared/utils/<domain>.ts
```

**Don't** put React hooks, fetch calls, or DOM access in utils files. Those belong in hooks or services.

---

## Helpers (Domain-Specific)

Helpers are domain-aware pure functions — they know about your business entities but still have no side effects.

```typescript
// helpers/userHelpers.ts
import type { User } from '@/shared/types'

export function getUserDisplayName(user: User): string {
  return user.displayName ?? `${user.firstName} ${user.lastName}`
}

export function isUserAdmin(user: User): boolean {
  return user.roles.includes('admin')
}

export function canUserEditPost(user: User, post: Post): boolean {
  return isUserAdmin(user) || post.authorId === user.id
}
```

Helpers go in `features/<name>/helpers.ts` or `shared/helpers/<domain>.helpers.ts`.

---

## Services (External Integrations)

Services handle I/O: HTTP calls, browser storage, analytics, third-party SDKs. They are **not** React hooks — they're plain TypeScript modules that hooks consume.

```typescript
// lib/apiClient.ts — shared HTTP client
const apiClient = {
  get: <T>(url: string, options?: RequestInit) =>
    fetch(`${API_BASE_URL}${url}`, { ...options, method: 'GET' })
      .then(res => res.json() as Promise<T>),
  post: <T>(url: string, body: unknown, options?: RequestInit) =>
    fetch(`${API_BASE_URL}${url}`, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    }).then(res => res.json() as Promise<T>),
}

export default apiClient
```

```typescript
// features/auth/api/authApi.ts — feature-specific API functions
import apiClient from '@/lib/apiClient'
import type { LoginRequest, AuthUser } from '../types/auth.types'

export async function loginUser(credentials: LoginRequest): Promise<AuthUser> {
  return apiClient.post<AuthUser>('/auth/login', credentials)
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  return apiClient.get<AuthUser>('/auth/me')
}
```

The hooks then wrap these with TanStack Query:

```typescript
// features/auth/api/authQueries.ts
import { useMutation, useQuery } from '@tanstack/react-query'
import { loginUser, fetchCurrentUser } from './authApi'

export function useCurrentUser() {
  return useQuery({ queryKey: ['auth', 'me'], queryFn: fetchCurrentUser })
}

export function useLogin() {
  return useMutation({ mutationFn: loginUser })
}
```

### Services structure

```
lib/
├── apiClient.ts          # Base HTTP client (shared)
├── analyticsService.ts   # Analytics (Segment, Mixpanel, etc.)
└── storageService.ts     # localStorage/sessionStorage wrapper

features/<name>/api/
├── <name>Api.ts          # Typed fetch functions (no React)
└── <name>Queries.ts      # TanStack Query hooks wrapping the API
```

---

## Quick Reference

```
New constant:
├── Used once? → inline in the file
├── Used in one feature? → features/<name>/constants.ts
└── Used everywhere? → shared/constants/<domain>.constants.ts

New function:
├── Pure, no React? → utils or helpers
│   ├── Feature-specific? → features/<name>/utils.ts
│   └── Shared? → lib/utils.ts or shared/helpers/
├── Has side effects / I/O? → services/<name>Service.ts
└── Uses React (useState, useEffect, etc.)? → it's a hook, not a util
```

## Sources

- [Bulletproof React — Project Standards](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md)
- [React Naming Conventions](https://knowledge.businesscompassllc.com/react-naming-conventions-and-coding-standards-best-practices-for-scalable-frontend-development/)
- [profy.dev — API Layer](https://profy.dev/article/react-architecture-api-client)
- [Clean Architecture for React](https://osmancea.medium.com/clean-architecture-for-react-apps-c65e2d469418)
