# Architecture Anti-Patterns

Answers: **"Is there an architectural problem in this code?"**

Each entry has a symptom (how to recognize it), a problem (why it matters), and a fix.

---

## 1. Cross-Slice Imports

**Symptom:**
```typescript
// features/checkout/hooks/useCheckout.ts
import { useAuthState } from '@/features/auth/hooks/useAuthState'
import { useCartStore } from '@/features/cart/stores/cartStore'
```

**Problem:**
Features are coupled to each other's internals. Changing `auth` or `cart` can break `checkout`. Testing `checkout` requires setting up `auth` and `cart` state. Teams working on different features create merge conflicts. Features cannot evolve independently.

**Fix:**
Compose at the `pages/` or `app/` layer. Pass data down via props. Promote shared domain concepts to `entities/`.

```typescript
// pages/checkout/ui/CheckoutPage.tsx (composition layer)
export async function CheckoutPage() {
  const { user } = await getCurrentUser()           // entities/user
  const { cartItems } = useCartSummary()            // entities/cart (promoted)
  return <CheckoutFlow userId={user.id} items={cartItems} />
}
// CheckoutFlow receives data via props — no knowledge of auth or cart features
```

---

## 2. Shared Junk Drawer

**Symptom:**
```
shared/
├── UserCard.tsx           ← has business logic for users
├── cartHelpers.ts         ← specific to cart feature
├── authTokens.ts          ← specific to auth feature
├── ProductGrid.tsx        ← has product-specific rendering
└── checkoutUtils.ts       ← specific to checkout feature
```

**Problem:**
`shared/` becomes a dumping ground. The layer grows unbounded. Business domain logic leaks into what should be domain-agnostic. "Shared" comes to mean "miscellaneous."

**Fix:**
Enforce the rule: `shared/` must be **domain-agnostic**. If it mentions User, Cart, Product, Order — it belongs in `entities/`, not `shared/`. Move business-domain code to the appropriate `entities/` or `features/` slice.

```
shared/
├── ui/                    # Button, Input, Modal — no business domain
├── lib/
│   ├── cn.ts              # className helper
│   ├── format.ts          # formatDate, formatCurrency — generic
│   └── queryClient.ts     # React Query config
└── api/
    └── instance.ts        # axios instance with base URL

entities/
├── user/                  # UserCard goes here
├── cart/                  # cartHelpers goes here
└── product/               # ProductGrid goes here
```

---

## 3. God Module

**Symptom:**
```typescript
// features/auth/authModule.ts — 900 lines
// Contains: API calls, business rules, state management,
//           UI utilities, validation, token management, permissions
```

**Problem:**
Every auth change requires understanding a single massive file. Tests are large and tightly coupled. Multiple developers cannot work on the feature simultaneously. The file has many reasons to change.

**Fix:**
Split by FSD segment. Each segment has one purpose:

```
features/auth/
├── api/authApi.ts          # HTTP requests only
├── hooks/useAuthState.ts   # React state access
├── services/authService.ts # Business rules and orchestration
├── stores/authStore.ts     # State definition
├── types/auth.types.ts     # Type definitions
└── utils/tokenHelpers.ts   # Pure token operations
```

---

## 4. Shotgun Surgery

**Symptom:**
Adding a new product type requires changes in `components/ProductCard.tsx`, `hooks/useProducts.ts`, `api/productsApi.ts`, `stores/productStore.ts`, `utils/productHelpers.ts`, `pages/ProductsPage.tsx`, `types/product.types.ts` — all in different top-level directories.

**Problem:**
Technical-type folder organization (`components/`, `hooks/`, `api/`) scatters a single feature's code across the entire project. One business change requires 6+ file edits in 6+ directories. Merge conflicts between unrelated features become common.

**Fix:**
Co-locate all files for a feature inside its folder:

```
features/products/
├── api/productsApi.ts
├── components/ProductCard.tsx
├── hooks/useProducts.ts
├── stores/productStore.ts
├── types/product.types.ts
└── utils/productHelpers.ts
```

Now adding a new product type = changes inside one folder.

---

## 5. Barrel File Abuse

**Symptom:**
```typescript
// components/index.ts
export * from './Button'
export * from './Input'
export * from './Modal'
export * from './Table'
// ... 40 more components

// hooks/index.ts
export * from './useAuth'
export * from './useProducts'
// ... 20 more hooks
```

**Problem:**
Every barrel file forces TypeScript to resolve all re-exported modules to build the type map — even when only one symbol is needed. With many nested barrel files, the TypeScript language server becomes noticeably slow. Tree-shaking is impaired because bundlers cannot safely eliminate re-exports from wildcard barrels.

**Fix:**
Barrel files at **module boundaries** only. Never use `export *` — use named re-exports.

```typescript
// ✅ Named re-exports at module boundary
// features/auth/index.ts
export { LoginForm } from './components/LoginForm'
export { useLogin } from './api/useLogin'
export type { AuthUser } from './types/auth.types'

// ❌ Wildcard barrel at every directory level
// components/index.ts
export * from './Button'

// ✅ Inside a module, import directly (no barrel)
import { Button } from './Button'   // not from an index.ts
```

---

## 6. Premature Extraction

**Symptom:**
```typescript
// shared/components/DataDisplay.tsx
// Created to "avoid duplication" between UserCard and ProductCard
interface DataDisplayProps {
  title: string
  subtitle?: string
  image?: string
  badge?: string
  badgeColor?: 'blue' | 'green' | 'red' | 'yellow'
  action?: React.ReactNode
  secondaryAction?: React.ReactNode
  onSelect?: () => void
  variant?: 'compact' | 'expanded' | 'list'
  // ... 15 more props to handle all possible use cases
}
```

