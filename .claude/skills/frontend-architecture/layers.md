# Layers & Component Splitting

## The Three-Layer Model

Every React app has three logical layers. Keep them separated — mixing them is the #1 cause of unmaintainable code.

```
┌─────────────────────────────────────┐
│  UI Layer                           │  React components — renders props, no logic
│  (components, JSX)                  │  "What does this look like?"
├─────────────────────────────────────┤
│  Application Layer                  │  Custom hooks — state, side effects, data fetching
│  (hooks)                            │  "How does this work?"
├─────────────────────────────────────┤
│  Business Layer                     │  Pure functions — rules, calculations, formatting
│  (utils, helpers, services)         │  "What does this mean?"
└─────────────────────────────────────┘
```

### UI Layer — Components

- Receives props, renders JSX, handles events by delegating up
- MUST NOT contain: API calls, complex conditionals, data transformation
- Can call hooks; MUST NOT contain hook logic inline
- Max ~200 lines; max ~7 props

### Application Layer — Custom Hooks

- Owns `useState`, `useEffect`, `useReducer`, `useCallback`, data fetching
- Returns state + callbacks to components
- MUST NOT return JSX — if it does, it's a component, not a hook
- Prefix: always `use*`

### Business Layer — Pure Functions

- Input → Output, no side effects, no React imports
- Business rules: calculations, validation, formatting, data mapping
- Independently testable without rendering
- Typical filenames: `format.ts`, `validate.ts`, `calculate.ts`, `<domain>.utils.ts`

---

## When to Split a Component

### Signals that you MUST split

| Signal | Action |
|---|---|
| You say "and" when describing what the component does | Split on the "and" |
| Component is >200 lines | Extract logical sections |
| >7 props | The component does too much; extract sub-components |
| Same JSX block copy-pasted | Extract into a reusable component |
| `useEffect` + local state + API call + rendering all in one | Container/Presenter split |
| A section of JSX conditionally shows/hides complex UI | Extract into its own component |

### Signals NOT to split

| Signal | Action |
|---|---|
| Component is small but you "feel" it could be broken up | Leave it — premature abstraction |
| Two components would share all the same props | Keep together or reconsider the abstraction |
| Extraction would create a component used in only one place with no reuse | Inline it |

### The "and" test

> If you can describe a component using the word "and", it violates Single Responsibility.

- "This component **fetches** data **and** renders a list" → split into container + list
- "This component **validates the form** **and** shows a success screen" → split into two

---

## Container / Presenter Pattern

Use when a component fetches data AND renders it. Split into:

- **Container** (`*Container.tsx` or just the page): fetches, handles loading/error/empty, passes data down
- **Presenter** (`*View.tsx` or named by content): receives complete data as props, pure rendering

```
features/users/
  components/
    UserList.tsx           ← Presenter: receives users[], renders
    UserListContainer.tsx  ← Container: fetches, handles states, renders UserList
```

**Rule:** Presenters are easy to test (no mocks needed) and easy to reuse. Containers are thin coordinators.

---

## Custom Hook vs Service vs Pure Function

| Scenario | Solution |
|---|---|
| Logic needs `useState` or `useEffect` | Custom hook (`useX.ts`) |
| Logic is reused across 2+ components | Custom hook or shared util, depending on whether it uses React |
| API calls for a domain (users, payments) | Service/api file (`users.api.ts`) |
| Calculation, formatting, mapping — no React | Pure function in `utils/` or `helpers/` |
| Single-use logic inside one component | Keep inside the component (don't extract prematurely) |

### When to create a custom hook

- Stateful logic shared across 2+ components
- Complex `useEffect` with cleanup that would clutter the component
- Data fetching + loading/error state management

### When NOT to create a custom hook

- You'd extract a hook used only in one place with no clear reuse path
- The logic is pure (no state, no effects) — use a plain function instead
- The hook just wraps a single `useState` call with no additional logic

---

## Component Size Limits

These are heuristics, not hard rules. Treat violations as code smells, not errors.

| Metric | Target | Red flag |
|---|---|---|
| Lines of JSX | < 100 | > 200 |
| Props count | ≤ 5 | > 7 |
| State variables | ≤ 3 | > 5 |
| `useEffect` calls | ≤ 2 | > 3 |
| Nesting depth in JSX | ≤ 4 levels | > 6 levels |
