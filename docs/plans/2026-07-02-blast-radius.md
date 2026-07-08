# Development Plan: Blast Radius (L04)

**Date:** 2026-07-02
**Status:** Ready for implementation
**Scope:** New server module `blast/` + live data in the Overview Blast Radius card + Graph view + MCP tool repoint
**Affects modules:**

- `server/src/modules/blast/` (new) — service + route `GET /pulls/:id/blast`
- `server/src/modules/repo-intel/` — one new **read-only** facade method (`getImporters`); no pipeline changes
- `server/src/vendor/shared/` + `client/src/vendor/shared/` — new `BlastResponse` contract (additive)
- `client/` — live data in `BlastRadiusCard`, clickable callers, Graph view, degraded badge
- `mcp/` — `get_blast_radius` repointed from the seed-brief stub to the new live endpoint
- DB schema — **no changes** (reads existing `symbols` / `references` / `file_edges` / `file_rank` / `file_facts` / `pr_files` / `pull_requests`)

---

## 1. Context

Blast Radius answers the first question of any reviewer — *"what can these changes break?"* — which is invisible in the diff itself. The feature maps: changed symbols → who calls them across the codebase → which HTTP endpoints / cron jobs are reachable from the changed files.

**There is no AI and no at-review-time analysis.** Everything is read from the `repo-intel` index that was built at clone time. Per the interview decisions (2026-07-02):

| Decision | Choice |
| --- | --- |
| UI placement | Existing **Overview card** fed with live data (fallback to seed `pr_brief`), matching the design screenshots — no new tab |
| Graph view | **Library-based** (`@xyflow/react`) with a hand-rolled 3-layer layout (no dagre) |
| LLM summary | **None** — 0 model calls; `summary` is deterministic text |
| Caller click | **GitHub blob URL** `https://github.com/{owner}/{repo}/blob/{head_sha}/{file}#L{line}` in a new tab |

### Best-practices grounding (research 2026-07-02)

1. **Read from a precomputed index, never analyze on request** (Nx affected / Bazel rdeps model). `repoIntel.getBlastRadius()` already implements this: persistent Postgres path + ripgrep fallback.
2. **Precision over recall** for reviewer-facing output — a false caller destroys trust faster than a missed one. Static call-graph research (ISSTA'24 "Total Recall?", ICSE'20) shows precision and recall are independent axes; `tryPersistentBlast` already counts only references with a resolved `decl_file`. Keep it.
3. **Ranked caps, not silent truncation** — ≤20 callers per symbol sorted by `file_rank` DESC, UI shows "+N more" when clamped.
4. **Depth limits for UI** — endpoint reachability via import-graph BFS depth 2 (task requirement; matches the existing `BFS_DEPTH = 2` constant). Deeper graphs are noise for a review screen.
5. **Honest degradation** — `partial`/`degraded` index → explanatory badge, never a silently empty screen. "0 callers found" and "index unavailable" are two different UI states.
6. **Every node clicks through to `file:line`** — a map without code navigation is decoration.
7. **Deterministic and fast** — pure DB reads, target <500 ms.

### What already exists (verified against code)

| Piece | Where | State |
| --- | --- | --- |
| Facade `getBlastRadius(repoId, changedFiles)` | `server/src/modules/repo-intel/service.ts:220` | Working: persistent path (symbols/references/file_rank/file_facts) + degraded ripgrep fallback; returns `factsByFile` for per-file endpoint/cron attribution |
| `BlastResult` contract (facade-level) | `server/src/modules/repo-intel/types.ts:74` | Done |
| `BlastRadius` / `DownstreamImpact` / `PrHistory` Zod contracts | `server/src/vendor/shared/contracts/brief.ts` | Done (shared, mirrored in client) |
| UI card (stats row, symbol accordion, endpoint/cron badges, prior-PRs accordion, Tree/Graph toggle stub) | `OverviewTab.tsx` (inline copy) **and** `BlastRadiusCard.tsx` (standalone, unused) | Duplicated — consolidate |
| i18n keys incl. `graph.*` | `client/messages/en/blast.json` | Done |
| MCP tool `get_blast_radius` | `mcp/src/tools/get-blast-radius.ts` | Seed-only stub via `GET /pulls/:id/brief` — repoint |
| Changed files per PR | `pr_files` table, `getPrFiles(db, prId)` in `reviews/repository/pull.repo.ts:32` | Done |
| Index state + degraded reason | `repoIntel.getIndexState()` | Done |

