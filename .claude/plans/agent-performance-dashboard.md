# Development Plan — Agent Performance Dashboard (L08 optional homework)

**Execution mode:** multi-agent (`implementer` → `test-writer` → `plan-verifier` → review agents)

## Context

L08's optional homework asks for a global, workspace-wide "Agent Performance"
screen that aggregates the SAME stored data (`agent_runs` + `findings`) the
existing per-agent Stats tab already shows, across ALL agents, for a
selectable period (1 day / 30 days / custom range). It must never trigger a
model call — read-only over persisted runs/findings — and its numbers must be
provably identical to the Stats tab for the same agent/period (no second,
independently-drifting aggregation implementation).

Confirmed decisions (owner, 2026-08-25):
1. Custom range UI = two plain `<input type="date">` fields. No new shared
   `DateRangePicker` primitive in `@devdigest/ui` for this feature.
2. Minimum sample size to allow sorting by accept rate = **5** decided
   findings (`accepted + dismissed >= 5`); agents below that show a "small
   sample" badge instead of participating in the accept-rate sort.
3. Aggregation strategy = extend the existing `GET /agents/:id/stats` with
   optional `since`/`until`, and reuse the existing client hook
   `useAgentsStats` (already fetches N agents' stats via `useQueries`,
   already sharing the exact `["agent-stats", agentId]` cache key as the
   Stats tab) for the dashboard. **No second server-side aggregator** — one
   code path (`computeAgentStats`) backs both screens.
4. Table's "View" link → `/agents/:id?tab=stats` (existing `AgentEditor`
   `?tab=` convention).
5. Cost metrics are ALWAYS labeled as a DevDigest estimate (badge/tooltip
   "estimated") — there is no reconciled billing data source anywhere in
   this product to show as a second column.

## Modules involved

- **server** — extend `modules/agents/stats-repository.ts` +
  `stats-helpers.ts` (parameterize the fixed 30-day window into an explicit
  `{since, until}` range) and `modules/agents/routes.ts`/`service.ts`
  (`GET /agents/:id/stats` gains optional `since`/`until` query params;
  default behavior unchanged — trailing 30 days — so the current Stats tab
  keeps working with zero client-side changes there).
- **client** — new global page `/agent-performance` (`client/src/app/
  agent-performance/page.tsx` + `_components/AgentPerformanceView/`), a new
  sidebar entry in the already-scaffolded `GLOBAL` nav section
  (`client/src/vendor/ui/nav.ts`), a small hook addition in
  `client/src/lib/hooks/agents.ts` (range param on `useAgentsStats`/
  `useAgentStats`), and reuse of `client/messages/en/agentPerformance.json`
  (already exists — extend it, don't replace it).
- **shared** — `server/src/vendor/shared/contracts/observability.ts`
  (`AgentStats` contract itself does not need new fields; the route's query
  schema is server-local, not part of the shared contract).

## Constraints

- Root `CLAUDE.md` — wire contracts are `snake_case`; onion architecture:
  routes only translate HTTP↔service, services resolve deps through the DI
  container, no direct DB access from a route handler.
- `server/CLAUDE.md` — module shape is `routes.ts` + `service.ts` +
  `repository.ts`; DB is `snake_case` SQL / `camelCase` Drizzle.
- `client/CLAUDE.md` — feature-folder shape: page stays thin, logic lives in
  `_components/<Name>/` (`<Name>.tsx`, `index.ts`, `styles.ts`, `helpers.ts`,
  `constants.ts`, `<Name>.test.tsx`); data hooks live in `src/lib/hooks/*`
  over `src/lib/api.ts`.
- **Single source of aggregation truth is a hard constraint, not a style
  preference** — the entire reason the acceptance criteria call out
  "must match Stats tab for the same period" is that a second, hand-rolled
  aggregator could silently drift. `computeAgentStats` (`server/src/modules/
  agents/stats-helpers.ts`) MUST stay the only place that turns raw
  runs/findings into `AgentStats` — do not write a second summing function
  in a new dashboard-only repository or service method.
- `client/src/lib/hooks/agents.ts:143-160` (`useAgentsStats`) already fetches
  N agents' stats via `useQueries` with the SAME query key
  (`["agent-stats", agentId]`) as `useAgentStats` used by the Stats tab —
  reuse it, don't fork it.
- `client/src/vendor/ui/nav.ts:21-51` — the `GLOBAL` section already exists
  (added for CI Runs, SPEC-08 T14); add the Agent Performance entry to it,
  don't recreate the section (see `client/INSIGHTS.md`'s 2026-08-22 entry
  on this exact prior mistake).
