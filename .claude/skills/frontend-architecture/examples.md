# Frontend Architecture — Code Examples

Annotated good/bad patterns. Each example maps to a rule in the skill files.

---

## Folder Structure: Colocation vs Premature Sharing

```
// BAD — everything dumped in global components/ from day 1
src/
  components/
    LoginForm.tsx       ← only used by auth
    PaymentForm.tsx     ← only used by checkout
    UserCard.tsx        ← only used by profile
    Button.tsx          ← used everywhere ← this one belongs here

// GOOD — colocated, promote when a second consumer appears
src/
  features/
    auth/
      components/
        LoginForm.tsx   ← lives where it's used
    checkout/
      components/
        PaymentForm.tsx
    profile/
      components/
        UserCard.tsx
  components/
    ui/
      Button.tsx        ← shared only because multiple features use it
```

---

## Feature Self-Containment

```ts
// BAD — feature imports from another feature
// features/checkout/components/CheckoutSummary.tsx
import { UserCard } from '../profile/components/UserCard'; // ❌ cross-feature

// GOOD — shared UI moves to components/
// components/ui/UserCard.tsx  ← promoted when checkout needed it too
import { UserCard } from '@/components/ui/UserCard'; // ✓ from shared layer
```

---

## Three Layers: Splitting Logic from UI

```tsx
// BAD — all three layers mixed in one component
const OrderList = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/orders')
      .then(r => r.json())
      .then(data => {
        // Business logic inline:
        const sorted = data.sort((a, b) => b.total - a.total);
        const withLabel = sorted.map(o => ({
          ...o,
          label: o.total > 100 ? 'Large' : 'Small',
        }));
        setOrders(withLabel);
        setLoading(false);
      });
  }, []);

  if (loading) return <Spinner />;
  return (
    <ul>
      {orders.map(o => (
        <li key={o.id}>{o.label}: ${o.total}</li>
      ))}
    </ul>
  );
};

// GOOD — three clear layers

// Business layer: pure function (utils/order.utils.ts)
export function enrichOrders(orders: Order[]) {
  return orders
    .sort((a, b) => b.total - a.total)
    .map(o => ({ ...o, label: o.total > 100 ? 'Large' : 'Small' }));
}

// Application layer: hook (hooks/useOrders.ts)
export function useOrders() {
  const [orders, setOrders] = useState<EnrichedOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/orders')
      .then(r => r.json())
      .then(data => { setOrders(enrichOrders(data)); setLoading(false); });
  }, []);

  return { orders, loading };
}

// UI layer: component (components/OrderList.tsx)
const OrderList = () => {
  const { orders, loading } = useOrders();
  if (loading) return <Spinner />;
  return (
    <ul>
      {orders.map(o => <li key={o.id}>{o.label}: ${o.total}</li>)}
    </ul>
  );
};
```

---

## Container / Presenter Split

```tsx
// Container — data responsibility
const UserProfileContainer = () => {
  const { data: user, isLoading, isError } = useUser(userId);
  if (isLoading) return <Skeleton />;
  if (isError) return <ErrorMessage />;
  if (!user) return <EmptyState />;
  return <UserProfileView user={user} />;
};

// Presenter — rendering responsibility (easily tested, no mocks)
const UserProfileView = ({ user }: { user: User }) => (
  <div>
    <h1>{user.name}</h1>
    <p>{user.email}</p>
  </div>
);
```

---

## When to Split — The "And" Test

```tsx
// BAD — component does TWO things
const Dashboard = () => {
  // Fetches AND renders analytics AND renders user info
  const { analytics } = useAnalytics();
  const { user } = useUser();
  return (
    <div>
      <section>{/* 80 lines of analytics UI */}</section>
      <section>{/* 60 lines of user UI */}</section>
    </div>
  );
};

// GOOD — split on the "and"
const Dashboard = () => (
  <div>
    <AnalyticsPanel />   {/* owns analytics data + UI */}
    <UserPanel />        {/* owns user data + UI */}
  </div>
);
```

---

## Constants: Inside vs Outside Component

```tsx
// BAD — static array recreated every render, breaks React.memo on Tabs
const Navigation = () => {
  const TABS = ['Overview', 'Activity', 'Settings'];   // ❌ inside
  return <Tabs items={TABS} />;
};

// GOOD — stable reference
const TABS = ['Overview', 'Activity', 'Settings'];     // ✓ module-level

const Navigation = () => <Tabs items={TABS} />;

// CORRECT exception — value depends on props (must be inside)
const UserNav = ({ role }: { role: Role }) => {
  const tabs = role === 'admin'
    ? ['Overview', 'Activity', 'Settings', 'Admin']
    : ['Overview', 'Activity'];
  return <Tabs items={tabs} />;
};
```

---

## Utils vs Helpers

```ts
// utils/date.ts — GENERIC: could be published as an npm package
export function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

// features/reviews/helpers/review.helpers.ts — PROJECT-SPECIFIC: references domain types
import type { Finding } from '../types';

export function countBlockers(findings: Finding[]): number {
  return findings.filter(f => f.severity === 'CRITICAL' && f.grounded).length;
}

export function deriveScore(findings: Finding[]): number {
  const blockers = countBlockers(findings);
  return Math.max(0, 100 - blockers * 15);
}
```

---

## Barrel File: Public API vs Leaking Everything

```ts
// features/auth/index.ts

// BAD — exports internal implementation details
export * from './components/LoginForm';
export * from './hooks/useAuth';
export * from './utils/password-validator'; // internal detail leaked

// GOOD — selective public surface
export { LoginForm } from './components/LoginForm';
export { useAuth } from './hooks/useAuth';
export type { AuthUser, AuthState } from './types';
// password-validator stays internal — not exported
```

---

## Service/API File Organization

```ts
// features/users/api/users.api.ts
import { apiClient } from '@/lib/api-client';
import type { User, CreateUserPayload } from '../types';

export const usersApi = {
  getAll: () => apiClient.get<User[]>('/users'),
  getById: (id: string) => apiClient.get<User>(`/users/${id}`),
  create: (payload: CreateUserPayload) => apiClient.post<User>('/users', payload),
  delete: (id: string) => apiClient.delete(`/users/${id}`),
};

// hooks/useUsers.ts — consumes the service, owns the state
export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: usersApi.getAll });
}
```
