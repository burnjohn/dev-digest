# Component Splitting

## The Core Test (SRP)

> **If you use the word "and" to describe what a component does — split it.**

"This component fetches data **and** renders a list **and** handles the empty state" → three responsibilities → split.

## Six Criteria for Splitting

Split a component when it fails any of these:

| Criterion | Question | Split when... |
|---|---|---|
| **Single Responsibility** | Does it do one thing? | You need "and" to describe it |
| **Complexity** | Is it easy to read top to bottom? | >150 lines, deeply nested JSX |
| **Reuse** | Is this UI/logic needed elsewhere? | Same pattern appears in 2+ places |
| **Testability** | Can you test it in isolation? | Must mock unrelated setup to test one behaviour |
| **Readability** | Can a teammate understand it in 30s? | Requires scrolling to understand the render |
| **Ownership** | Belongs to one domain? | Mix of auth + dashboard + billing concerns |

## Composition over Extraction

Before extracting a child component, try composition patterns:

```tsx
// ❌ Don't extract just to reduce lines — this creates tight coupling
function UserCard() {
  return <div><UserCardAvatar /><UserCardName /><UserCardBio /></div>
}

// ✅ Use children/slots — keeps layout flexible, avoids prop drilling
function Card({ header, body, footer }: { header: ReactNode; body: ReactNode; footer?: ReactNode }) {
  return (
    <div className="card">
      <div className="card-header">{header}</div>
      <div className="card-body">{body}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </div>
  )
}

// Consumer controls content without tight coupling
<Card
  header={<UserAvatar user={user} />}
  body={<UserBio bio={user.bio} />}
  footer={<UserActions userId={user.id} />}
/>
```

## Container / Presentational (when to use in 2025)

This pattern is still useful — but hooks replace the class-based version:

```tsx
// Presentational — pure display, no data fetching, easy to test/Storybook
function UserList({ users, onSelect }: { users: User[]; onSelect: (id: string) => void }) {
  if (!users.length) return <EmptyState message="No users found" />
  return (
    <ul>
      {users.map(user => <UserRow key={user.id} user={user} onSelect={onSelect} />)}
    </ul>
  )
}

// Container — owns data fetching and state, thin render
function UserListContainer() {
  const { data: users = [], isLoading } = useUsersQuery()
  const { mutate: selectUser } = useSelectUser()

  if (isLoading) return <Skeleton />
  return <UserList users={users} onSelect={selectUser} />
}
```

**When to use:** When the presentational component needs to be reused in multiple contexts (dashboard, modal, sidebar) with different data sources.

**When NOT to use:** For one-off components that will never be reused — the abstraction costs more than it saves.

## Compound Components

Use when multiple components share implicit state and always appear together:

```tsx
// Tabs that share selected state internally
<Tabs defaultValue="profile">
  <Tabs.List>
    <Tabs.Trigger value="profile">Profile</Tabs.Trigger>
    <Tabs.Trigger value="billing">Billing</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="profile"><ProfileForm /></Tabs.Panel>
  <Tabs.Panel value="billing"><BillingForm /></Tabs.Panel>
</Tabs>
```

The `Tabs` parent holds state; children access it via context. Each sub-component is individually importable and testable.

## Practical Splitting Heuristics

```
Component is > 150 lines?           → probably needs splitting
Component has > 4 props?            → check if it has too many concerns
Component has useEffect + state 
+ event handlers all together?      → extract logic to a custom hook first
Component renders 3+ distinct UI 
sections (header, list, footer)?    → consider splitting or slots
You've copy-pasted JSX from 
another component?                  → extract shared component
```

## What NOT to Split

- Don't split just to hit an arbitrary line count limit
- Don't split when the pieces are meaningless in isolation
- Don't add abstraction for hypothetical future reuse — wait for the second use case
- Don't extract a component whose only purpose is to reduce parent file length

## Colocation of Subcomponents

If a subcomponent is only used by one parent:

```
features/
└── user-profile/
    ├── UserProfile.tsx           # Main component
    ├── UserProfileAvatar.tsx     # Used only by UserProfile → stays here
    ├── UserProfileStats.tsx      # Used only by UserProfile → stays here
    └── index.ts
```

Move to `components/ui/` only when a second consumer appears.

## Sources

- [Six Pillars of Component Architecture](https://medium.com/@abbas-roholamin/splitting-a-ui-into-components-in-react-six-pillars-of-component-architecture-04538e542ce5)
- [SRP in React](https://dev.to/mikhaelesa/single-responsibility-principle-in-react-10oc)
- [React Design Patterns — LogRocket](https://blog.logrocket.com/react-design-patterns/)
- [Compound Pattern — patterns.dev](https://www.patterns.dev/react/compound-pattern/)
- [Component Composition Guide](https://makersden.io/blog/guide-on-react-component-composition)
