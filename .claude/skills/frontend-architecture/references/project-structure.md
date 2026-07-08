# Project Structure

Answers: **"What should my folder structure look like?"**

---

## Small Project — Flat Feature-Based

**For:** 1–3 developers, < 6 months, < 15 components

Start minimal. Add folders only when you have more than 2–3 files of that type.

```
src/
├── components/           # All shared UI components
│   ├── Button.tsx
│   ├── Input.tsx
│   └── Modal.tsx
├── hooks/                # All custom hooks
│   └── useUser.ts
├── pages/                # Route-level pages (or app/ for Next.js)
│   └── Home.tsx
├── utils/                # Pure utility functions
│   ├── formatDate.ts
│   └── validators.ts
├── types/                # Shared TypeScript types
│   └── index.ts
└── api/                  # API request functions
    └── users.ts
```

**Key decisions at this scale:**
- No feature folders yet — everything co-exists in flat directories
- `utils/` for pure functions, `hooks/` for React lifecycle logic, `api/` for HTTP calls
- Move to the next scale when any directory reaches 10+ files or when two developers conflict on the same files

---

## Medium Project — Feature-Based (Bulletproof React)

**For:** 4–10 developers, 6–18 months, 5–15 distinct business domains

```
src/
├── app/                  # Application root: routing, providers, global config
│   ├── layout.tsx        # (Next.js) or App.tsx
│   ├── providers.tsx     # React context providers, QueryClientProvider
│   └── router.tsx        # Route definitions (non-Next.js)
├── assets/               # Static assets: images, fonts, icons
├── components/           # Generic, reusable UI (no business logic)
│   ├── ui/               # Primitives: Button, Input, Badge, Spinner
│   └── layout/           # Layout components: Container, Grid, Stack
├── config/               # App-level configuration, env variable wrappers
│   └── env.ts
├── features/             # Business domain modules (one folder per domain)
│   ├── auth/
│   │   ├── api/          # authApi.ts, useLogin.ts, useLogout.ts
│   │   ├── components/   # LoginForm.tsx, RegisterModal.tsx
│   │   ├── hooks/        # useAuthState.ts, usePermissions.ts
│   │   ├── stores/       # authStore.ts (Zustand) or authSlice.ts (Redux)
│   │   ├── types/        # auth.types.ts
│   │   ├── utils/        # tokenHelpers.ts, permissionChecks.ts
│   │   └── index.ts      # Public API: export only what other modules need
│   ├── users/
│   │   └── index.ts
│   ├── products/
│   │   └── index.ts
│   └── checkout/
│       └── index.ts
├── hooks/                # Shared hooks (used by 2+ features)
│   └── useMediaQuery.ts
├── lib/                  # Pre-configured 3rd-party wrappers
│   ├── axios.ts          # Axios instance with base URL, interceptors
│   ├── queryClient.ts    # React Query client config
│   └── dayjs.ts          # Locale-configured dayjs instance
├── stores/               # Global cross-feature state
│   └── uiStore.ts        # Theme, sidebar state, toasts
├── testing/              # Test utilities, custom render, MSW handlers
│   ├── setup.ts
│   └── utils.tsx
├── types/                # Shared TypeScript types (used by 2+ features)
│   └── api.types.ts
└── utils/                # Shared pure utilities (used by 2+ features)
    ├── cn.ts             # Class name helper (clsx + tailwind-merge)
    └── format.ts
```

**Key decisions at this scale:**
- Features are the unit of organization — all feature code co-locates inside `features/[name]/`
- Only include subfolders a feature actually needs — no empty directories
- `components/` = domain-agnostic UI; `features/[x]/components/` = domain-specific UI
- Global stores in `stores/` only for data that is truly shared across features (UI state, theme)
- `lib/` wraps third-party libraries — makes them swappable and consistently configured

---

## Large Project — Feature-Sliced Design (FSD)

**For:** 10+ developers, 18+ months, multiple teams

