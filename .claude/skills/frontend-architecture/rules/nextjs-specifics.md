# Next.js App Router — Architecture Decisions

## Server Component vs Client Component

### Default Rule

> **Everything is a Server Component by default. Add `"use client"` only when required.**

Server Components render on the server, emit static HTML, and ship zero JavaScript to the client. Client Components hydrate in the browser.

### When to add `"use client"`

Add `"use client"` only when the component needs:

| Need | Example |
|---|---|
| React state | `useState`, `useReducer` |
| Lifecycle / effects | `useEffect`, `useLayoutEffect` |
| Browser APIs | `window`, `document`, `localStorage`, `navigator` |
| Event handlers that read/write state | `onClick` that calls `setCount` |
| Third-party client-only libraries | Maps, charts, rich text editors |
| Context consumers | Components that call `useContext` |

**Read-only event handlers (e.g., form `action=` pointing to a Server Action) do NOT require `"use client"`.**

### The `"use client"` boundary affects the entire module graph

```tsx
// Button.tsx
'use client'
export function Button({ onClick }: { onClick: () => void }) { ... }

// PageHeader.tsx — imports Button
// ❌ PageHeader is now ALSO a Client Component (it imports a client module)
import { Button } from './Button'
```

**Consequence:** push `"use client"` as deep in the tree as possible. A large layout importing one client component makes the entire layout a client component.

### The children composition pattern (key technique)

Pass Server Components as `children` into Client Components — they stay server-rendered:

```tsx
// ClientShell.tsx
'use client'
export function ClientShell({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setIsOpen(!isOpen)}>Toggle</button>
      {isOpen && children}  {/* ← children are STILL server-rendered */}
    </div>
  )
}

// page.tsx (Server Component)
import { ClientShell } from './ClientShell'
import { HeavyServerData } from '@/features/dashboard'

export default async function Page() {
  return (
    <ClientShell>
      <HeavyServerData />  {/* ← rendered on server, passed as children */}
    </ClientShell>
  )
}
```

---

## Data Fetching in Server Components

In Next.js App Router, **Server Components can access data directly** — no API route needed for internal data:

```tsx
// ✅ Direct database access in Server Component
import { db } from '@/lib/db'

export default async function UsersPage() {
  const users = await db.user.findMany()  // ← direct DB query, no fetch
  return <UserList users={users} />
}

// ✅ Or via typed fetch function (good for separation)
import { fetchUsers } from '@/features/users/api/usersApi'

export default async function UsersPage() {
  const users = await fetchUsers()
  return <UserList users={users} />
}
```

**Parallel data fetching:**
```tsx
export default async function DashboardPage() {
  // ✅ Fetch in parallel — don't await sequentially
  const [stats, recentOrders, notifications] = await Promise.all([
    fetchDashboardStats(),
    fetchRecentOrders(),
    fetchNotifications(),
  ])
  return <Dashboard stats={stats} orders={recentOrders} notifications={notifications} />
}
```

**For Client Components** that need server data → use TanStack Query (not `useEffect + fetch`).

---

## Server Actions

Server Actions are async functions that run on the server, called from Client Component forms/buttons.

### Where to place Server Actions

```
app/
├── lib/
│   └── actions.ts          ← shared Server Actions used across features
└── (dashboard)/
    └── settings/
        └── actions.ts      ← route-specific, OR use feature-colocated:

features/
└── user-profile/
    └── actions.ts          ← feature-specific Server Actions (colocated)
```

**Official examples use `app/lib/actions.ts` for shared actions.**

### Server Action anatomy

```typescript
// app/lib/actions.ts
'use server'  // ← file-level directive: all exports become Server Actions

import { db } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function updateUserProfile(formData: FormData) {
  const name = formData.get('name') as string
  const userId = await getCurrentUserId()  // auth check

  await db.user.update({ where: { id: userId }, data: { name } })

  revalidatePath('/settings/profile')  // ← invalidate cached page
}

export async function deletePost(postId: string) {
  await db.post.delete({ where: { id: postId } })
  redirect('/dashboard/posts')          // ← redirect after mutation
}
```

