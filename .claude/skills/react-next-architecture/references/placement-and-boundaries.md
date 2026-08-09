# Placement and module boundaries

## Contents

- Ownership model
- Default structure
- Placement table
- Colocation and promotion
- Dependency direction and public APIs
- Constants, helpers, and schemas
- Component extraction

## Ownership model

Classify every artifact by the narrowest stable owner:

1. Route subtree
2. Product feature/capability
3. Stable domain entity shared by features
4. Business-neutral shared capability
5. Cross-feature server infrastructure

Do not choose a folder by file type alone. Files that change for the same product reason should live together.

## Default structure

Use this as a starting point, not a completeness checklist:

```text
src/
  app/                         # route and composition ownership
    (group)/route/
      page.tsx
      loading.tsx
      error.tsx
      _components/             # private to this route subtree
      _lib/
  features/
    review-pr/
      ui/
      model/                   # rules, transitions, selectors, types
      api/                     # adapters, queries, commands, query keys
      server/                  # feature-owned server-only access
      config/
      index.ts                 # deliberate cross-boundary API if needed
  entities/                    # optional stable domain concepts
  shared/
    ui/                        # business-neutral UI primitives
    lib/                       # focused capabilities: dates/, money/, text/
    config/
  server/                      # genuinely cross-feature server-only DAL/auth
```

Delete unused layers. Do not add `entities/`, top-level `server/`, or public barrels merely for symmetry.

## Placement table

| Artifact | Default owner | Avoid |
|---|---|---|
| `page`, `layout`, `loading`, `error`, `not-found`, `template`, metadata | Matching `app/` segment | Hiding framework conventions |
| One-route component/helper | Route `_components/` or `_lib/` | Publishing it as shared preemptively |
| Domain-aware UI or workflow | `features/<feature>/ui` | Putting business status rules in shared UI |
| Pure business rule/state transition | Feature/entity `model` | Naming it a generic utility or embedding it in JSX |
| Feature endpoint/query/DTO mapper | Feature `api` | A global API grab bag |
| Feature-only server access | Feature `server` | Importing it into a client module |
| Cross-feature DAL/auth/repository | Top-level `server` | Raw records escaping to the UI |
| Business-neutral primitive | `shared/ui/<component>` | Domain IDs, fetching, or authorization |
| Generic pure helper | Beside its consumer, then focused `shared/lib/<capability>` | `utils.ts` or `helpers.ts` dumping grounds |
| Runtime schema | The I/O boundary that receives unknown data | Treating TypeScript as runtime validation |
| Test/story/style | Beside its owner | Central folders organized only by file type |

## Colocation and promotion

Use colocation first:

1. Keep a private artifact beside its only consumer.
2. Promote it to feature scope when the feature has multiple consumers.
3. Promote it to shared scope only when it is business-neutral, reused across features, and has a stable contract.

Duplication count alone is not a promotion rule. Two similar fragments may encode different product concepts. Prefer a little removable duplication to a shared abstraction whose parameters leak every consumer's differences. [A09–A11]

## Dependency direction and public APIs

Use this default import direction:

```text
app ──imports──> features ──imports──> entities (optional) ──imports──> shared
server-side owners ──imports──> server-only infrastructure
```

- Allow a layer to import only lower, business-neutral layers and its declared server adapters.
- Prevent feature-to-feature private imports. Compose features in `app/` or extract a stable lower-level concept.
- Use relative imports inside a feature/slice.
- Use an explicit public API across boundaries when it materially hides internals.
- Avoid wildcard exports and mega-barrels. They obscure ownership, widen contracts, and invite cycles.
- Enforce high-value boundaries with ESLint `no-restricted-imports`, Nx module-boundary rules, or equivalent checks. [A03–A06]

## Constants, helpers, and schemas

- Keep a single-use constant at module scope beside its consumer.
- Put feature policy, workflow states, and business limits in feature `model` or `config`.
- Put routes, public flags, and application configuration in app/shared config.
- Keep secrets in server-only configuration.
- Put design tokens in the theme/design-system boundary.
- Keep pure domain calculations in the domain model even when their syntax looks generic.
- Use custom hooks only for reusable React state/lifecycle/context behavior; use ordinary functions for pure logic.
- Put parsers, validators, mappers, and serializers at the boundary whose external data they interpret.
- Use `as const` or `satisfies` when it preserves a useful constant contract; do not export every literal.

## Component extraction

Extract when the new boundary has at least one concrete responsibility:

- Independent state or event workflow
- Distinct product concept or reason to change
- Reusable visual/behavioral contract
- Independent test/story contract
- Server/Client, Suspense, or error boundary
- Pure calculation or transition that can leave JSX
- Composition API that removes combinatorial boolean modes

Do not use line, prop, branch, or “used twice” counts as correctness rules. Use size only as a prompt to inspect responsibility. Reject one-use wrappers that merely rename markup or forward every local variable as props.