- `client/src/components/app-shell/helpers.ts:38` (`activeKeyFor`) already
  has an `if (pathname.startsWith("/agent-performance")) return
  "agent-performance";` branch prepared — the route MUST be `/agent-performance`
  for sidebar active-state highlighting to work.
- `client/messages/en/shell.json`'s `nav.agent-performance` key is already
  translated ("Agent Performance") — reuse it as the nav label, don't
  reinvent a key.
- `client/messages/en/agentPerformance.json` already exists (pre-scaffolded,
  not yet wired to any component) — extend it in place; it is missing keys
  this plan needs (period picker labels, table columns for avg cost/avg
  duration/last run/view, "estimated" cost badge, small-sample badge,
  loading/error states) — do not delete or rename its existing keys.
- `server/src/adapters/llm/pricing.ts:37` (`estimateCost`) is the ONLY
  source of `cost_usd` anywhere in the product — a static $/1M-token table.
  No reconciled billing integration exists. All cost UI must say "estimated"
  and never imply a second, audited number exists.
- `server/src/modules/agents/stats-repository.ts` currently hardcodes
  `WINDOW_DAYS = 30`; `computeAgentStats`'s `trend` field buckets by calendar
  day (`ranAt.toISOString().slice(0, 10)`) — fine for 1d/30d windows, but a
  1-day window will produce at most one trend point; don't treat that as a
  bug.
- `GET /agents/:id/stats` is currently unauthenticated-by-range (no query
  schema at all, `IdParams` only) — adding `since`/`until` needs a new zod
  querystring schema following the `ListCiRunsQuery` pattern in
  `server/src/modules/ci/routes.ts:10-16` (`since: z.string().optional()`).
- Follow the "one real integration per data-backed workflow" testing
  philosophy (`TESTING.md`) — one `*.it.test.ts` covering the new
  since/until behavior against real Postgres is enough; don't chase
  exhaustive coverage.

## Skills the implementer will use

- **`onion-architecture`** — any change under `server/src/modules/agents/**`
  (routes.ts/service.ts/repository.ts/stats-repository.ts). The route must
  stay a thin HTTP↔service translator; the range-window logic belongs in
  `stats-repository.ts`/`stats-helpers.ts`, not inlined in `routes.ts`.
- **`react-ui-architecture`** — deciding where the new
  `AgentPerformanceView` and its sub-pieces (period picker, stat cards,
  table, cost-breakdown donuts) physically live under `_components/`, and
  whether any piece (e.g. a "small sample" badge) is generic enough to
  promote to `@devdigest/ui` vs staying feature-local.
- **`react-best-practices`** — the data-fetching hook must not re-fetch on
  sort/row-expand (client-side sort over already-loaded `AgentStats[]`,
  React state only) and loading/error states must not render fabricated
  zeros while `isLoading`/`isError` is true.
- **`dataviz`** — the four stat tiles + two donut charts (cost by agent /
  cost by model) should read as one system with the existing `MetricCard`/
  `Donut`/`BarRow` primitives already used by the Stats tab — reuse them,
  don't invent new chart primitives.
- **`zod`** — the new `since`/`until` querystring schema on
  `GET /agents/:id/stats`.
