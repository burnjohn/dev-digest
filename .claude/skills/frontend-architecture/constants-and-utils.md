# Constants & Utils/Helpers

## Constants: Where to Put Them

### Rule 1: Never inside a component if the value is static

Static values recreated on every render waste memory and break `React.memo` on children.

```ts
// BAD — new array reference every render
const Select = () => {
  const OPTIONS = ['A', 'B', 'C'];   // recreated every render
  return <Dropdown options={OPTIONS} />;
};

// GOOD — stable reference, defined once
const OPTIONS = ['A', 'B', 'C'];     // module-level

const Select = () => (
  <Dropdown options={OPTIONS} />
);
```

**Exception:** A constant that depends on `props` or `state` must live inside the component — but prefer deriving it inline rather than assigning to a named constant.

### Rule 2: Inside the component ONLY when it depends on props/state

```ts
// This MUST be inside — it uses `userId`
const Component = ({ userId }: Props) => {
  const endpoint = `/api/users/${userId}`;  // fine here — dynamic
  ...
};
```

### Rule 3: Colocation — global only when 3+ features need it

| Scope | Location |
|---|---|
| Used by 1 component | Top of the component file (above the function) |
| Used by 1 feature | `features/<name>/constants.ts` |
| Used by 2+ features | `constants/<domain>.ts` |
| App-wide config (routes, timeouts, limits) | `constants/app.ts` or `constants/index.ts` |

### Naming Conventions

```ts
// Values — SCREAMING_SNAKE_CASE
const MAX_RETRY_COUNT = 3;
const API_TIMEOUT_MS = 5000;
const DEFAULT_PAGE_SIZE = 20;

// Enum-like string maps — PascalCase object or TS enum
const Role = { Admin: 'admin', Viewer: 'viewer' } as const;
type Role = (typeof Role)[keyof typeof Role];

// Config objects — camelCase
const paginationDefaults = { page: 1, pageSize: 20 };
```

### Global constants file structure

```
src/constants/
  app.ts          ← timeouts, limits, feature flags
  routes.ts       ← route path strings
  api.ts          ← endpoint base paths, keys
  index.ts        ← re-exports selectively
```

---

## Utils vs Helpers: The Distinction

This distinction matters because it drives WHERE the file lives.

| | Utils | Helpers |
|---|---|---|
| **Definition** | Generic, project-agnostic | Project-specific |
| **Reuse** | Could be published as a package; could live in lodash | Makes no sense outside this project |
| **Location** | `src/utils/` | `src/helpers/` or colocated in the feature |
| **Examples** | `formatDate`, `debounce`, `clampNumber`, `slugify` | `formatPrScore`, `deriveReviewStatus`, `buildAgentRunPayload` |

### When to create a util

- Logic is purely functional (in → out, no side effects, no React)
- Could be useful in a different project
- Used across 2+ features

### When to create a helper

- Logic is purely functional but tightly coupled to this project's domain
- References project-specific types, enums, or constants
- Used in 2+ places within the project

### When NOT to extract at all

- The function is used in exactly one place and it's short
- Extracting would require passing 5+ arguments that are already available locally
- The logic is already readable inline

### Utils folder organization

```
src/utils/
  date.ts         ← date formatting, parsing
  string.ts       ← slugify, truncate, capitalize
  number.ts       ← clamp, round, formatCurrency
  array.ts        ← groupBy, sortBy, uniqueBy
  object.ts       ← pick, omit, deepMerge
  url.ts          ← buildQueryString, parseSearchParams
  index.ts        ← selective re-exports
```

**Anti-pattern:** One giant `utils.ts` with 200 unrelated functions.
**Anti-pattern:** `helpers/misc.ts` — "misc" means ownership was never decided.

---

## TypeScript Types & Interfaces

| Scope | Location |
|---|---|
| Types used only in one component | Top of that component file |
| Types shared within a feature | `features/<name>/types.ts` |
| Types shared across features | `types/<domain>.ts` or `types/index.ts` |
| Types derived from Zod schemas | Next to the schema file (using `z.infer<>`) |

```ts
// GOOD — type colocated with its schema
// user.schema.ts
export const UserSchema = z.object({ id: z.string(), name: z.string() });
export type User = z.infer<typeof UserSchema>;
```

---

## Anti-Patterns

| Anti-pattern | Why | Fix |
|---|---|---|
| Constant inside component body (static value) | Re-created every render; breaks `React.memo` | Move to module level |
| Magic strings in JSX | Breaks search/replace; no autocomplete | Extract to named constant |
| One giant `constants.ts` with everything | Hard to tree-shake, hard to navigate | Split by domain |
| `utils/helpers.ts` (mixed purpose) | No clear ownership, grows unboundedly | Split to `utils/` and colocated helpers |
| Shared constant that's only used once | Premature abstraction | Keep it local until it's needed elsewhere |
