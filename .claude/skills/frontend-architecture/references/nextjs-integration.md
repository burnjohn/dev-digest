# Next.js Integration

Answers: **"How do I use FSD or Feature-Based architecture with Next.js App Router?"**

---

## The Core Problem: Naming Conflict

FSD defines a `pages/` layer for route-level compositions. Next.js App Router uses `app/` for routing (replacing the older `pages/` directory). When mixed at the same level, these conventions conflict.

**Solution:** Place Next.js routing in `app/` at the project root and put all FSD architecture inside `src/`. The `app/` directory becomes a **thin routing layer only** — no business logic, no component definitions, only re-exports and metadata.

---

## The `src/` Pattern

```
project/
├── app/                      # Next.js App Router (routing ONLY)
│   ├── (public)/
│   │   ├── page.tsx          # → re-exports from src/pages/home
│   │   └── about/
│   │       └── page.tsx      # → re-exports from src/pages/about
│   ├── (auth)/
│   │   ├── login/
│   │   │   └── page.tsx      # → re-exports from src/pages/login
│   │   └── register/
│   │       └── page.tsx
│   ├── dashboard/
│   │   ├── layout.tsx        # → re-exports from src/widgets/dashboard-layout
│   │   └── page.tsx          # → re-exports from src/pages/dashboard
│   ├── api/                  # Route Handlers (thin wrappers only)
│   │   └── webhooks/
│   │       └── stripe/
│   │           └── route.ts
│   ├── layout.tsx            # Root layout: fonts, providers, global styles
│   └── not-found.tsx
├── src/                      # FSD architecture lives here
│   ├── app/                  # FSD app layer
│   ├── pages/                # FSD pages layer
│   ├── widgets/              # FSD widgets layer
│   ├── features/             # FSD features layer
│   ├── entities/             # FSD entities layer
│   └── shared/               # FSD shared layer
├── middleware.ts             # Must be at project root (Next.js requirement)
├── public/
├── next.config.ts
└── tsconfig.json
```

`middleware.ts` must live at the **project root** — not inside `src/`. This is a Next.js constraint: middleware is processed before file-system routing and cannot be nested in subdirectories.

---

## Thin Routing Wrapper Pattern

Every file inside `app/` is a thin wrapper that delegates to the FSD architecture in `src/`.

```typescript
// app/(public)/page.tsx — 1 line, no logic
export { HomePage as default } from '@/pages/home'
```

```typescript
// app/dashboard/page.tsx
import type { Metadata } from 'next'
export { DashboardPage as default } from '@/pages/dashboard'

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Your personal dashboard',
}
// Metadata stays in app/ — it's a routing concern, not a business concern
```

```typescript
// app/dashboard/layout.tsx
export { DashboardLayout as default } from '@/widgets/dashboard-layout'
```

### The Actual Page Component in FSD

```typescript
// src/pages/dashboard/ui/DashboardPage.tsx
import { MetricsWidget } from '@/widgets/metrics'
import { ActivityFeed } from '@/widgets/activity-feed'
import { useCurrentUser } from '@/entities/user'

export function DashboardPage() {
  const { user } = useCurrentUser()

  return (
    <main>
      <h1>Welcome back, {user.name}</h1>
      <MetricsWidget userId={user.id} />
      <ActivityFeed />
    </main>
  )
}
```

```typescript
// src/pages/dashboard/index.ts
export { DashboardPage } from './ui/DashboardPage'
```

The FSD `pages/` layer only imports from `widgets/` and `entities/` — widgets compose features.

---

## Dynamic Routes

```typescript
// app/products/[id]/page.tsx
import { ProductPage } from '@/pages/product'

interface Props {
  params: Promise<{ id: string }>  // Next.js 15: params is a Promise
}

export default async function Page({ params }: Props) {
  const { id } = await params
  return <ProductPage productId={id} />
}
```

```typescript
// src/pages/product/ui/ProductPage.tsx
interface Props {
  productId: string
}

export function ProductPage({ productId }: Props) {
  // productId comes in as a prop — the page doesn't know about Next.js routing
  const { data: product } = useProduct(productId)
  return <ProductDetail product={product} />
}
```

The FSD `pages/` layer is decoupled from Next.js — the same `ProductPage` component could be used in a non-Next.js context.

---

## Server Actions in FSD

Server Actions (`'use server'`) belong in the FSD architecture, not in `app/`.

### Placement by Scope

| Scope | Location | Example |
|---|---|---|
| Feature-specific action | `features/[x]/api/` | `features/auth/api/loginAction.ts` |
| Entity-level action | `entities/[x]/api/` | `entities/user/api/updateProfile.ts` |
| Cross-feature action | `shared/api/` | `shared/api/uploadFile.ts` |