- **`pr-self-review`** — before opening the PR (this ships as its own PR per
  the assignment's "what to submit").

## Ordered steps

### Server

1. `server/src/modules/agents/stats-repository.ts` — replace the hardcoded
   `WINDOW_DAYS = 30` / `since = Date.now() - 30d` with a `getWindowData(
   workspaceId, agentId, range: { since: Date; until: Date })` signature.
   Change the `gte(t.agentRuns.ranAt, since)` filter to
   `and(gte(..., since), lte(..., until))`, same for the `reviews` query.
   Keep the `status: 'done'` filter and the doc-comment explaining why.
2. `server/src/modules/agents/service.ts` — `getStats(workspaceId, agentId,
   range?)` passes the range through to `statsRepo.getWindowData`,
   defaulting to `{since: now-30d, until: now}` when `range` is omitted (so
   every existing caller — the Stats tab — is unaffected).
3. `server/src/modules/agents/routes.ts` — add a
   `GetStatsQuery = z.object({ since: z.string().datetime().optional(),
   until: z.string().datetime().optional() })` schema (mirrors
   `ListCiRunsQuery` in `modules/ci/routes.ts:10`) on `GET /agents/:id/stats`;
   parse both to `Date` (400/422 on invalid) and pass to `service.getStats`.
   Update the module doc-comment header (currently says "30-day quality/cost
   aggregates") to reflect the new optional range.
4. No shared-contract change needed — `AgentStats` (`server/src/vendor/
   shared/contracts/observability.ts:123`) is unchanged; only the route's
   query params grow.

### Client

5. `client/src/lib/hooks/agents.ts` — extend `useAgentStats`/`useAgentsStats`
   to accept an optional `{ since, until }` range, forwarded as query params
   and included in the React Query key (`["agent-stats", agentId, since,
   until]`) so different periods don't collide in cache. Keep the
   zero-arg call shape working for the existing Stats tab (defaults to no
   params → server's 30-day default).
6. New route `client/src/app/agent-performance/page.tsx` — thin, renders
   `AgentPerformanceView` (mirrors `client/src/app/ci-runs/page.tsx`).
7. `client/src/app/agent-performance/_components/AgentPerformanceView/` —
   `AgentPerformanceView.tsx` + `styles.ts` + `helpers.ts` + `constants.ts` +
   `AgentPerformanceView.test.tsx`:
   - Period picker: three options — "1 day", "30 days", "Custom" (the
     latter reveals two `<input type="date">` fields, per owner decision).
     Local component state, not a URL param (matches the CI Runs page's
     `useState`-only filters — no query-string persistence exists in this
     codebase's precedent either).
   - `useAgents()` for the agent list + `useAgentsStats(agentIds, range)` for
     per-agent `AgentStats[]` for the selected range — this is the ONLY data
     fetch; no new endpoint.
   - Derive dashboard totals in a pure helper (`helpers.ts`, unit-testable,
     no React): `totalRuns = sum(stats.runs)`, `totalCost = sum(stats.
     total_cost_usd ?? 0)` guarding against all-null, `avgAcceptRate =
     sum(accepted) / sum(accepted + dismissed)` (weighted, NOT an average of
     per-agent rates — a workspace with one 1000-run agent and one 2-run
     agent must not let the 2-run agent skew the average), `mostActive =
     argmax(stats.runs)`. Each derived total states its own denominator (N
     runs in period) next to it, per the AC — no aggregate hides how many
     runs it's built from.
   - Table columns: Agent, Runs, Avg cost (badge "est."), Avg duration,
     Accept rate (with the `acted` denominator shown, e.g. "78% (39/50)"),
     Last run, View (→ `/agents/:id?tab=stats`, existing convention).
   - Sorting: client-side only, over the already-fetched `AgentStats[]` — no
     new query on sort click. Sorting by accept rate excludes/flags (don't
     silently drop) agents with `accepted + dismissed < 5`; render a "small
     sample" badge for those rows rather than sorting them arbitrarily.
   - Cost breakdown: two `Donut`s ("Cost by agent" from `stats.total_cost_usd`
     per agent; "Cost by model" needs each agent's `model` field from
     `useAgents()` joined by `agent_id` — group agents sharing a model and
     sum their `total_cost_usd`). Both totals must sum to the same "Total
     cost" tile — verify this in a test (see Test plan).
   - States: loading (skeleton/placeholder, NOT zeros) while any
     `useAgentsStats` query is pending; error (`ErrorState` with retry) if
     any query errored; two DIFFERENT empty states — "workspace has agents
     but zero runs in period" vs (not really reachable, but handle
     defensively) "workspace has zero agents" — reuse `EmptyState`.
   - Nothing in this component calls a mutation/model-triggering endpoint —
     reload, sort, and row-expand only ever read already-cached
     `AgentStats[]`.
8. `client/src/vendor/ui/nav.ts` — add one item to the existing `GLOBAL`
   section: `{ key: "agent-performance", label: "Agent Performance", icon:
   "Gauge", href: "/agent-performance", gKey: <pick an unused g-key> }`.
   Add the matching row to `SHORTCUTS` (mirrors the `ci-runs` entry right
   above it).
9. `client/messages/en/agentPerformance.json` — extend (don't replace) with
   the missing keys the view needs: period picker labels, table column
   headers for avg cost/avg duration/last run/view, an "estimated" cost
   tooltip/badge string, a "small sample" badge string, and loading/error
   copy consistent with `loadError`/`empty.*` already present.

## Test plan

- **server-unit** (`cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`):
  extend `server/test/agent-stats-helpers.test.ts` if `computeAgentStats`'s
  signature/behavior changes at all (it shouldn't — only its caller's window
  changes); add a route-schema test for the new `since`/`until` query
  validation (422 on malformed date) if the module's existing route tests
  cover schema validation this way — follow the pattern already in that
  file/`modules/agents` test suite.
- **server-integration** (`cd server && pnpm exec vitest run .it.test`,
  needs Docker): extend `server/test/agent-stats.it.test.ts` with a case that
  seeds runs across two different days and asserts a 1-day `since`/`until`
  window excludes the older run while the default (no params) still
  includes it — this is the concrete proof that Stats-tab-default behavior
  is unchanged.
- **client** (`cd client && pnpm test` + `pnpm typecheck`):
  - `AgentPerformanceView.test.tsx` (React Testing Library, `fetch` mocked
    per this suite's convention): loading state renders no fabricated
    numbers; error state renders `ErrorState` with retry; empty-runs state
    renders `EmptyState`, distinct from "has data" state; sorting by accept
    rate re-orders rows without firing a new network call (assert the mock
    fetch call count doesn't increase after a sort click); an agent with
    fewer than 5 decided findings shows the small-sample badge and is
    excluded from (or clearly flagged in) the accept-rate sort; Total cost
    tile equals the sum of both cost-breakdown donuts' segments for a fixed
    fixture; Total runs/avg accept rate match a hand-computed value for a
    small fixture identical in shape to what `AgentEditor`'s
    `StatsTab.test.tsx` already uses for the same agent — this is the
    concrete "matches Stats tab" proof on the client side.
  - A pass looks like: `pnpm test` green in both `server/` and `client/`,
    `pnpm typecheck` clean in both, and the integration test above green
    locally (Docker present) or explicitly self-skipped with a note in the
    PR description if Docker wasn't available in the environment that ran
    it.
- Per root `CLAUDE.md`'s eval table: this change touches no
  skill/agent/CLAUDE.md file, so no `pnpm eval:*` run is required.

## Out of scope

Architecture review and security review are explicitly NOT part of this
plan or the executing agent's job — they run as separate review agents
after `plan-verifier` in the multi-agent chain above. This plan also does
not cover: a shared `DateRangePicker` primitive (owner deferred it), any
real billing-data reconciliation (does not exist in this product), or a
batched server-side "all agents in one query" aggregator (owner confirmed
the N-request client-side reuse of `useAgentsStats` instead).
