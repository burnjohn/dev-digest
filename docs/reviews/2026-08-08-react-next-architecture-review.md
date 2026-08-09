# React + Next.js architecture review

**Date:** 2026-08-08
**Reviewed state:** `main` at `da28757956da`, plus the uncommitted architecture-skill documentation
**Framework versions:** Next.js 15.5.19, React 19.2.7
**Status:** Read-only architecture review; no runtime code was changed

## Scope

This review covers:

- React and Next.js App Router ownership and composition
- Client/Server module boundaries
- State, URL state, Effects, and TanStack Query ownership
- Browser-to-Fastify HTTP and SSE contracts
- The immediate Fastify authorization boundaries consumed by the frontend
- Cross-package `@devdigest/shared` contract ownership

Performance optimization, a full backend security audit, database design, and visual/UX review are outside scope. The existing client-heavy architecture was evaluated as an intentional SPA over a separate Fastify API, not as a defect to be rewritten into Server Components.

## Executive summary

The repository has a generally coherent feature-oriented shape: route-private UI is colocated under `_components`, API access is centralized through TanStack Query, mutation invalidation is usually close to the write, and replay-aware run aggregation correctly remains browser-owned.

Six concrete findings remain:

| Severity | Count | Summary |
|---|---:|---|
| High | 2 | Run endpoints discard workspace authorization; HTTP/SSE responses bypass runtime schemas |
| Medium | 4 | Shared contracts drift, SSE disconnect semantics, unvalidated PR tab state, and an error/empty-state conflation |

The first authorization finding becomes critical as soon as an AuthProvider can return more than the single MVP workspace.

## Findings

### 1. High — run SSE, cancel, and trace endpoints discard workspace ownership

**Evidence**

