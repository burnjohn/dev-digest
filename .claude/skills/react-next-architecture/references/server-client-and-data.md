# Server/Client and data architecture

## Contents

- Module graph
- Serialization contract
- Boundary selection
- DAL and DTOs
- Actions and handlers
- Caching and client streams

## Module graph

Server Components are the App Router default. Add `'use client'` to the smallest module whose subtree needs state, Effects, event handlers, context, or browser APIs. The directive marks that module and all transitive imports as client code. [N02, R15]

- Never import a database driver, secret, filesystem helper, or privileged service into a client-marked subtree.
- Add `import 'server-only'` to privileged modules so environment poisoning fails at build time.
- Put providers as deep as their consumers allow. A Client provider may receive server-rendered `children` without converting those children into client modules.
- Pass a Server Component as already-created JSX/children from a server owner; do not directly import the server module from client code.

## Serialization contract

Use React's serialization contract, not “JSON-serializable” folklore. React 19 supports: [R15]

- Primitives, including global `Symbol.for` symbols
- Arrays and other supported iterables
- `Map`, `Set`, typed arrays, and `ArrayBuffer`
- `Date`
- Plain objects whose fields are serializable
- Server Functions
- Client/Server JSX elements
- Promises

It does not support ordinary functions, classes/application instances, null-prototype objects, non-global symbols, DOM objects, or event objects.

Prefer small explicit DTOs even when a richer built-in value is supported. DTOs protect data exposure and stabilize the consumer contract; they are not required because React only understands JSON.

## Boundary selection

| Need | Boundary |
|---|---|
| Internal server-rendered read | Server Component → feature query/DAL directly |
| Existing external REST/GraphQL service | Server-only adapter to that service |
| Mutation initiated by this React UI | Thin Server Action |
| Public API, webhook, callback, file, SSE, external/mobile consumer | Route Handler |
| Browser API, frequent polling, optimistic browser cache, client subscription | Client query/stream adapter |

Do not have a Server Component fetch the same application's Route Handler. It adds an HTTP round trip, duplicates error/cache contracts, and fails for build-time prerendering because no server is listening. [N13]

Do not use Server Actions as a general read transport. They use POST and dispatch sequentially per client; use them for mutations. [N13, N15]

## DAL and DTOs

For a new application, choose one consistent server data strategy. Prefer a dedicated server-only Data Access Layer that: [N04, N14]

1. Reads the authenticated principal from a trusted source.
2. Authorizes access to the exact resource/operation.
3. Calls repositories, databases, or external providers.
4. Applies domain policy or delegates to the owning model.
5. Returns a minimal safe DTO.

Keep feature-owned access in `features/<feature>/server`. Use top-level `server/` only for cross-feature infrastructure such as session verification or a shared repository adapter.

Direct database access inside a Server Component is acceptable for prototypes. Do not mix component-level queries, a DAL, and internal HTTP calls without a deliberate migration boundary; auditors and maintainers need one predictable access path.

## Actions and handlers

Treat both Server Actions and Route Handlers as remotely invokable security surfaces.

For every entry point:

- Parse and validate route params, search params, headers, cookies, FormData, and bodies as untrusted input.
- Authenticate and authorize inside the operation; hidden UI and layout redirects are not authorization.
- Check resource ownership from trusted data instead of accepting it from the client.
- Delegate business rules and persistence to the same model/DAL used by other transports.
- Return only fields the caller needs; do not expose raw records or internal error details.

Keep Server Actions thin: validate → authorize/delegate → invalidate → redirect/return expected result. Keep Route Handlers thin HTTP adapters with explicit status, headers, and content type. [N13–N15]

For webhooks, verify the signature against the required raw representation, validate the event, enforce delivery idempotency, enqueue/persist work, and acknowledge promptly.

## Caching and client streams

Treat cache configuration as data semantics. In Next.js 15, ordinary `fetch` and GET Route Handlers are uncached by default; page segments are not normally reused across client navigation, while layouts/loading states are reused. [N16, N22]

- Declare cache ownership at the query/adapter.
- Put invalidation beside the successful mutation boundary.
- Use route invalidation for a route-owned result and tags for shared domain data.
- Invalidate only after the write commits.
- Never assume “Server Component” implies fresh or cached data.
- Re-check semantics before using Next.js 16 Cache Components or `'use cache'`.

Client-side SSE/polling is appropriate when the browser needs incremental updates, replay/reconnect behavior, or browser lifecycle ownership. Authenticate and scope the server stream; use explicit event DTOs; keep the client stream as a projection of canonical server state.
