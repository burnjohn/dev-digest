# Architecture review and implementation checklist

## Before deciding

1. Read the nearest `AGENTS.md` and package `INSIGHTS.md`.
2. Inspect the existing route/feature and imports before describing it.
3. Resolve the installed React and Next.js versions from the lockfile.
4. Identify whether the task is React-only, Next.js App Router, or a client-only subsystem.
5. Load only the references relevant to the decision.

## Ownership review

- Can every changed artifact name its owner: route, feature, entity, shared capability, or server infrastructure?
- Is route-private code colocated instead of prematurely shared?
- Is shared UI business-neutral?
- Are pure domain rules outside JSX, hooks, actions, and transport adapters?
- Are constants/helpers/schemas at the narrowest semantic owner?
- Is dependency direction explicit and enforceable?
- Do public APIs hide internals without creating mega-barrels?

## React boundary review

- Does each component have a coherent product/render responsibility?
- Is extraction justified by ownership, state, reuse, testing, or a runtime/async/error boundary rather than a number?
- Is state minimal and owned by the closest correct system?
- Are derived values computed instead of synchronized into duplicate state?
- Does each Effect synchronize an external system and clean it up?
- Does context scope match its consumers?

## Next.js boundary review

- Does `app/` primarily express routes and composition?
- Is `'use client'` at a deliberate leaf/module boundary?
- Are transitive client imports browser-safe?
- Does a Server Component read through the real server query/DAL rather than its own Route Handler?
- Are DALs server-only and DTOs minimal?
- Are Server Actions used for UI mutations and Route Handlers for real HTTP contracts?
- Does every action/handler validate and authorize independently of UI gating?
- Do layout/template/loading/error/not-found/parallel/intercepting files match navigation semantics?
- Are async request APIs, middleware/proxy naming, and caching rules correct for the resolved Next.js version?
- Is invalidation ownership defined next to the successful mutation?

## Evidence and severity

Report a finding only when there is a concrete impact and evidence.

| Severity | Architecture impact |
|---|---|
| Critical | Secret/server module crosses into client code, authorization bypass, unsafe public entry point, or data exposure |
| High | Incorrect runtime/route/data boundary can break builds, correctness, navigation, or multiple consumers |
| Medium | Coupling, ownership ambiguity, premature abstraction, duplicated policy, or an unenforced dependency direction creates likely maintenance defects |
| Note | Optional simplification or team convention with no demonstrated correctness/ownership impact |

For each finding provide:

1. File and line evidence
2. Violated boundary or source-backed principle
3. Concrete impact
4. Smallest responsibility-correct fix
5. Version caveat when Next.js behavior is involved

Do not promote a preference to a defect. Label alternative valid folder taxonomies as trade-offs.

## False positives to reject

- “Over 200 lines” or “more than 7 props” without a responsibility problem
- “Three branches means extract” or another numeric threshold
- “Used twice means shared” without a stable business-neutral contract
- “All fetching belongs in hooks” in an App Router application
- “All application code belongs under `app/`”
- “Server Components should call our `/api`”
- “Server Actions are private”
- “RSC props must be JSON-only”
- “Every existing client page must be converted immediately”
- Performance-only advice in an architecture review

## Implementation sequence

When changing architecture, use the smallest safe seam:

1. Add or strengthen a boundary test/lint rule when behavior is mechanically enforceable.
2. Extract pure rules without changing runtime behavior.
3. Protect privileged modules with `server-only`.
4. Introduce the server route/composition owner.
5. Move interaction/browser lifecycle into client leaves.
6. Consolidate duplicate transport logic behind a DAL/model operation.
7. Verify typecheck, unit/integration tests, and a production build when route/RSC behavior changed.

Preserve project-specific exceptions with their reasons. Architecture is a model of ownership, not a reason to erase validated behavior.