### What's missing (this plan)

`blast/` module + `GET /pulls/:id/blast` · depth-2 import-graph BFS for endpoint reachability · real prior-PRs query · live data in the card · clickable callers · Graph view · degraded badge / empty state · MCP repoint.

---

## 2. Architecture Fit

```text
client OverviewTab ──▶ GET /pulls/:id/blast ──▶ modules/blast/routes.ts   (Zod schema, workspace scope)
mcp get_blast_radius ─┘                              │
                                                blast/service.ts          (assembly: shape BlastResponse)
                                                │            │
                                     container.repoIntel.*   blast/repository.ts
                                     (getBlastRadius,        (PR row + pr_files + prior PRs —
                                      getImporters,           all workspace-scoped)
                                      getFileFacts via facade,
                                      getIndexState)
```

- `blast/` is a standard onion module: `routes.ts` → `service.ts` → `repository.ts`, registered statically in `modules/index.ts`.
- **The index is only read through the `repoIntel` facade** — `blast` never touches `t.symbols` / `t.references` / `t.fileEdges` directly. The one gap (reverse import-graph reachability) is closed by adding a read method **to the facade**, not by leaking index tables into `blast/repository.ts`.
- `blast/repository.ts` owns only PR-domain reads: the PR row (workspace-scoped), `pr_files` paths, and prior merged PRs sharing those paths.
- The response contract lives in `@devdigest/shared` (server + client mirror) because three consumers read it: client hook, MCP server, tests.
- Reviewer-core is untouched. No new tables, no migrations, no env vars, no secrets.

---

## 3. Skills & Patterns Applied

- `backend-onion-architecture` — module layering, container-only adapter access, no cross-module table reads.
- `fastify-best-practices` + `zod` — route schema via `fastify-type-provider-zod`; one schema drives validation and types.
- `frontend-architecture` / `react-best-practices` — data via TanStack Query hook (`useBlast`), no `useEffect` fetching; card components co-located in `_components/OverviewTab/`.
- Existing project patterns:
  - *Live-preferred fallback* — exactly like `displayIntent = liveIntent ?? brief?.intent` in `OverviewTab.tsx:194`; blast becomes `displayBlast = liveBlast ?? brief-derived`.
  - *Workspace scoping* — every repository query filters `workspace_id` (module hard rule; see insights 2026-06-27).
  - *Degraded contract* — object results carry `degraded?/reason?` inline (repo-intel types.ts header).

---

## 4. Constraints