- [`GET /runs/:id/events`](<../../server/src/modules/reviews/routes.ts#L48>) resolves request context but does not retain `workspaceId` before subscribing to the global `RunBus` by `runId`.
- [`POST /runs/:id/cancel`](<../../server/src/modules/reviews/routes.ts#L113>) and [`GET /runs/:id/trace`](<../../server/src/modules/reviews/routes.ts#L120>) repeat the same pattern.
- [`ReviewService.cancelRun`](<../../server/src/modules/reviews/service.ts#L85>) and [`ReviewService.getRunTrace`](<../../server/src/modules/reviews/service.ts#L176>) accept only a `runId`.
- [`cancelRunIfRunning`](<../../server/src/modules/reviews/repository/run.repo.ts#L93>) and [`getRunTrace`](<../../server/src/modules/reviews/repository/run.repo.ts#L190>) query by run ID without a workspace predicate.
- Neighboring run-list and delete operations do scope by `workspaceId`, showing that run ownership is an established boundary rather than an absent concept.

**Impact**

The current `LocalNoAuthProvider` always returns one workspace, so cross-workspace exploitation is latent in the MVP. Once a real or test AuthProvider selects different workspaces, a caller who obtains another run ID can stream its live prompt/log events, retrieve its persisted raw trace, or cancel it. Resolving authentication context without authorizing the exact resource provides no tenancy protection.

**Smallest responsibility-correct fix**

1. Add one workspace-scoped run lookup/authorization operation.
2. Thread `workspaceId` through cancel and trace service/repository methods.
3. Verify the run belongs to the workspace before touching `RunBus` for SSE or cancellation.
4. Return the same not-found response for missing and foreign runs.
5. Add two-workspace integration tests for SSE, cancel, and trace.

### 2. High — HTTP and SSE payloads bypass the available runtime contracts

**Evidence**

- [`apiFetch<T>`](<../../client/src/lib/api.ts#L21>) returns `res.json() as T`; the generic supplies compile-time belief but performs no runtime validation.
- Every ordinary client HTTP call funnels through this function.
- [`useRunEvents`](<../../client/src/lib/hooks/reviews.ts#L180>) performs `JSON.parse(ev.data) as RunEvent`; a malformed or drifted object is appended to state as long as it is valid JSON.
- The catch labels all parse failures as ignorable keepalive frames, so a broken server contract is silent.
- Zod schemas already exist for active payloads such as [`PrMeta`/`PrDetail`](<../../client/src/vendor/shared/contracts/platform.ts#L163>) and [`RunEvent`](<../../client/src/vendor/shared/contracts/trace.ts#L21>).

**Impact**

A server/client deployment mismatch, incomplete response, or malformed stream event enters React Query and component state unchecked. Failures then surface far from the I/O boundary as missing fields, wrong branches, or render errors. Because this is the central transport, the risk spans every feature rather than one screen.

**Smallest responsibility-correct fix**

- Make response parsing explicit at the feature API/query boundary, for example `apiFetch(path, schema)` or endpoint functions that call `schema.parse`/`safeParse`.
- Validate structured error bodies as well as success bodies.
- Validate SSE frames with `RunEvent.safeParse` and distinguish a keepalive from an invalid data event.
- Normalize validation failures into an `ApiError` that names the endpoint without exposing payload secrets.

This depends on resolving finding 3 so runtime schemas have one reliable import path.

### 3. Medium — `@devdigest/shared` is physically duplicated and already drifted

**Evidence**

- The client alias points to [`client/src/vendor/shared`](<../../client/tsconfig.json#L22>), while the server alias points to [`server/src/vendor/shared`](<../../server/tsconfig.json#L21>).
- `diff -rq server/src/vendor/shared client/src/vendor/shared` reports differences in five files:
  - `adapters.ts`
  - `contracts/eval-ci.ts`
  - `contracts/knowledge.ts`
  - `contracts/productionize.ts`
  - `contracts/trace.ts`
- The client copy is 118 lines behind across those files. Examples include missing `openrouter` enum arms and missing exported contracts.
- [`client/src/lib/feature-models.ts`](<../../client/src/lib/feature-models.ts#L3>) creates a third manual copy of the runtime feature-model registry because importing runtime values from the current shared barrel does not bundle correctly.

**Impact**

Each package can typecheck against a different definition of the same named contract. A new client consumer may silently use an older enum or fail to find a contract that already exists on the server. The extra feature-model registry can display defaults that differ from the server behavior it claims to describe.

**Smallest responsibility-correct fix**

- Keep `server/src/vendor/shared` canonical as documented.
- Add a one-way deterministic sync/generation command for the client copy.
- Add a CI check that fails when the trees differ after generation.
- Fix the runtime package/barrel resolution so the client can import schema and registry values without another hand-maintained copy.

### 4. Medium — a transient SSE failure is treated as terminal run completion

**Evidence**

- [`useRunEvents`](<../../client/src/lib/hooks/reviews.ts#L200>) calls `es.close()` for every `EventSource.onerror`, decrements the open-stream count, and sets `running=false` when it reaches zero.
- [`RunStatus`](<../../client/src/app/repos/[repoId]/pulls/[number]/_components/RunStatus/RunStatus.tsx#L20>) invokes `onDone` whenever `running` changes from true to false.
- The server emits sequence IDs and replays its full buffer to every subscriber: [`routes.ts`](<../../server/src/modules/reviews/routes.ts#L62>). The client does not deduplicate by `RunEvent.seq`, and the server does not resume from `Last-Event-ID`.

**Impact**

A temporary network interruption freezes the live log, marks the stream as complete, and triggers completion invalidation while the run may still be executing. Native EventSource reconnect cannot simply be re-enabled: a reconnect currently replays the full buffer and would duplicate accumulated events.

**Smallest responsibility-correct fix**

- Model transport state separately from domain run status.
- Treat terminal completion as an explicit server event or confirm it through the canonical active-run query.
- Resume from `Last-Event-ID`, or replay and deduplicate by `(runId, seq)`.
- Add tests for transient disconnect, reconnect/replay, duplicate suppression, and real completion.

### 5. Medium — an invalid PR `tab` query produces a blank content area

**Evidence**

- The route accepts any string from `searchParams`: [`page.tsx`](<../../client/src/app/repos/[repoId]/pulls/[number]/page.tsx#L60>).
- Main content is rendered only for `overview`, `findings`, or `diff`: [`page.tsx`](<../../client/src/app/repos/[repoId]/pulls/[number]/page.tsx#L137>).
- The agents route already demonstrates the safer pattern by validating its tab against `VALID_TABS`.

**Impact**

A stale, hand-edited, or externally shared URL such as `?tab=unknown` renders the PR header and navigation with no tab body. The URL boundary accepts a state the view cannot represent.

**Smallest responsibility-correct fix**

Define a typed set of PR tabs and normalize unknown values to `overview` before passing the value to `Tabs` or selecting content. Add a route/component test for an unknown query value.

### 6. Medium — root query failure is rendered as an empty repository list

**Evidence**

- [`HomePage`](<../../client/src/app/page.tsx#L13>) reads `isError` but not the query error or `refetch` operation.
- [`isError`, missing data, and a genuinely empty list](<../../client/src/app/page.tsx#L30>) all render “No repositories yet” with an onboarding CTA.

**Impact**

When the Fastify engine is unreachable or returns an error, the root route tells the user that no repositories exist and directs them to add one. This conflates remote failure with valid empty domain state and can send users into a workflow that cannot succeed.

**Smallest responsibility-correct fix**

Render loading, error/retry, empty, and redirect-ready states as separate branches, consistent with the PR-list and agent-list routes.

## Architecture notes, not defects

- The client-heavy App Router model is valid here because Fastify is a real external API boundary and TanStack Query owns browser server-state. There is no reason to introduce internal Next.js Route Handlers or Server Actions merely for framework symmetry.
- Client-side SSE aggregation is intentional and should remain client-owned; finding 4 concerns reconnect semantics, not moving aggregation to the server.
- Route-private component colocation under `_components` is consistent and generally strong.
- Constants and helpers are usually kept beside their semantic owner rather than placed in one repository-wide dumping ground.
- PR status already lives in the URL, but list search and sort remain local state despite the file comment saying `?status&sort`: [`pulls/page.tsx`](<../../client/src/app/repos/[repoId]/pulls/page.tsx#L39>). Moving shareable search/sort state into search params is a useful follow-up, but not a correctness finding.
- The client has no ESLint configuration or lint script, so import-layer rules are not mechanically enforced. Add `no-restricted-imports` only after deciding the intended feature/shared graph; the current folder taxonomy alone is not a defect.

## Recommended remediation order

1. Scope run SSE/cancel/trace by workspace and add cross-workspace tests.
2. Make the shared-contract copy deterministic and CI-enforced.
3. Introduce schema-aware HTTP/SSE parsing using the corrected shared runtime package.
4. Make SSE reconnection idempotent and separate transport state from run state.
5. Validate PR URL state and split the root error/empty states.
6. Add import-boundary lint rules as an enforcement layer, not as a folder rewrite.

## Verification performed

Fresh checks executed during the review:

- Client TypeScript: passed with `tsc --noEmit --incremental false`.
- Client tests: 19 files, 76 tests passed.
- Server TypeScript: passed with `tsc --noEmit --incremental false`.
- Server hermetic tests: 23 files, 134 tests passed.
- `git diff --check`: passed.

The client smoke test emitted the existing zero-size Recharts warning under jsdom. No test failed.

Not executed:

- Next.js production build
- DB-backed `*.it.test.ts` suites
- Browser e2e flows

The findings above are boundary cases not covered by the currently passing happy-path tests. The two non-obvious stream/authorization discoveries were also captured in `client/INSIGHTS.md` and `server/INSIGHTS.md` according to the repository session protocol.