### Inline Server Action (in Server Components only)

```tsx
// Only valid inside a Server Component — NOT in Client Components
export default function DeleteButton({ postId }: { postId: string }) {
  async function handleDelete() {
    'use server'  // ← inline directive
    await db.post.delete({ where: { id: postId } })
    revalidatePath('/posts')
  }

  return <form action={handleDelete}><button type="submit">Delete</button></form>
}
```

**Use inline only for one-off, simple mutations. Use file-level `'use server'` for anything reused.**

---

## Server Actions vs Route Handlers

| | Server Action | Route Handler (`route.ts`) |
|---|---|---|
| **Caller** | Your own UI (forms, buttons) | External systems, third parties |
| **Method** | Always POST (implicit) | Any HTTP method |
| **Use for** | UI mutations, form submissions | Public APIs, webhooks, large file uploads, streaming |
| **Auth** | Context from session/cookies | Validate request manually |
| **Location** | `app/lib/actions.ts` or `features/<name>/actions.ts` | `app/api/<path>/route.ts` |

```
User clicks "Save" → Server Action ✅
Stripe webhook arrives → Route Handler ✅
External app calls your API → Route Handler ✅
Your UI form submits → Server Action ✅
Large file upload → Route Handler ✅ (streaming support)
```

---

## Route Groups `(folder)`

Route groups organize routes without affecting the URL:

```
app/
├── (marketing)/           ← URL: nothing — just organization
│   ├── layout.tsx         ← Shared layout for marketing pages
│   ├── page.tsx           ← /
│   ├── about/
│   │   └── page.tsx       ← /about
│   └── pricing/
│       └── page.tsx       ← /pricing
└── (dashboard)/           ← Different root layout
    ├── layout.tsx         ← Dashboard shell (sidebar, nav)
    ├── dashboard/
    │   └── page.tsx       ← /dashboard
    └── settings/
        └── page.tsx       ← /settings
```

**Three use cases:**
1. **Organize by domain/team** without affecting URL structure
2. **Multiple root layouts** — each route group can have its own root layout with `<html>/<body>`
3. **Opt routes into shared layout** — only routes inside the group get the layout

**Caveats:**
- Navigating between routes with different root layouts triggers a full page reload
- Two routes in different groups can't resolve to the same URL (build error)

---

## Parallel Routes `@slot`

```
app/dashboard/
├── layout.tsx             ← receives @analytics and @team as props
├── page.tsx               ← main content
├── @analytics/
│   ├── default.tsx        ← required fallback for hard navigation
│   └── page.tsx
└── @team/
    └── page.tsx
```

```tsx
// app/dashboard/layout.tsx
export default function Layout({
  children,
  analytics,
  team,
}: {
  children: ReactNode
  analytics: ReactNode
  team: ReactNode
}) {
  return (
    <div className="dashboard">
      {children}
      <aside>{analytics}</aside>
      <section>{team}</section>
    </div>
  )
}
```

**Use for:** independent sections of a dashboard that load/error independently, or modals with deep-link URLs (combined with intercepting routes).

---

## ⚠️ Breaking Change: Next.js 16

`middleware.ts` was renamed to `proxy.ts` in Next.js 16.0.0.

```bash
# Migrate automatically
npx @next/codemod@canary middleware-to-proxy
```

**Important:** Do NOT rely on `proxy.ts` (or `middleware.ts`) as the sole auth gate. Server Functions called on paths excluded by the proxy matcher also skip the proxy — always verify auth inside each Server Function too.

---

## Sources

- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next.js — Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data)
- [Next.js — Mutating Data](https://nextjs.org/docs/app/getting-started/mutating-data)
- [Next.js — Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)
- [Next.js — Parallel Routes](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes)
- [Next.js — Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- [Next.js — Proxy (Middleware)](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
- [Server Actions vs Route Handlers — Vercel Discussion](https://github.com/vercel/next.js/discussions/72919)
- [Server Actions organization — Vercel Discussion](https://github.com/vercel/next.js/discussions/55908)
- [Next.js Server Actions Guide — MakerKit](https://makerkit.dev/blog/tutorials/nextjs-server-actions)