**Problem:**
The abstraction was built to serve two consumers with similar but different needs. As requirements diverge, the shared component grows more complex than either consumer alone. As Sandi Metz observed: "The wrong abstraction is worse than duplication."

**Fix:**
Wait for the **third** consumer before extracting. Apply the Rule of Three. When two consumers appear with genuinely identical requirements, extract to `shared/`. When requirements differ, keep separate components and tolerate the duplication.

```typescript
// ✅ Two separate components, honest about their different concerns
// entities/user/ui/UserCard.tsx — user-specific display logic
// entities/product/ui/ProductCard.tsx — product-specific display logic

// Extract only what is genuinely identical:
// shared/ui/Card.tsx — purely structural (padding, border, shadow)
```

---

## 7. Global State as Cross-Feature Bridge

**Symptom:**
```typescript
// stores/crossFeatureStore.ts — used to pass data between features
interface CrossFeatureStore {
  selectedProductId: string | null      // set by features/catalog
  checkoutProductId: string | null      // read by features/checkout
  lastViewedUserId: string | null       // shared between profile + admin features
}
```

**Problem:**
This pattern bypasses FSD import rules without solving the underlying coupling. Features remain coupled — now through implicit state mutations instead of explicit imports. The store's shape is determined by cross-feature needs, not domain concepts. Which feature owns which state becomes unclear.

**Fix:**
```typescript
// ✅ Compose at the pages layer — features don't know about each other
// pages/product-checkout/ui/ProductCheckoutPage.tsx
export async function ProductCheckoutPage({ productId }: { productId: string }) {
  return (
    <>
      <ProductPreview productId={productId} />   {/* features/catalog */}
      <CheckoutForm productId={productId} />      {/* features/checkout */}
    </>
  )
}

// ✅ Or promote to entities if domain-level shared state is needed
// entities/product/model/selectedProduct.ts
// Both features import from entities — no cross-feature dependency
```

---

## 8. Business Logic in Components

**Symptom:**
```typescript
export function OrderSummary({ items }: { items: OrderItem[] }) {
  // ❌ Calculation in component body
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const discount = subtotal > 100 ? subtotal * 0.1 : 0
  const tax = (subtotal - discount) * 0.08
  const total = subtotal - discount + tax

  // ❌ API call directly in component
  async function handleSubmit() {
    await fetch('/api/orders', { method: 'POST', body: JSON.stringify({ items, total }) })
  }

  return <div>...</div>
}
```

**Problem:**
Business rules (discount, tax) cannot be tested without rendering the component. Direct `fetch()` bypasses error handling, loading states, and caching. Component mixes four concerns: calculation, data fetching, state management, rendering.

**Fix:**
```typescript
// ✅ Level 1: Pure functions for calculations
// features/order/utils/orderCalculations.ts
export function calculateOrderTotals(items: OrderItem[]) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const discount = subtotal > 100 ? subtotal * 0.1 : 0
  const tax = (subtotal - discount) * 0.08
  return { subtotal, discount, tax, total: subtotal - discount + tax }
}

// ✅ Level 3: Service for API coordination
// features/order/api/useSubmitOrder.ts
export function useSubmitOrder() {
  return useMutation({
    mutationFn: (data: CreateOrderDto) => ordersApi.create(data),
    onError: (error) => toast.error(error.message),
  })
}

// ✅ Level 4: Component for rendering only
export function OrderSummary({ items }: { items: OrderItem[] }) {
  const totals = calculateOrderTotals(items)
  const { mutate, isPending } = useSubmitOrder()

  return (
    <div>
      <p>Total: {formatCurrency(totals.total)}</p>
      <button onClick={() => mutate({ items, total: totals.total })} disabled={isPending}>
        Place Order
      </button>
    </div>
  )
}
```

---

## 9. Circular Dependencies

**Symptom:**
```
TypeScript Error: Circular dependency detected
features/auth → features/user-profile → features/auth
```

Or: `Maximum call stack exceeded` at module load time.

**Problem:**
Circular dependencies cause unpredictable module initialization order. TypeScript may silently produce `undefined` for circular imports. Testing any module in the cycle requires loading the entire cycle.

**Fix:**
Extract the shared concept to `entities/` or `shared/`:

```typescript
// Both features need User type — move it out of features
// entities/user/model/types.ts
export interface User { id: string; email: string; role: string }

// features/auth → imports from @/entities/user    ✅ (downward)
// features/user-profile → imports from @/entities/user  ✅ (downward)
// No cross-feature dependency — circular dependency eliminated
```

---

## Quick Reference

| Anti-pattern | Signal | Fix |
|---|---|---|
| Cross-slice imports | `features/A` imports from `features/B` | Compose at pages layer; promote to entities |
| Shared junk drawer | Business concepts in `shared/` | Move to `entities/` or `features/` |
| God module | Single file > 300 lines, mixed concerns | Split by FSD segments (api, model, ui, lib) |
| Shotgun surgery | 1 feature change → 6+ files in 6+ directories | Migrate to co-located feature folders |
| Barrel file abuse | `export *` everywhere, nested index files | Named re-exports at boundaries only |
| Premature extraction | Shared component with 15+ props | Wait for 3rd consumer; use composition |
| Global state as bridge | Zustand store with cross-feature data | Composition at pages; promote to entities |
| Business logic in components | Calculations/API calls in JSX-returning functions | Move to utils (pure) or hooks/services |
| Circular dependencies | Module A imports B, B imports A | Extract shared concept to entities/shared |
