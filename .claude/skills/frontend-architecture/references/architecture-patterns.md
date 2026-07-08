# Architecture Patterns

Answers: **"Which architectural pattern should I use for this project?"**

---

## Quick Comparison

| Pattern | Best for | Team | Duration | Complexity |
|---|---|---|---|---|
| **Feature-Based** | Most projects | 1–10 devs | Any | Low–Medium |
| **FSD** | Growing/large apps | 5–20+ devs | 12+ months | Medium–High |
| **Clean Architecture** | Complex domain logic | 5–20+ devs | 18+ months | High |
| **Layered** | Legacy/simple CRUD | 1–5 devs | < 12 months | Low |
| **FSD + Clean hybrid** | Enterprise domain apps | 10+ devs | 24+ months | High |

---

## Feature-Based Architecture (Default Recommendation)

The "Screaming Architecture" principle (Robert Martin): folder names should tell you what the system does (e-commerce, billing, auth) — not what framework it uses (components, hooks, utils).

### Core Principles

- Organize by **business domain**, not by technical type
- Everything for a feature lives **inside that feature folder** (co-location)
- Features communicate only through the **app layer** — never directly with each other
- Unidirectional import flow: `shared → features → app`

### Canonical Structure (Bulletproof React)

```
src/
├── app/              # Routing, providers, root component
├── assets/           # Static files: images, fonts
├── components/       # Shared generic UI (Button, Input, Modal)
├── config/           # Global config, environment variables
├── features/         # Business domain modules
│   └── [feature]/
│       ├── api/      # API requests and React Query hooks
│       ├── components/ # Feature-specific UI components
│       ├── hooks/    # Feature-specific custom hooks
│       ├── stores/   # Feature-scoped state (Zustand slice, etc.)
│       ├── types/    # Feature TypeScript types
│       ├── utils/    # Feature-specific utility functions
│       └── index.ts  # Public API — only export from here
├── hooks/            # Shared custom hooks (used by 2+ features)
├── lib/              # Preconfigured 3rd-party wrappers (axios instance, etc.)
├── stores/           # Global cross-feature state
├── testing/          # Test utilities and mocks
├── types/            # Shared TypeScript types
└── utils/            # Shared utility functions
```

### Key Rules

1. Only include subfolders a feature actually needs — no empty directories
2. Features must NOT import from each other directly
3. Cross-feature composition happens at `app/` level, not inside features
4. Code used by only one feature stays inside that feature

### When to Use

- Default choice for any React project
- 1–10 developers
- Any project duration
- When domain boundaries are clear but not deeply complex

### Advantages

- Low cognitive overhead — easy to find code
- Clear feature ownership for teams
- Domain language in folder names
- Gradual adoption — easy to migrate from technical-type organization

### Disadvantages

- No formal specification of what "feature" means — teams may interpret differently
- No built-in enforcement mechanism without additional tooling
- Cross-feature communication patterns not specified — easy to create ad-hoc imports

---

## Feature-Sliced Design (FSD)

The structured evolution of Feature-Based architecture. FSD v2.1 is the current stable specification.

### The Three Conceptual Levels

**Layers** — 6 standardized layers in strict hierarchical order:

| Layer | Responsibility | Has Slices? |
|---|---|---|
| `app` | Runtime init: routing, providers, global styles | No — uses segments directly |
| `pages` | Full route-level pages | Yes |
| `widgets` | Large self-contained UI sections | Yes |
| `features` | User scenarios with business value (add to cart, login) | Yes |
| `entities` | Business domain objects (User, Product, Order) | Yes |
| `shared` | Project-agnostic utilities and UI primitives | No — uses segments directly |

**Import direction — strictly downward only:**
```
app → pages → widgets → features → entities → shared
```
Higher layers CAN import from lower layers. Same-layer cross-slice imports are PROHIBITED.

**Slices** — business-domain subdivisions within layers (`user`, `product`, `checkout`).

**Segments** — technical subdivisions within slices:
- `ui` — components, formatters, styles
- `api` — server communication, request functions, mappers
- `model` — stores, schemas, interfaces, business logic
- `lib` — reusable utilities internal to the slice
- `config` — configuration and feature flags

### Directory Structure

