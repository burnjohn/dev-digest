# Business Logic Placement

Answers: **"Where does this piece of code belong — pure function, hook, service, or component?"**

---

## The Core Principle

> "If you need React Testing Library to test this logic, it's probably in the wrong layer."
>
> — Felix Gerschau, "React Hooks — Separation of Concerns"

Business logic should be testable without a browser, without React, and without rendering anything. The further logic is from UI rendering, the more independently testable and reusable it becomes.

---

## The 4-Level Model

```
Level 1 — Pure Functions (utils/)
     ↑ no React, no side effects, testable with plain Node.js

Level 2 — Custom Hooks (hooks/)
     ↑ React lifecycle, no JSX, testable with renderHook()

Level 3 — Service Functions (services/)
     ↑ orchestration, API calls, business rules, testable with mocks

Level 4 — Components (components/)
     → JSX rendering + event binding ONLY
     → no business logic, no direct API calls
```

---

## Level 1: Pure Functions

**Where:** `features/[x]/utils/` (feature-specific) or `shared/lib/` (shared)

Pure functions take inputs, return outputs, and have zero side effects. They don't import React, don't call APIs, and don't access global state.

```typescript
// features/cart/utils/cartCalculations.ts

export function calculateSubtotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0)
}

export function applyDiscount(subtotal: number, discountPercent: number): number {
  return subtotal * (1 - discountPercent / 100)
}

export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}
```

**Test without React:**
```typescript
test('applyDiscount reduces price by percentage', () => {
  expect(applyDiscount(100, 20)).toBe(80)
})
```

**Use pure functions for:**
- Calculations and math
- String formatting (dates, currency, names)
- Data transformations (mapping API responses to domain types)
- Sorting and filtering arrays
- Input validation logic (the rule, not the React integration)

---

## Level 2: Custom Hooks

**Where:** `features/[x]/hooks/` (feature-specific) or `hooks/` (shared)

Custom hooks encapsulate React lifecycle, state, and context access. They contain React-specific logic but produce no JSX.

```typescript
// features/auth/hooks/useAuthState.ts

export function useAuthState() {
  const user = useAuthStore((state) => state.user)
  const isAuthenticated = user !== null

  const hasRole = useCallback(
    (role: Role) => user?.roles.includes(role) ?? false,
    [user]
  )

  return { user, isAuthenticated, hasRole }
}
```

```typescript
// features/products/hooks/useProductFilters.ts

export function useProductFilters(initialFilters?: Partial<ProductFilters>) {
  const [filters, setFilters] = useState<ProductFilters>({
    category: 'all',
    priceRange: [0, 1000],
    inStock: false,
    ...initialFilters,
  })

  const applyFilter = useCallback(
    (key: keyof ProductFilters, value: unknown) =>
      setFilters((prev) => ({ ...prev, [key]: value })),
    []
  )

  const resetFilters = useCallback(
    () => setFilters({ category: 'all', priceRange: [0, 1000], inStock: false }),
    []
  )

  return { filters, applyFilter, resetFilters }
}
```

**Use custom hooks for:**
- Encapsulating `useState` + `useEffect` + `useCallback` combinations
- Reading from Zustand stores or Context
- Exposing URL state (search params, router)
- Wrapping React Query `useQuery`/`useMutation` with application-specific defaults

**One hook, one concern.** A hook that manages filters, sorting, AND pagination is doing too much. Split it.

---

## Level 3: Service Functions

**Where:** `features/[x]/services/` or `features/[x]/api/`

Services orchestrate multiple operations: call APIs, apply business rules, coordinate between entities. Services do not touch React or JSX.

### Service Layer Pattern

```typescript
// features/checkout/services/checkoutService.ts

export async function processCheckout(
  cartItems: CartItem[],
  paymentInfo: PaymentInfo,
  userId: string,
  deps = { ordersApi, paymentsApi, inventoryApi },
): Promise<CheckoutResult> {
  if (cartItems.length === 0) {
    throw new CheckoutError('EMPTY_CART', 'Cannot checkout with empty cart')
  }

  const subtotal = calculateSubtotal(cartItems)   // Level 1 pure function
  const tax = calculateTax(subtotal, paymentInfo.country)
  const total = subtotal + tax

  const order = await deps.ordersApi.create({ userId, items: cartItems, total })
  const payment = await deps.paymentsApi.charge({ orderId: order.id, amount: total, paymentInfo })

  if (payment.status !== 'success') {
    await deps.ordersApi.cancel(order.id)
    throw new CheckoutError('PAYMENT_FAILED', payment.errorMessage)
  }

  await deps.inventoryApi.reserve(cartItems)
  return { orderId: order.id, total, status: 'confirmed' }
}
```