- **Zero LLM calls** (interview decision). The `summary` string is generated deterministically (e.g. `"2 symbols changed · 14 callers · 3 endpoints · 1 cron reachable"`).
- **No new migrations** — all tables exist. Never edit `server/drizzle/`.
- **`reviewer-core` untouched**; `grounding.ts` untouched; `vendor/shared` changes are additive only (new exports, no edits to existing types — old JSONB briefs must keep parsing; remember the `.nullish()` quirk for any field added to JSONB-deserialized schemas).
- **MCP hard rules** — stdout sacred, all HTTP in `api-client.ts`, local response types stay local.
- **Client** — no hardcoded strings (next-intl), `api.*` from `src/lib/api.ts` only. `@xyflow/react` is a sanctioned exception to "no external component library" (it's a graph engine, not UI primitives) — record this in `client/AGENTS.md`.
- **Performance** — endpoint must be pure DB reads on the persistent path; the ripgrep fallback is acceptable only as degraded mode (it already exists in the facade).

---

## 5. Implementation Steps

### Step 1 — Shared contract: `BlastResponse`

`server/src/vendor/shared/contracts/blast.ts` (new file; mirror to `client/src/vendor/shared/contracts/blast.ts`; re-export from both `index.ts` barrels):

```ts
export const BlastIndexInfo = z.object({
  status: z.enum(['full', 'partial', 'degraded', 'failed']),
  degraded: z.boolean(),
  reason: z.string().nullish(),          // DegradedReason when degraded
});

export const BlastLink = z.object({      // everything the client needs for GitHub blob URLs
  owner: z.string(),
  repo: z.string(),
  head_sha: z.string(),
});

export const BlastResponse = z.object({
  available: z.boolean(),                // false → render empty state
  blast: BlastRadius.nullable(),         // REUSE the existing shared shape the card already renders
  history: PrHistory,                    // real prior PRs (computed), not seed
  index: BlastIndexInfo,
  link: BlastLink.nullable(),
  truncated: z.record(z.string(), z.number()).optional(), // symbol → hidden caller count ("+N more")
});
```

Reusing `BlastRadius`/`DownstreamImpact`/`PrHistory` keeps the card component nearly unchanged and lets the seed-brief fallback flow through the same rendering path.

### Step 2 — Facade extension: reverse import reachability

Add to `RepoIntel` interface (`repo-intel/types.ts`) and `RepoIntelService`:

```ts
/** Files that import any of `files`, transitively up to `depth` (reverse file_edges BFS). */
getImporters(repoId: string, files: string[], depth?: number): Promise<string[]>;
```

- Repository: `getReverseEdges(repoId, toFiles)` → `SELECT from_file, to_file FROM file_edges WHERE repo_id = $1 AND to_file IN (...)` — one query per BFS level (≤2 queries).
- Service: BFS with `depth = BFS_DEPTH (2)` default, visited-set dedup, flag-off / no-data → `[]` (array-degraded contract).
- No pipeline change; `file_edges` is already populated by the T3 indexer.

### Step 3 — `blast/` module

`server/src/modules/blast/{routes,service,repository}.ts` + register in `modules/index.ts` (one import + one array entry). Also add `server/src/modules/blast/README.md` (markdown doc #2, see Step 8).

**`repository.ts`** (all queries workspace-scoped):
- `getPr(workspaceId, prId)` → PR row (`repoId`, `headSha`, `number`).
- `getPrFilePaths(workspaceId, prId)` → `pr_files.path[]` (join through `pull_requests` for scoping).
- `getPriorPrs(workspaceId, repoId, paths, excludePrId, limit = 5)` → merged PRs (`status = 'merged'`) sharing ≥1 path in `pr_files`, ordered by `updated_at DESC`, with the overlapping paths aggregated. Map to `PrHistoryItem` (`merged_at` ← `updated_at` — the schema has no `merged_at` column; note this in the README).
- `getRepoBasics(repoId)` → owner / name (for `link`).

**`service.ts`** — the assembly, in order:
1. `changedFiles = getPrFilePaths(...)`; if PR not found → `AppError` 404.
2. `indexState = repoIntel.getIndexState(repoId)`.
3. `blastResult = repoIntel.getBlastRadius(repoId, changedFiles)` — symbols + callers (already rank-sorted, decl-file excluded, cross-file only) + `factsByFile`.
4. **Per-symbol grouping + cap**: group `callers` by `viaSymbol`, clamp to **20 per symbol** (facade caps globally; re-clamp per symbol here), record clamped counts in `truncated`.
5. **Endpoint attribution (level 1)**: for each symbol, endpoints/crons from `factsByFile[callerFile]` of its callers — this fills `DownstreamImpact.endpoints_affected` / `crons_affected` exactly as the card renders them.
6. **Reachability (level 2)**: `reachable = repoIntel.getImporters(repoId, changedFiles, 2)`; endpoints from `getBlastRadius` union endpoints of reachable files via `factsByFile`-style facts — deduped into the per-symbol lists' union; anything not attributable to a specific symbol goes to the symbol with matching caller files (fallback: first symbol). Keep it simple and deterministic.
7. **Deterministic summary** string (counts sentence — zero tokens).
8. `history = getPriorPrs(...)`.
9. `available` = `blast.changed_symbols.length > 0 || callers > 0`; if the repo has no usable index AND ripgrep fallback returned nothing → `available: false` with `index.degraded = true` (empty state + badge, honest per best practice #5).

**`routes.ts`** — `GET /pulls/:id/blast`:
- Zod params (`id: z.string().uuid()`), response schema = `BlastResponse`.
- Workspace from the same `getContext` pattern as `reviews/routes.ts`.
- No rate limit needed (pure read), but set route-level `logLevel` default; log one line with counts (proves "no parse events, only index reads" for the acceptance check).

### Step 4 — Client: live data in the card

- `client/src/lib/hooks/blast.ts` — `useBlast(prId)` via `api.get`, `staleTime: 5 min` (same as `usePrBrief`).
- **Consolidate the duplicate**: delete the inline `BlastRadiusCard`/`SymbolImpact` from `OverviewTab.tsx` (lines 20–178); keep the standalone `BlastRadiusCard.tsx` + `SymbolImpact.tsx` as the single implementation, extend them to accept the new props.
- `BlastRadiusCard` props become `{ blast: BlastRadius; history: PrHistory; link?: BlastLink | null; index?: BlastIndexInfo; truncated?: Record<string, number> }`.
- `OverviewTab`: `displayBlast = liveBlastResponse?.available ? liveBlastResponse : briefAsBlastResponse(brief)` — the seed brief is adapted into the same shape (no `link`/`index` → links disabled, no badge). Placeholder card only when both are absent.
- **Clickable callers**: `SymbolImpact` renders each caller as `<a href={ghBlobUrl(link, file, line)} target="_blank" rel="noopener noreferrer">` when `link` is present; plain text otherwise. Endpoint badges stay non-links.
- **Degraded badge**: when `index.degraded || index.status === 'partial'` → small warning badge in the card header with the reason as `title` tooltip (i18n keys added to `blast.json`: `degraded.partial`, `degraded.noIndex`, etc.).
- **"+N more"** row per symbol from `truncated`.
- **Empty state**: `available: false` → the existing placeholder card layout with an explanatory line (uses `noDownstream` key or a new `empty` key).

### Step 5 — Graph view

- Add `@xyflow/react` to `client/package.json`.
- `_components/OverviewTab/BlastGraph.tsx` (`"use client"`, dynamic-imported with `next/dynamic` + `ssr: false` to keep it out of the RSC bundle and initial JS).
- Layout: hand-computed 3 columns — changed symbols | caller files (deduped) | endpoint/cron badges; positions assigned by index (no dagre dependency). Edges: symbol→caller (per caller row), caller-file→endpoint (via `factsByFile` attribution already resolved server-side).
- Node click: symbol/caller nodes open the same GitHub blob URL; pan/zoom from React Flow defaults; `fitView` on mount; cap render at ~60 nodes ("+N more" summary node beyond that).
- Wire the existing Tree | Graph toggle (currently a stub) to local state; uses existing `view.tree` / `view.graph` and `graph.*` i18n keys.

### Step 6 — MCP: repoint `get_blast_radius`

- `mcp/src/api-client.ts`: add `fetchBlast(prId)` → `GET /pulls/:id/blast` (local `BlastResponse` import via `import type` from `@devdigest/shared`).
- `mcp/src/tools/get-blast-radius.ts`: handler calls `fetchBlast`; projection in `format.ts` (`projectBlastLive`): compact counts + per-symbol callers (top 5 each) + endpoints + `index` state; `available:false` passthrough — still never fabricates.
- Update the tool `description` (no longer "seed data only") and `mcp/AGENTS.md`/`README.md` tool table.

### Step 7 — Seed compatibility check

`pnpm db:seed` populates `pr_brief` for demo PRs; live endpoint works only for repos with a real clone + index. Verify the demo flow: the acceptance demo ("PR changing a shared helper, ≥2 callers, ≥1 endpoint") should run against a real indexed repo (e.g. this repo added via onboarding). Seed PRs keep working through the brief fallback — no seed changes required.

### Step 8 — Docs

- This plan (`docs/plans/2026-07-02-blast-radius.md`) — markdown doc #1.
- `server/src/modules/blast/README.md` — endpoint contract, data flow diagram (Mermaid), degraded semantics, `merged_at ← updated_at` caveat — markdown doc #2.
- Update: root `AGENTS.md` active-features, `server/AGENTS.md`, `server/src/modules/AGENTS.md` registered list, `client/AGENTS.md` (card + `@xyflow/react` exception), `mcp/AGENTS.md` (tool no longer a stub).

---

## 6. Acceptance Criteria

1. `GET /pulls/:id/blast` returns `BlastResponse` for a real indexed PR: ≥2 callers and ≥1 endpoint on the demo PR touching a shared helper; 404 (`AppError`) for foreign-workspace/unknown PR.
2. Overview card shows live counters (symbols / callers / endpoints / cron), per-symbol accordion, prior-PRs accordion — matching the design screenshots.
3. Clicking a caller `file:line` opens the GitHub blob URL at that exact line in a new tab.
4. Tree | Graph toggle works; Graph renders symbols → callers → endpoints with clickable nodes.
5. `partial`/`degraded` index → visible badge with a reason; unavailable data → empty state (never a blank card, never fabricated data).
6. **Zero LLM calls** — run logs show only index reads, no parse events on the persistent path, no model calls anywhere in the flow.
7. Response is fast: persistent path is DB-reads-only (<500 ms locally).
8. MCP `get_blast_radius` with a real `pr_id` returns live blast data (not the brief stub).
9. Both markdown documents exist (this plan + module README).
10. `pnpm typecheck` passes in `server/`, `client/`, `mcp/`; all existing tests stay green.

---

## 7. Testing Plan

- **server (hermetic)** — `server/test/blast-service.test.ts`: mock container (`repoIntel` stub) → grouping by `viaSymbol`, 20-per-symbol clamp + `truncated`, endpoint attribution from `factsByFile`, deterministic summary, `available:false` when degraded-and-empty. `server/test/blast-routes.test.ts`: `app.inject()` — 200 shape (Zod-parse the body with `BlastResponse`), 404, workspace scoping.
- **server (integration, optional)** — `blast.it.test.ts` against testcontainers Postgres with seeded index rows: end-to-end persistent path.
- **facade** — extend `repo-intel` tests: `getImporters` BFS depth 1/2, cycle safety, flag-off → `[]`.
- **client** — `BlastRadiusCard.test.tsx`: renders counts, caller `<a href>` contains `#L{line}`, degraded badge visible, "+N more", empty state; graph component smoke-test (dynamic import mocked).
- **mcp** — update `get-blast-radius.test.ts`: mock `fetchBlast`, assert projection + `available:false` passthrough; `format.test.ts` for `projectBlastLive`.
- **contracts** — `server/test/contracts.test.ts`: `BlastResponse` fixture parses (remember: required-field additions break old fixtures — new file, so safe).

---

## 8. Out of Scope

- Pre-push CLI (`devdigest review --mode working`) — stretch, separate plan.
- LLM map summary — explicitly declined (0 tokens).
- Separate full-page Blast tab — Overview card only (interview decision).
- Cross-repo / multi-package blast, dynamic-dispatch resolution, deeper-than-2 reachability.
- Index pipeline changes (`repo-intel/pipeline/*`), new tables, migrations.
- Internal code viewer for callers (GitHub blob links chosen instead).