### Feature-Specific Server Action

```typescript
// features/auth/api/loginAction.ts
'use server'

import { redirect } from 'next/navigation'
import { authService } from '../services/authService'
import { LoginSchema } from '../types/auth.schemas'

export async function loginAction(formData: FormData) {
  const credentials = LoginSchema.parse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  const result = await authService.login(credentials)

  if (!result.success) {
    return { error: result.message }
  }

  redirect('/dashboard')
}
```

```typescript
// features/auth/index.ts
export { loginAction } from './api/loginAction'
export { LoginForm } from './components/LoginForm'
```

The routing layer uses the feature's public API — no Server Action logic lives in `app/`.

### Entity-Level Server Action

For operations on domain objects used by multiple features:

```typescript
// entities/user/api/updateProfile.ts
'use server'

import { revalidatePath } from 'next/cache'
import { userRepository } from '../lib/userRepository'

export async function updateProfileAction(userId: string, data: UpdateProfileDto) {
  await userRepository.update(userId, data)
  revalidatePath('/dashboard/profile')
}
```

---

## Route Handlers in FSD

Route Handlers (`app/api/**/route.ts`) are thin wrappers that delegate to FSD services.

```typescript
// app/api/webhooks/stripe/route.ts
import { stripeWebhookHandler } from '@/features/billing/api/stripeWebhook'

export const POST = stripeWebhookHandler
```

```typescript
// features/billing/api/stripeWebhook.ts
import { type NextRequest, NextResponse } from 'next/server'
import { billingService } from '../services/billingService'

export async function stripeWebhookHandler(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')

  try {
    await billingService.processWebhook(body, signature)
    return NextResponse.json({ received: true })
  } catch {
    return NextResponse.json({ error: 'Webhook failed' }, { status: 400 })
  }
}
```

---

## Auth DAL Placement

Next.js docs recommend a Data Access Layer (DAL) for session verification. In FSD, this belongs in `shared/lib/` or `entities/session/`:

```typescript
// src/shared/lib/dal.ts
import 'server-only'
import { cookies } from 'next/headers'
import { decrypt } from '@/shared/lib/session'

export async function verifySession() {
  const cookie = (await cookies()).get('session')?.value
  const session = await decrypt(cookie)

  if (!session?.userId) {
    redirect('/login')
  }

  return { isAuth: true, userId: session.userId }
}
```

Any Server Component, Server Action, or Route Handler that needs auth imports from this single location — no duplication across features.

---

## Server vs Client Components in FSD

In FSD, `'use client'` belongs at the **leaf level** — on the component that actually needs browser APIs or interactivity. The boundary should be as deep as possible.

### Placement by Layer

| FSD Layer | Typical directive | Reason |
|---|---|---|
| `app/` (FSD) | No directive (Server by default) | Providers use `'use client'` — wrapped in `Providers.tsx` |
| `pages/` | No directive | Pages are async Server Components; pass data to widgets |
| `widgets/` | Mixed | Widgets may be partially interactive |
| `features/` | Often `'use client'` | User interactions are inherently client-side |
| `entities/` | Rarely `'use client'` | Domain types and queries can be server-side |
| `shared/ui/` | No directive | Primitives accept both — consumer adds the directive |

### Push `'use client'` to the Leaves

```typescript
// src/widgets/product-detail/ui/ProductDetail.tsx
// No 'use client' — this is a Server Component
import { ProductInfo } from '@/entities/product'
import { AddToCartButton } from '@/features/cart'  // This has 'use client'

export async function ProductDetail({ productId }: { productId: string }) {
  const product = await fetchProduct(productId)   // server-side fetch

  return (
    <div>
      <ProductInfo product={product} />     {/* Server Component */}
      <AddToCartButton product={product} /> {/* Client Component boundary */}
    </div>
  )
}
```

```typescript
// src/features/cart/components/AddToCartButton.tsx
'use client'

import { useAddToCart } from '../api/useAddToCart'

export function AddToCartButton({ product }: { product: Product }) {
  const { mutate, isPending } = useAddToCart()
  return (
    <button onClick={() => mutate(product.id)} disabled={isPending}>
      {isPending ? 'Adding...' : 'Add to Cart'}
    </button>
  )
}
```

---

## Providers in Next.js

React context providers require `'use client'`. Wrap them in a single `Providers` component in the FSD `app/` layer:

```typescript
// src/app/providers/Providers.tsx
'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/shared/lib/queryClient'
import { ThemeProvider } from '@/shared/ui/theme'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  )
}
```

```typescript
// app/layout.tsx (Next.js routing layer — thin wrapper)
import { Providers } from '@/app/providers'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```