```
src/
├── app/                  # FSD app layer: runtime init, providers, styles
│   ├── providers/
│   │   ├── QueryProvider.tsx
│   │   ├── ThemeProvider.tsx
│   │   └── index.ts
│   ├── styles/
│   │   └── globals.css
│   └── config/
│       └── routes.ts
├── pages/                # FSD pages layer: full route-level compositions
│   ├── home/
│   │   ├── ui/
│   │   │   └── HomePage.tsx
│   │   └── index.ts
│   ├── product/
│   │   └── [id]/
│   │       ├── ui/
│   │       │   └── ProductPage.tsx
│   │       └── index.ts
│   └── checkout/
│       └── index.ts
├── widgets/              # FSD widgets layer: large self-contained UI sections
│   ├── header/
│   │   ├── ui/
│   │   │   ├── Header.tsx
│   │   │   └── NavMenu.tsx
│   │   └── index.ts
│   └── product-grid/
│       └── index.ts
├── features/             # FSD features layer: user scenarios with business value
│   ├── auth/
│   │   ├── login/
│   │   │   ├── ui/LoginForm.tsx
│   │   │   ├── model/useLogin.ts
│   │   │   ├── api/loginAction.ts
│   │   │   └── index.ts
│   │   └── logout/
│   │       └── index.ts
│   └── cart/
│       ├── add-to-cart/
│       │   └── index.ts
│       └── remove-from-cart/
│           └── index.ts
├── entities/             # FSD entities layer: business domain objects
│   ├── user/
│   │   ├── model/
│   │   │   ├── types.ts      # User interface
│   │   │   └── userStore.ts  # User state
│   │   ├── ui/
│   │   │   └── UserAvatar.tsx
│   │   ├── api/
│   │   │   └── userApi.ts
│   │   └── index.ts
│   ├── product/
│   │   └── index.ts
│   └── order/
│       └── index.ts
└── shared/               # FSD shared layer: project-agnostic utilities
    ├── ui/               # Design system primitives
    │   ├── button/
    │   │   ├── Button.tsx
    │   │   └── index.ts
    │   └── input/
    │       └── index.ts
    ├── api/              # HTTP client and base request helpers
    │   ├── instance.ts
    │   └── types.ts
    ├── lib/              # Generic utility libraries
    │   ├── cn.ts
    │   ├── format.ts
    │   └── cache/
    └── config/           # App constants, feature flags
        └── index.ts
```

**Key decisions at this scale:**
- FSD layers enforce unidirectional imports: `shared → entities → features → widgets → pages → app`
- Each slice has an `index.ts` public API — no importing from internal files
- `shared/` must remain domain-agnostic — no business logic, no entity references
- `entities/` holds domain objects and their state; `features/` holds user interactions
- `widgets/` = complex UI composed from multiple features and entities

---

## `src/` vs Root Convention

### With `src/` (Recommended)

```
project/
├── src/              # All application code lives here
│   ├── features/
│   └── ...
├── app/              # Next.js routing (when using App Router)
├── public/           # Static public assets
├── tests/            # E2E tests (Playwright)
├── next.config.ts
├── tsconfig.json
└── package.json
```

**When using Next.js App Router:** place `app/` at the root (Next.js requirement), and `src/` holds the FSD architecture. See `nextjs-integration.md` for the routing wrapper pattern.

Benefits of `src/`:
- Clear separation between application code and configuration files at the root
- Root stays clean — only config files live there
- Next.js officially supports `src/` — when present, the `app/` directory can still live at root

### Without `src/` (simpler, small projects)

```
project/
├── app/              # Next.js App Router
├── components/
├── features/
├── lib/
├── public/
└── tsconfig.json
```

Acceptable for small projects where `src/` indirection adds no benefit.

---

## Path Alias Configuration

Direct `../../..` relative imports become maintenance liabilities at scale. Configure path aliases.

### TypeScript (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@/features/*": ["./src/features/*"],
      "@/shared/*": ["./src/shared/*"],
      "@/entities/*": ["./src/entities/*"]
    }
  }
}
```

### Next.js

Next.js reads `tsconfig.json` paths automatically. No additional configuration needed.

### Vite

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
})
```

### Usage

```typescript
// Instead of:
import { UserAvatar } from '../../../entities/user'

// Use:
import { UserAvatar } from '@/entities/user'
```

---

## Folder and File Naming

### Folder Names

| Rule | Example |
|---|---|
| **kebab-case** | `add-to-cart/`, `product-detail/`, `user-settings/` |
| **Singular nouns** for feature/entity names | `auth/`, `cart/`, `user/` — not `carts/` |
| **Plural nouns** for technical containers | `components/`, `hooks/`, `utils/`, `stores/` |
| **No abbreviations** | `authentication/` → `auth/` is OK (widely understood); `btn/` is not |

### File Names

| Type | Convention | Example |
|---|---|---|
| Components | PascalCase | `LoginForm.tsx`, `UserAvatar.tsx` |
| Hooks | camelCase, `use` prefix | `useLogin.ts`, `useUserStore.ts` |
| Utilities | camelCase | `formatDate.ts`, `classNames.ts` |
| Types | camelCase | `user.types.ts`, `auth.types.ts` |
| Stores (Zustand) | camelCase | `authStore.ts`, `cartStore.ts` |
| API functions | camelCase | `userApi.ts`, `productQueries.ts` |
| Index files | always `index.ts` | `index.ts` — never `index.tsx` for public APIs |

---

## State File Placement

State files belong at the **lowest scope** that needs them.

| State type | Where it lives | Example |
|---|---|---|
| Local UI state | Inside the component | `const [open, setOpen] = useState(false)` |
| Feature-scoped state | `features/[x]/stores/` | `features/auth/stores/authStore.ts` |
| Cross-feature state (FSD) | `entities/[domain]/model/` | `entities/user/model/userStore.ts` |
| Global UI state | `shared/stores/` or `stores/` | `stores/uiStore.ts` (sidebar, theme, toasts) |
| Server state | Collocated with API hooks | `features/products/api/useProducts.ts` (React Query) |

**Principle:** State belongs at the lowest level that all its consumers share. Lift only when a second consumer needs it. Lifting to global is the last resort — not the first instinct.
