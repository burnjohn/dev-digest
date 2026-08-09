# React components, logic, and state ownership

## Contents

- Component responsibility
- Business logic
- Hooks and Effects
- State placement
- Composition
- Existing client-heavy applications

## Component responsibility

Keep render functions pure: the same props/state/context produce the same output, and render performs no external side effect. [R01–R02]

Split presentation from rules by responsibility, not by a mandatory “container/presentational” taxonomy:

- UI renders state and translates user gestures into named intents.
- Pure model functions calculate policy, validation decisions, and transitions.
- Server/application adapters orchestrate authorization and I/O.
- Hooks adapt React state, lifecycle, context, or external subscriptions.

A component may coordinate UI and call a feature operation. It should not become the only place where a business invariant can be evaluated.

## Business logic

Keep these usable without rendering React:

- Eligibility and permission policy
- Calculations and normalization
- State transitions and reducers
- Selectors and derived domain values
- Mapping between domain and transport representations

Place pure rules in the owning feature/entity model. Place I/O orchestration in feature API/server modules or the DAL. Let event handlers name the user intent and delegate.

## Hooks and Effects

Use a custom hook when logic depends on React state, context, lifecycle, or an external subscription and multiple consumers benefit from the same React-specific contract. [R06]

Do not turn pure functions into hooks. Do not require all data access to live in hooks: Next.js Server Components can read server data directly.

Use an Effect only to synchronize React with an external system. [R07–R08]

| Need | Owner |
|---|---|
| Derived value from props/state | Compute during render or in a selector |
| User-triggered operation | Event handler or form action |
| Complex synchronous transitions | Reducer/model |
| DOM/browser subscription, timer, SSE lifecycle | Effect with cleanup or a focused hook |
| Server read for rendered route | Server Component → server query/DAL |

## State placement

| State kind | Preferred owner |
|---|---|
| Ephemeral visual state | Closest component that needs it |
| Shared state in one subtree | Nearest common owner; reducer + context if transitions are complex |
| Shareable filter, sort, pagination, tab | URL/search params |
| Remote/server data | Server Component or dedicated server-state cache |
| Complex feature workflow | Feature reducer/state machine/model |
| Cross-cutting dependency | Narrow provider placed as deep as practical |
| Derived value | Compute; do not duplicate in state |

Avoid contradictory, redundant, duplicated, and deeply nested state. [R03–R05]

Context transports a value; it is not automatically good or bad “global state.” Scope the provider and understand its update contract. Try composition or ordinary props before introducing context for a narrow subtree. [R09]

## Composition

- Prefer children/slots and named variants to matrices of boolean mode props.
- Keep business-neutral primitives generic; compose domain-aware feature components around them.
- A Client Component may receive already-rendered Server Component JSX in `children` or another slot. Runtime ownership follows the module graph, not the visual parent/child tree. [R15]
- Use keys and tree position intentionally when state must reset or persist. [R10]

## Existing client-heavy applications

Migrate around stable seams instead of rewriting every client page:

1. Protect privileged imports with `server-only`.
2. Keep route params/composition and server-readable data in a Server Component where practical.
3. Move browser lifecycle and interaction into client leaves.
4. Extract pure business rules before changing runtime ownership.
5. Preserve justified client adapters such as incremental SSE aggregation, browser APIs, polling, and optimistic client caches.

For DevDigest, the client-side replay-aware SSE aggregation is intentional. Do not replace it with a duplicate server snapshot path merely to satisfy a server-first slogan.