Business rule ("cancel order if payment fails") is testable without React:
```typescript
test('cancels order when payment fails', async () => {
  const mockDeps = {
    ordersApi: { create: jest.fn().mockResolvedValue({ id: '1' }), cancel: jest.fn() },
    paymentsApi: { charge: jest.fn().mockResolvedValue({ status: 'failed' }) },
    inventoryApi: { reserve: jest.fn() },
  }

  await expect(processCheckout(items, payment, userId, mockDeps))
    .rejects.toThrow('PAYMENT_FAILED')

  expect(mockDeps.ordersApi.cancel).toHaveBeenCalledWith('1')
})
```

### Dependency Injection for Testability

Inject API clients as parameters rather than importing them directly.

```typescript
// ✅ Dependency injection — testable
export async function processCheckout(
  items: CartItem[],
  payment: PaymentInfo,
  userId: string,
  deps = { ordersApi, paymentsApi, inventoryApi },  // production defaults
): Promise<CheckoutResult> { ... }

// ❌ Direct import — hard to test
import { ordersApi } from '@/features/orders/api/ordersApi'
export async function processCheckout(...) {
  const order = await ordersApi.create(...)  // must mock the entire module
}
```

---

## API Layer

**Where:** `features/[x]/api/` (feature API functions) or `shared/api/` (HTTP client setup)

The API layer contains exactly one function per endpoint. No business logic. No data transformation beyond field mapping.

```typescript
// features/products/api/productsApi.ts

const BASE = '/api/products'

export const productsApi = {
  getAll: (filters?: ProductFilters): Promise<Product[]> =>
    apiClient.get(BASE, { params: filters }),

  getById: (id: string): Promise<Product> =>
    apiClient.get(`${BASE}/${id}`),

  create: (data: CreateProductDto): Promise<Product> =>
    apiClient.post(BASE, data),

  update: (id: string, data: UpdateProductDto): Promise<Product> =>
    apiClient.patch(`${BASE}/${id}`, data),

  delete: (id: string): Promise<void> =>
    apiClient.delete(`${BASE}/${id}`),
}
```

**Rules for the API layer:**
- One function per endpoint
- Parameters match the API contract exactly
- Return type is the raw API response type
- No business rules, no conditional logic, no cross-feature calls
- Error handling happens at a higher level (service or hook)

### React Query Integration

Wrap API functions in React Query hooks inside the same `api/` folder:

```typescript
// features/products/api/useProducts.ts

export function useProducts(filters?: ProductFilters) {
  return useQuery({
    queryKey: ['products', filters],
    queryFn: () => productsApi.getAll(filters),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: productsApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  })
}
```

---

## Level 4: Components

**Where:** `features/[x]/components/`

Components are responsible for **rendering and event binding only**.

```typescript
// features/cart/components/CartItem.tsx

interface CartItemProps {
  item: CartItem
  onQuantityChange: (id: string, quantity: number) => void
  onRemove: (id: string) => void
}

export function CartItem({ item, onQuantityChange, onRemove }: CartItemProps) {
  const { formattedPrice, isOutOfStock } = useCartItemDisplay(item)  // hook

  return (
    <div className="cart-item">
      <img src={item.imageUrl} alt={item.name} />
      <span>{item.name}</span>
      <span>{formattedPrice}</span>
      <QuantitySelector
        value={item.quantity}
        onChange={(qty) => onQuantityChange(item.id, qty)}
        disabled={isOutOfStock}
      />
      <button onClick={() => onRemove(item.id)}>Remove</button>
    </div>
  )
}
```

**Rules for components:**
- No `fetch()` or API calls directly in component bodies
- No complex conditionals that implement business rules
- No direct store access in leaf components — use hooks
- Props carry data and event callbacks, not services or stores

---

## Placement Decision Table

| Code type | Has side effects? | Uses React? | Produces JSX? | Goes in |
|---|---|---|---|---|
| Calculation, formatting, validation logic | No | No | No | `utils/` |
| React state, lifecycle, context access | Maybe | Yes | No | `hooks/` |
| API calls, business orchestration | Yes | No | No | `services/` or `api/` |
| UI rendering, event binding | Yes | Yes | Yes | `components/` |
| Domain object type + pure operations | No | No | No | `entities/[x]/model/` |

### Quick Diagnostic

1. **Can I test this in plain Node.js?** → `utils/` or `services/`
2. **Does it use `useState`, `useEffect`, or any React hook?** → `hooks/`
3. **Does it make network requests or orchestrate multiple operations?** → `services/` or `api/`
4. **Does it return JSX?** → `components/`
5. **Is it a business domain concept (User, Product, Order)?** → `entities/[domain]/model/`