```
src/
├── app/
│   ├── providers/
│   └── config/
├── pages/
│   ├── home/
│   │   ├── ui/HomePage.tsx
│   │   └── index.ts
│   └── login/
│       ├── ui/LoginPage.tsx
│       └── index.ts
├── widgets/
│   ├── header/
│   │   ├── ui/Header.tsx
│   │   └── index.ts
│   └── product-grid/
│       └── index.ts
├── features/
│   ├── auth/
│   │   ├── login/
│   │   │   ├── ui/LoginForm.tsx
│   │   │   ├── model/useLogin.ts
│   │   │   ├── api/login.action.ts
│   │   │   └── index.ts
│   │   └── logout/
│   │       └── index.ts
│   └── cart/
│       └── add-to-cart/
│           └── index.ts
├── entities/
│   ├── user/
│   │   ├── model/types.ts
│   │   ├── ui/UserAvatar.tsx
│   │   ├── api/user.queries.ts
│   │   └── index.ts
│   └── product/
│       └── index.ts
└── shared/
    ├── ui/
    │   └── button/
    ├── lib/
    │   └── cache/
    └── config/
```

### Cross-Slice Communication Rules

1. Higher layers import from lower layers — never upward
2. Same-layer cross-slice imports are **prohibited**
3. All layers can access `shared`
4. The `@x` notation provides a limited escape hatch for exceptional controlled cross-slice access

### FSD Complexity Checklist

Commit to full FSD only when **4 or more** of these are true:
- [ ] Multiple teams work in the same frontend codebase
- [ ] Features frequently affect each other unexpectedly
- [ ] Business rules need testing without rendering UI
- [ ] Onboarding new developers takes excessive time
- [ ] Refactors are risky because logic is scattered across components
- [ ] The project is expected to run for 18+ months

### When to Use

- Applications with growing complexity (4+ features with real domain interactions)
- Multi-team development where feature ownership matters
- Projects with 18+ month expected lifespan
- When business language should drive the folder structure
- When onboarding time is high and ad-hoc cross-feature dependencies keep appearing

### Advantages

- Uniformity — standardized naming conventions lower onboarding cost
- Isolation — modules can be modified without cascading effects across the codebase
- Business-oriented — folder names match domain language
- Enforcement tooling available (Steiger, ESLint plugins)
- Gradual adoption — start with App + Pages + Shared, add layers as needed

### Disadvantages

- Higher entry barrier — requires experience to apply effectively
- Team discipline required — violations are hard to catch without linting
- `shared/` layer becomes a junk drawer if not managed carefully
- "Blurred feature boundaries" emerge as projects grow without discipline

---

## Clean Architecture (Frontend Adaptation)

Robert Martin's architecture adapted for frontend. Business logic sits at the center, completely independent of React or any framework. The UI is a "detail" — replaceable without affecting business rules.

### The Four Layers (Outer → Inner)

```
[Frameworks & Drivers]   ← React components, JSX, hooks, HTTP clients
  [Interface Adapters]   ← React hooks as DI, MVC presenters
    [Use Cases]          ← Orchestration, port interfaces, business rules
      [Entities/Domain]  ← Pure TypeScript types, pure functions
```

**The Dependency Rule:** Source code dependencies can only point **inward**. Inner layers know nothing about outer layers.

### Directory Structure

```
src/
├── domain/              # Entities — pure TypeScript, no framework
│   ├── user.ts          # User type + pure business functions
│   ├── product.ts
│   └── cart.ts          # addProduct(), totalPrice() — pure functions
├── application/         # Use Cases + Port interfaces
│   ├── ports.ts         # Interface definitions (PaymentService, etc.)
│   ├── checkout.ts      # Use case: orchestrates domain + ports
│   └── authenticate.ts
├── services/            # Adapters — implement ports
│   ├── authAdapter.ts   # Implements AuthService interface
│   └── paymentAdapter.ts
└── ui/                  # Frameworks & Drivers (React)
    ├── components/
    ├── pages/
    └── hooks/           # "Dependency injection" via hooks
```

### When to Use

- Long-lived systems requiring framework independence
- Applications with complex business rules that must be testable without UI
- Teams where the UI framework may be replaced
- Enterprise applications with regulatory or testability requirements
- Frequently paired with FSD: FSD handles the repo structure, Clean Architecture handles the dependency direction within each layer

### Advantages

- Business logic is framework-independent and testable in pure Node.js
- Explicit dependency graph — no hidden coupling
- Supports swapping third-party libraries by only changing adapters

### Disadvantages

- Significant upfront boilerplate
- Steep learning curve — junior developers struggle with interface-first thinking
- Risk of over-engineering simple CRUD applications
- Developer velocity decreases initially

---

## Layered Architecture (Traditional)

Separates the application by technical responsibility into three layers.

```
┌─────────────────────────────────┐
│      Presentation Layer         │  ← React components, pages
├─────────────────────────────────┤
│    Business Logic Layer         │  ← hooks, services, state
├─────────────────────────────────┤
│      Data Access Layer          │  ← API clients, repositories
└─────────────────────────────────┘
```

