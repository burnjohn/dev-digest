# Business Logic Placement

## The Core Rule

> **Zero business logic in JSX.** Components render; hooks compute; services fetch.

A component body should contain only:
- Calling hooks to get data/actions
- JSX to render that data
- Event handlers that call actions (not implement them)

```tsx
// ❌ Business logic inside component — hard to test, hard to reuse
function CheckoutButton({ cartItems }: { cartItems: CartItem[] }) {
  const [loading, setLoading] = useState(false)

  async function handleCheckout() {
    setLoading(true)
    const total = cartItems.reduce((sum, item) => sum + item.price * item.qty, 0)
    const discount = total > 100 ? total * 0.1 : 0
    const finalTotal = total - discount

    await fetch('/api/checkout', {
      method: 'POST',
      body: JSON.stringify({ items: cartItems, total: finalTotal }),
    })
    setLoading(false)
    router.push('/order-confirmation')
  }

  return <button onClick={handleCheckout} disabled={loading}>Checkout</button>
}

// ✅ Logic extracted — component only renders
function CheckoutButton({ cartItems }: { cartItems: CartItem[] }) {
  const { checkout, isPending } = useCheckout(cartItems)
  return <button onClick={checkout} disabled={isPending}>Checkout</button>
}
```

---

## Three-Layer Model

```
┌─────────────────────────────────────────────┐
│  PRESENTATION LAYER (components/)           │
│  • Renders UI                               │
│  • Calls hooks for data and actions         │
│  • No calculations, no fetch, no transforms │
└──────────────────┬──────────────────────────┘
                   │ calls
┌──────────────────▼──────────────────────────┐
│  BUSINESS LOGIC LAYER (hooks/)              │
│  • Custom hooks orchestrate domain logic    │
│  • Calls API layer to fetch/mutate data     │
│  • Transforms/validates data before render  │
│  • Manages local UI state                   │
└──────────────────┬──────────────────────────┘
                   │ calls
┌──────────────────▼──────────────────────────┐
│  INFRASTRUCTURE LAYER (api/, services/)     │
│  • Typed fetch functions (no React)         │
│  • API client, storage, analytics           │
│  • DTOs / data transformations              │
│  • No business rules — just I/O             │
└─────────────────────────────────────────────┘
```

---

## Layer 1: Presentation (Components)

```tsx
// components render, nothing more
function OrderSummary() {
  const { items, total, discount, canCheckout } = useOrderSummary()

  return (
    <section>
      <ItemList items={items} />
      <DiscountBadge discount={discount} />
      <TotalDisplay total={total} />
      <CheckoutButton disabled={!canCheckout} />
    </section>
  )
}
```

---

## Layer 2: Business Logic (Custom Hooks)

Business logic lives in hooks. Hooks compose smaller hooks:

```typescript
// features/checkout/hooks/useOrderSummary.ts
export function useOrderSummary() {
  const { data: cart } = useCartQuery()
  const { data: user } = useCurrentUser()

  const items = cart?.items ?? []
  const subtotal = calculateSubtotal(items)      // pure util
  const discount = getApplicableDiscount(user, subtotal)  // pure util
  const total = subtotal - discount

  return {
    items,
    subtotal,
    discount,
    total,
    canCheckout: items.length > 0 && !!user,
  }
}
```

### Hook naming conventions

| Pattern | Example | When |
|---|---|---|
| `useEntity` | `useUser`, `useCart` | Access to entity data |
| `useEntityAction` | `useLogin`, `useCheckout` | Mutations and operations |
| `useFeatureName` | `useOrderSummary` | Feature-level orchestration |

**Anti-pattern — the "God Hook":**
```typescript
// ❌ One hook that does everything
function useCheckoutPage() {
  // fetch user + cart + products + shipping options
  // calculate totals + discounts + taxes
  // manage form state + validation
  // handle submission + error states
  // track analytics
}

// ✅ Composed smaller hooks
function useCheckoutPage() {
  const cart = useCart()
  const pricing = useOrderPricing(cart.items)
  const form = useCheckoutForm()
  const { submit, isPending } = useSubmitOrder()
  return { cart, pricing, form, submit, isPending }
}
```

---

## Layer 3: Infrastructure (API / Services)

```typescript
// features/checkout/api/checkoutApi.ts
// Pure async functions — no React, no hooks, no state
import apiClient from '@/lib/apiClient'
import type { OrderRequest, Order } from '../types'

export async function submitOrder(request: OrderRequest): Promise<Order> {
  return apiClient.post<Order>('/orders', request)
}

export async function fetchOrderHistory(userId: string): Promise<Order[]> {
  return apiClient.get<Order[]>(`/users/${userId}/orders`)
}
```

```typescript
// features/checkout/api/checkoutQueries.ts
// TanStack Query hooks — thin wrappers around API functions
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { submitOrder, fetchOrderHistory } from './checkoutApi'

export function useOrderHistory(userId: string) {
  return useQuery({
    queryKey: ['orders', userId],
    queryFn: () => fetchOrderHistory(userId),
  })
}

export function useSubmitOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: submitOrder,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  })
}
```

---

## Data Transformations (DTOs)

Never pass raw API responses directly to components. Transform at the boundary:

```typescript
// features/user/api/userApi.ts

// API response shape (what the server sends)
type UserDTO = {
  user_id: string
  full_name: string
  created_at: string    // ISO string
  is_active: number     // 0 or 1
}

// Domain shape (what the app uses)
type User = {
  id: string
  name: string
  createdAt: Date
  isActive: boolean
}

function transformUser(dto: UserDTO): User {
  return {
    id: dto.user_id,
    name: dto.full_name,
    createdAt: new Date(dto.created_at),
    isActive: dto.is_active === 1,
  }
}

export async function fetchUser(id: string): Promise<User> {
  const dto = await apiClient.get<UserDTO>(`/users/${id}`)
  return transformUser(dto)    // ← transform here, not in hooks or components
}
```

---

## Server Actions (Next.js)

In Next.js, Server Actions replace some infrastructure layer code for mutations. They still follow the same separation principle:

```typescript
// app/lib/actions.ts — shared server actions
'use server'
import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'

// Server Action = mutation function on the server
// Keep business logic minimal here — delegate to domain functions
export async function createPost(formData: FormData) {
  const title = formData.get('title') as string
  const content = formData.get('content') as string

  // Validate using domain logic (imported pure function)
  const validatedData = validatePostInput({ title, content })

  await db.post.create({ data: validatedData })
  revalidatePath('/dashboard/posts')
}
```

## Sources

- [profy.dev — React Architecture Series](https://profy.dev/article/react-architecture-api-layer-and-fetch-functions)
- [Separating Business Logic from Components](https://asrulkadir.medium.com/why-separating-business-logic-from-components-matters-in-react-applications-5dbe2c71a2ba)
- [3-Layer Model](https://www.dhiwise.com/post/mastering-the-art-of-separating-ui-and-logic-in-react)
- [Clean Architecture for React Apps](https://osmancea.medium.com/clean-architecture-for-react-apps-c65e2d469418)
- [React Official — Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks)
