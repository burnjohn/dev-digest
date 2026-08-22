# Naming Conventions

## Quick Reference Table

| What | Convention | Example |
|---|---|---|
| React component | `PascalCase.tsx` | `UserProfile.tsx` |
| Component export | `PascalCase` (matches filename) | `export function UserProfile()` |
| Custom hook file | `camelCase.ts` | `useAuth.ts` |
| Custom hook export | `use` + PascalCase noun | `export function useAuth()` |
| Utility file | `camelCase.ts` | `formatDate.ts` or `utils.ts` |
| Constants file | `camelCase.ts` or `<name>.constants.ts` | `constants.ts`, `auth.constants.ts` |
| Constant value | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT`, `API_BASE_URL` |
| Type/Interface file | `camelCase.ts` or `<name>.types.ts` | `user.types.ts` |
| Type/Interface | `PascalCase` | `type UserProfile`, `interface AuthState` |
| Folder | `kebab-case` | `user-profile/`, `api-client/` |
| Route segment folder | `kebab-case` (per Next.js) | `app/user-profile/page.tsx` |
| Private folder | `_camelCase` | `_components/`, `_hooks/` |
| Test file | same name + `.test.tsx` | `UserProfile.test.tsx` |
| Story file | same name + `.stories.tsx` | `UserProfile.stories.tsx` |
| Server Action file | `camelCase.ts` | `actions.ts` |
| API fetch file | `camelCase.ts` | `userApi.ts` |

---

## Component Files

**One component per file. Filename = component name.**

```
components/
├── UserProfile.tsx          ✅ UserProfile component
├── UserProfileAvatar.tsx    ✅ Sub-component, colocated
├── userProfile.tsx          ❌ Wrong: lowercase start
├── user-profile.tsx         ❌ Wrong: kebab-case for components
└── UserProfile/
    └── index.tsx            ⚠️  Acceptable but adds indirection — prefer flat
```

```tsx
// UserProfile.tsx
export function UserProfile({ userId }: { userId: string }) { ... }

// ❌ Wrong: export name doesn't match filename
// UserProfile.tsx
export function Profile() { ... }
```

---

## Hook Naming

Hooks follow the pattern: `use` + what it represents (noun or noun+verb):

```typescript
// ✅ Good hook names
useAuth()              // access auth state
useUser(id)            // access a user entity
useLoginForm()         // form state for login
useSubmitOrder()       // mutation: submit an order
useIntersectionObserver()  // browser API wrapper

// ❌ Bad hook names
useGetUser()           // "Get" is redundant — hooks already imply access
useHandleLogin()       // "Handle" is redundant
useDoCheckout()        // "Do" is redundant
fetchUser()            // No "use" prefix — not recognizable as a hook
```

---

## Folders

All folders use `kebab-case`. This applies to feature folders, shared folders, and Next.js route segments.

```
features/
├── user-profile/     ✅
├── UserProfile/      ❌ PascalCase folder
├── userProfile/      ❌ camelCase folder
└── auth/             ✅ (single word, same in any case)

app/
├── user-profile/     ✅ URL: /user-profile
├── (dashboard)/      ✅ Route group — parentheses notation
├── [userId]/         ✅ Dynamic segment
└── _components/      ✅ Private folder (underscore prefix)
```

---

## Constants

```typescript
// ✅ All constants are UPPER_SNAKE_CASE
export const MAX_FILE_SIZE_MB = 10
export const DEFAULT_PAGE_SIZE = 20
export const SUPPORTED_LOCALES = ['en', 'uk', 'de'] as const

// Object constants: name in UPPER_SNAKE_CASE, keys in UPPER_SNAKE_CASE
export const USER_ROLES = {
  ADMIN: 'admin',
  EDITOR: 'editor',
  VIEWER: 'viewer',
} as const

export const ROUTES = {
  HOME: '/',
  DASHBOARD: '/dashboard',
  SETTINGS: '/settings/profile',
} as const

// ❌ Wrong
export const maxFileSize = 10        // camelCase constant
export const defaultPageSize = 20    // camelCase constant
export const userRoles = { admin: 'admin' }  // camelCase object name
```

---

## Types and Interfaces

```typescript
// ✅ PascalCase types and interfaces
type User = { id: string; name: string }
interface AuthState { user: User | null; isLoading: boolean }
type ButtonVariant = 'primary' | 'secondary' | 'ghost'

// Generics: single uppercase letter or descriptive PascalCase
type ApiResponse<T> = { data: T; error: null } | { data: null; error: string }
type WithId<TEntity> = TEntity & { id: string }

// ❌ Wrong
type user = { ... }         // lowercase
type IUser = { ... }        // Hungarian notation "I" prefix — avoid
type UserInterface = { ... } // "Interface" suffix — redundant
```

---

## Barrel Exports (`index.ts`)

Use barrel exports at feature boundaries to define public API:

```typescript
// features/auth/index.ts — ONLY export what outside code should use
export { LoginForm } from './components/LoginForm'
export { useAuth } from './hooks/useAuth'
export type { AuthUser } from './types/auth.types'

// ❌ Don't re-export everything blindly
export * from './components/LoginForm'      // leaks internals
export * from './hooks/useAuth'
export * from './utils/tokenUtils'          // internal, shouldn't be public
```

**Avoid deep barrel chains** — `index.ts` at feature root = good; `index.ts` at every subfolder = import confusion.

---

## Import Paths

### Use `@/` alias — never deep relative paths

Relative paths with 3+ levels of `../` are hard to read, fragile during refactors, and give no hint about where the module lives. Use the project's `@/` path alias for anything outside the current component's own folder.

```typescript
// ❌ Deep relative — cryptic and fragile
import { useFindingAction } from '../../../../../lib/hooks/reviews'
import { notify } from '../../../lib/toast'
import { FEATURE_MODELS } from '../../../../../../lib/feature-models'

// ✅ Absolute via @/ — always clear
import { useFindingAction } from '@/lib/hooks/reviews'
import { notify } from '@/lib/contexts/toast'
import { FEATURE_MODELS } from '@/lib/utils/featureModels'
```

**Rule of thumb:** if the import path goes up more than 2 levels (`../../`), switch to `@/`.

**When relative IS fine:**
- Sibling files in the same folder: `import { helper } from './helpers'`
- Direct parent: `import { styles } from '../styles'`
- Same feature's subfolders: `import { Tab } from './_components/Tab'`

**When `@/` is required:**
- Importing from `lib/`, `components/`, `contexts/`, `utils/` into any `app/` route
- Importing across feature boundaries
- Any path with 3+ `../` segments

---

## Test Files

```
features/auth/
├── components/
│   ├── LoginForm.tsx
│   └── LoginForm.test.tsx      ✅ Colocated test
├── hooks/
│   ├── useAuth.ts
│   └── useAuth.test.ts         ✅ Colocated test
```

Tests are always colocated — no separate `__tests__/` folder unless required by tooling.

---

## Sources

- [React Naming Conventions & Coding Standards](https://knowledge.businesscompassllc.com/react-naming-conventions-and-coding-standards-best-practices-for-scalable-frontend-development/)
- [Naming Conventions in React — Sufle](https://www.sufle.io/blog/naming-conventions-in-react)
- [File and Folder Naming in React](https://athulchandran-m.medium.com/10-secrets-for-mastering-file-and-folder-naming-conventions-in-react-projects-a29e3103197d)
- [Bulletproof React — Project Standards](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md)