### Key Failure Mode

Adding a new feature requires touching all three layers simultaneously — `components/`, `hooks/`, `api/`. This "shotgun surgery" becomes painful as the application grows. Technical-type organization optimizes for clarity, not scalability.

### When to Use (Only)

- Small applications (< 50K lines of code)
- 1–3 developers
- Projects with short lifespan (< 12 months)
- Mostly CRUD operations with minimal business logic

### When to Migrate Away

When you notice: one feature change touching 5+ files in different folders, merge conflicts between team members on unrelated features, difficulty finding where a feature's code lives.

---

## Decision Guide

### Step-by-Step Algorithm

```
1. Team size?
   ├── 1–3 devs → Feature-Based (simple)
   └── 4+ devs → continue →

2. Project duration?
   ├── < 12 months → Feature-Based with module enforcement
   └── 12+ months → continue →

3. Domain complexity?
   ├── Mostly CRUD → FSD (features + entities + shared)
   └── Complex rules (fintech, healthcare) → FSD + Clean Architecture hybrid

4. Multiple independent teams?
   ├── No → Monolith with FSD
   └── Yes → Monorepo (Nx/Turborepo) with FSD per app

5. Framework independence a requirement?
   ├── No → FSD or Feature-Based
   └── Yes → Clean Architecture (hexagonal ports/adapters)
```

### Project Scale Matrix

| Scale | Team | Duration | Recommended |
|---|---|---|---|
| Small MVP | 1–3 devs | < 6 months | Feature-Based (simplified) |
| Growing product | 4–10 devs | 6–18 months | Feature-Based + Sheriff enforcement |
| Large application | 10+ devs | 18+ months | FSD |
| Enterprise/domain-heavy | 10+ devs | 24+ months | FSD + Clean Architecture |
| Multiple independent teams | 20+ devs | Long-term | Monorepo + FSD per app |

---

## Compatible Combinations

These patterns compose well and are used together in production:

| Combination | Use when |
|---|---|
| FSD + Atomic Design | Design system within FSD's `shared/ui` layer |
| FSD + Clean Architecture | FSD provides repo structure; Clean Arch provides dependency direction within each layer |
| Feature-Based + Modular (Sheriff) | Lightweight feature organization with enforced boundaries |
| FSD + DDD language | Domain-heavy platforms (fintech, healthcare) |

---

## Enforcement Tools

Architecture without tooling enforcement degrades over time. At 5+ developers, manual enforcement is unreliable.

### Steiger (FSD-specific)
```bash
npm install --save-dev steiger @feature-sliced/steiger-plugin
```
```typescript
// steiger.config.ts
import { defineConfig } from 'steiger'
import fsd from '@feature-sliced/steiger-plugin'

export default defineConfig([...fsd.configs.recommended])
```
Detects: cross-layer imports, cross-slice imports, missing public APIs, bypassed index.ts.

### Sheriff (General TypeScript boundaries)
```typescript
// sheriff.config.ts
import { defineConfig } from '@softarc/sheriff-core'

export default defineConfig({
  tagging: {
    'src/features/<name>': ['feature:<name>'],
    'src/shared/**': ['shared'],
    'src/entities/<name>': ['entity:<name>'],
  },
  depRules: {
    'feature:*': ['shared', 'entity:*'],
    'entity:*': ['shared'],
    shared: [],
  }
})
```

### ESLint `no-restricted-imports`
Lightweight option without additional dependencies:
```json
{
  "no-restricted-imports": ["error", {
    "patterns": [
      "@/features/*/components/*",
      "@/features/*/hooks/*",
      "@/features/*/api/*"
    ]
  }]
}
```

---

## Incremental Adoption Path

Start minimal and evolve only when complexity demands it.

| Stage | When to apply | Change |
|---|---|---|
| 1 | Day 1 | Feature folders: `src/features/` |
| 2 | Second feature | Public APIs: `index.ts` per feature |
| 3 | 3+ features | Shared layer: `src/shared/` or `src/components/` + `src/utils/` |
| 4 | 5+ developers | Import enforcement: Sheriff or ESLint rules |
| 5 | Domain complexity grows | Entities layer (FSD) or domain layer (Clean Architecture) |
| 6 | Multiple teams | Monorepo: Turborepo or Nx |
| 7 | Teams deploy independently | Extract micro-frontends (only when domains are proven stable) |

**Key principle:** Do not jump ahead. Add structure when you experience actual pain — not in anticipation of hypothetical scale. The architecture should emerge from complexity, not be imposed on it.
