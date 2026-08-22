# State Placement

## The Colocation Principle

> **Push state as close to where it's used as possible. Only lift state when you must.**

State that lives closer to its consumer is:
- Easier to understand (no hunting through the tree)
- Faster (fewer re-renders)
- Easier to delete (no ripple effects)

---

## The Decision Ladder

Go down the ladder only when the previous level stops working:

```
1. LOCAL STATE (useState)
   → Component needs it alone, no siblings care

2. LIFTED STATE (prop drilling, ≤ 2 levels)
   → 2-3 sibling components need the same state
   → Passing through 1-2 intermediate components is fine

3. REACT CONTEXT
   → State must cross many levels of the tree
   → The subtree that needs it is bounded (e.g., a feature's component tree)
   → NOT for global app state — Context triggers full subtree re-render

4. ZUSTAND (or Jotai)
   → Truly global state that many features share (auth user, theme, UI config)
   → State that must persist across route changes
   → Complex state with many actions

5. TANSTACK QUERY
   → Any async / server data — ALWAYS use this, never useState + useEffect
```

---

## Level 1: Local State

```tsx
// ✅ Local state stays local — no context, no store
function SearchBar() {
  const [query, setQuery] = useState('')

  return (
    <input
      value={query}
      onChange={e => setQuery(e.target.value)}
      placeholder="Search..."
    />
  )
}
```

**Common mistake:** lifting state "just in case" future siblings need it. Don't. If they never come, you've added complexity for nothing.

---

## Level 2: Lifted State (Prop Drilling)

```tsx
// ✅ Lift to closest common ancestor — 2 levels of drilling is fine
function FilterPanel() {
  const [activeFilter, setActiveFilter] = useState<string | null>(null)

  return (
    <>
      <FilterButtons selected={activeFilter} onSelect={setActiveFilter} />
      <FilteredList filter={activeFilter} />
    </>
  )
}
```

**When to stop drilling:** when you pass props through components that don't use them (just pass them down). That's the signal to consider Context.

---

## Level 3: React Context

Context is for **scoped shared state**, not global state:

```tsx
// ✅ Context scoped to a feature subtree — not the whole app
const DashboardContext = createContext<DashboardState | null>(null)

function DashboardProvider({ children }: { children: ReactNode }) {
  const [selectedTab, setSelectedTab] = useState('overview')
  const [dateRange, setDateRange] = useState(DEFAULT_DATE_RANGE)

  return (
    <DashboardContext value={{ selectedTab, setSelectedTab, dateRange, setDateRange }}>
      {children}
    </DashboardContext>
  )
}

// Wrap only the Dashboard section, not the whole app
function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardProvider>{children}</DashboardProvider>
}
```

**Context anti-patterns:**
- Putting everything in one global `AppContext` — leads to unnecessary re-renders everywhere
- Using Context for server data — use TanStack Query instead
- Creating Context without memoizing the value — rerenders all consumers on every parent render

---

## Level 4: Zustand

Use Zustand for truly global client state. Scope stores via Context to avoid global singletons:

```typescript
// stores/authStore.ts
import { create } from 'zustand'

interface AuthStore {
  user: User | null
  setUser: (user: User | null) => void
  clearUser: () => void
}

export const createAuthStore = () => create<AuthStore>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: null }),
}))
```

```tsx
// ✅ Scope store via Context — avoids global singleton
const AuthStoreContext = createContext<ReturnType<typeof createAuthStore> | null>(null)

export function AuthStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createAuthStore())
  return <AuthStoreContext value={store}>{children}</AuthStoreContext>
}

// ❌ Global singleton — hard to test, shared across all renders
export const useAuthStore = create<AuthStore>(...)
```

**What goes in Zustand:**
- Auth user (after login, before logout)
- UI preferences (theme, sidebar collapsed state)
- Cross-feature notification/toast queue
- Wizard/stepper state that spans multiple routes

**What does NOT go in Zustand:**
- Server data (use TanStack Query)
- Form state (use local state or react-hook-form)
- Component-local UI state (use useState)

---

## Level 5: TanStack Query (Server State)

**Any data that comes from a server → TanStack Query.** Never `useState + useEffect + fetch`:

```typescript
// ❌ Anti-pattern: manual server state
function UserList() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetchUsers().then(data => {
      setUsers(data)
      setLoading(false)
    })
  }, [])
}

// ✅ TanStack Query handles caching, deduplication, loading, errors
function UserList() {
  const { data: users = [], isLoading } = useUsersQuery()
  if (isLoading) return <Skeleton />
  return <ul>{users.map(u => <UserRow key={u.id} user={u} />)}</ul>
}
```

Query keys and hooks live in `features/<name>/api/<name>Queries.ts`.

---

## State Type Summary

| State type | Tool | Location |
|---|---|---|
| Component UI state (toggle, input) | `useState` | Inside component |
| Shared UI state (2-3 siblings) | Lifted + props | Closest common ancestor |
| Feature-scoped shared state | React Context | Feature provider |
| Global client state (auth, theme) | Zustand | stores/ + scoped via Context |
| Server / async data | TanStack Query | features/<name>/api/queries.ts |
| URL state | `useSearchParams`, `useRouter` | Inside component or hook |
| Form state | `useState` or `react-hook-form` | Inside component or form hook |

## Sources

- [State Colocation — Kent C. Dodds](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster)
- [React State Management 2025 — Developer Way](https://www.developerway.com/posts/react-state-management-2025)
- [Zustand and React Context — TkDodo](https://tkdodo.eu/blog/zustand-and-react-context)
- [Practical React Query — TkDodo](https://tkdodo.eu/blog/practical-react-query)
