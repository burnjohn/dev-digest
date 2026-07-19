# HW — Blast Radius — Analysis & TDD

Course: Neoversity AI-Agentic-Engineering · Lesson L04 · Product: DevDigest.
Authoritative analysis + prioritized test plan. Implementation is a **PORT** of the
reference (`origin/reference/full-build`) + tests + Blast tab wiring.

---

## PART 1 — ANALYSIS

### 1.1 What & why
Build a PR **impact map**: which functions changed, **who calls them** downstream, and
which **HTTP endpoints / crons** a change can reach. It answers the reviewer's first
question — *"what can these changes break?"* — which the diff alone doesn't show.

### 1.2 The defining principle — read the index, ZERO parsing/LLM at review time
Everything is read from the **already-built `repo-intel` index** (built at clone time)
via the `repoIntel.*` facade. Blast Radius makes **no LLM call** and does **no parsing
during review** — it's a deterministic, fast projection. (Optional stretch: exactly one
cheap-model call to "explain this map in a paragraph" — the only tokens in the feature.)

### 1.3 Data flow (3 steps from the spec)
1. **Changed symbols** — symbols declared in the PR's changed files.
2. **Callers** — for each changed symbol, who imports/calls it (**cap 20/symbol, sorted
   by file rank, exclude the declaring file**).
3. **Reach** — walk the import graph ≤2 levels → HTTP endpoints/crons reachable.
Honest **partial/degraded** handling → an explanatory badge/summary, never a blank screen.
**Empty state** when there's nothing to read.

### 1.4 The contract (already in `brief.ts`, both vendor copies)
```
ChangedSymbol   = { name, file, kind }
BlastCaller     = { name, file, line }
DownstreamImpact= { symbol, callers: BlastCaller[], endpoints_affected: string[], crons_affected: string[] }
BlastRadius     = { changed_symbols: ChangedSymbol[], downstream: DownstreamImpact[], summary: string }
```
Facade type (`repo-intel/types.ts`): `getBlastRadius(repoId, changedFiles) → BlastResult`
`{ changedSymbols, callers:{file,symbol,viaSymbol,line,rank}[], impactedEndpoints, factsByFile?, degraded?, reason? }`.

### 1.5 Deliverables
- **D1 — `blast/` server module** + `GET /pulls/:id/blast` (reads via `repoIntel.*`, no index writes).
- **D2 — Composition** `BlastResult → BlastRadius`: group callers by symbol, attribute
  endpoints/crons (via `factsByFile`), cap 20 / sort by rank / exclude decl-file, one-line summary.
- **D3 — Degraded/empty**: no clone / no files / degraded index → valid empty-but-explained result.
- **D4 — Blast tab (UI)**: levels **changed symbols → callers → endpoints**, Tree/Graph, **click caller → code**.
- **D5 — Open PR** + 1–3 min demo video (open demo-PR, show the map, **click a caller → jump to code**).

### 1.6 Acceptance criteria (verbatim → satisfied by)
| Criterion | By |
|---|---|
| Open PR + demo video (click caller → code) | D5 |
| demo-PR changing a shared helper → **≥2 callers & ≥1 endpoint** | D2 + demo fixture |
| click caller (`file:line`) opens the code at that line | D4 |
| response is fast | D1 (index read, no parse) |
| **no LLM call** — index read only (or exactly one, if optional summary) | D1 (NFR test) |
| no data source → **empty state** | D3 |
| run logs: **no parsing events, only index reads** | D1 |

### 1.7 Codebase grounding (delta = PORT)
| Piece | Reference | Current branch |
|---|---|---|
| `BlastRadius` contract | `brief.ts` | ✅ EXISTS (both copies) |
| `repoIntel.getBlastRadius` facade + `BlastResult` | `repo-intel/types.ts` | ✅ EXISTS |
| `blast/{constants,helpers,routes,service}.ts` | reference | ❌ port |
| `mapFacadeBlast` / `summarizeBlast` / `callerName` | reference | ❌ port |
| `_components/BlastRadius/*` (tree+graph, click→code) | reference | ❌ port |
| `MockCodeIndex`, `extractEndpoints/Crons`, buildApp `repoIntel`/`codeIndex` overrides | platform | ✅ EXIST |
| `useBlast` hook + Blast tab wiring | — | ❌ create |

### 1.8 Staff-SWE decisions
- **Composition guarantees the invariants** — cap-20 / sort-by-rank / exclude-decl-file live in
  `mapFacadeBlast` (the service's mapping), not trusted to the facade → deterministic + unit-testable.
- **Facade-first, degrade honestly** — when `repoIntelEnabled` and the index is built, serve from
  the cache; else return a valid empty result with an explanatory summary (never throw, never blank).
- **Click→code via `file:line`** — callers carry `{file, line}`; the UI links to the GitHub blob (or
  in-app) at that line — the same `githubBlobUrl` pattern used elsewhere.
- **No new DB/migration**; recompute per request (cheap index read).

---

## PART 2 — TDD (prioritized) — ≥3 P0/P1 per feature

**IDs** `<REQ>.<PRIO>.<n>`. REQs: **C** compose · **R** route · **D** degraded/empty ·
**N** non-functional · **V** view · **K** click→code · **G** graph/empty · **I** tab.
Layers: `unit` (hermetic), `it` (testcontainers), `client` (vitest+jsdom).

### C — Composition `mapFacadeBlast` + helpers (server unit)
| ID | P | Assert |
|---|---|---|
| **C.P0.1** | P0 | groups callers by `viaSymbol` → one `DownstreamImpact` per reached symbol; `callers[]` map `{file,symbol,line}` |
| **C.P0.2** | P0 | endpoints/crons attributed from each caller file's `factsByFile` → `endpoints_affected`/`crons_affected` (union, deduped) |
| **C.P0.3** | P0 | duplicate caller rows (same `file|symbol|line`) collapse to one |
| **C.P1.1** | P1 | `summarizeBlast`: "N changed symbols · M callers · K endpoints · J cron/jobs affected." (sing/plural); empty → `NO_SYMBOLS_SUMMARY` |
| **C.P1.2** | P1 | `callerName`: names the enclosing top-level symbol of the caller line, else the file basename |

### N — Non-functional invariants (server unit + it)
| ID | P | Assert |
|---|---|---|
| **N.P0.1** | P0 | **≤20 callers per symbol**, sorted by `rank` desc (highest-ranked kept) |
| **N.P0.2** | P0 | the **declaring file is excluded** from a symbol's callers |
| **N.P0.3** | P0 | **NO LLM call**: `MockLLM.calls.length === 0` after `GET /blast` (free feature) |

### R — Route `GET /pulls/:id/blast` (server it)
| ID | P | Assert |
|---|---|---|
| **R.P0.1** | P0 | returns `BlastRadius` shape (`changed_symbols`, `downstream`, `summary`) from the mocked facade |
| **R.P0.2** | P0 | **facade-first**: `repoIntelEnabled` + non-degraded facade → response derived from the facade result |
| **R.P1.1** | P1 | unknown PR → 404; queries workspace-scoped |
| **R.P1.2** | P1 | demo-shaped input (shared helper, ≥2 callers, ≥1 endpoint) → `downstream` has ≥2 callers & ≥1 endpoint |

### D — Degraded / empty (server it)
| ID | P | Assert |
|---|---|---|
| **D.P0.1** | P0 | repo **not cloned** (`clonePath` null) → empty `changed_symbols`/`downstream` + `NOT_CLONED` summary (not blank/500) |
| **D.P0.2** | P0 | **no changed files** → empty + `NO_FILES` summary |
| **D.P1.1** | P1 | facade **degraded** → honest fallback result with an explanatory summary (never throws) |

### V — BlastRadiusView tree (client)
| ID | P | Assert |
|---|---|---|
| **V.P0.1** | P0 | renders one node per `changed_symbols` (name + caller count) |
| **V.P0.2** | P0 | first node **open by default** → its callers (`file:line`) + endpoints visible |
| **V.P1.1** | P1 | additional symbols render **collapsed** (callers hidden until expand) |

### K — Click caller → code (client)
| ID | P | Assert |
|---|---|---|
| **K.P0.1** | P0 | clicking a caller (`file:line`) fires `onWhy(file, line)` with the exact file + line |
| **K.P0.2** | P1 | with no `onWhy`, the caller still renders (no crash) / links to the blob URL |

### G — Graph + empty state (client)
| ID | P | Assert |
|---|---|---|
| **G.P0.1** | P0 | Tree/Graph toggle → clicking **graph** renders the SVG (`aria-label="Blast radius graph"`) |
| **G.P1.1** | P1 | `changed_symbols: []` → renders the **summary text** (empty state), not a blank panel |

### I — Blast tab integration (client)
| ID | P | Assert |
|---|---|---|
| **I.P0.1** | P0 | the PR page's **Blast tab** renders `BlastRadiusView` from `useBlast(prId)` |
| **I.P1.1** | P1 | `useBlast(prId)` calls `GET /pulls/:id/blast`, `enabled` only when `prId` set |

### 2.1 Test → acceptance matrix
| Acceptance | Tests |
|---|---|
| ≥2 callers & ≥1 endpoint on shared-helper PR | R.P1.2, C.P0.1/2 |
| click caller → code at the line | K.P0.1, V.P0.2 |
| no LLM call | N.P0.3 |
| empty state when no data | D.P0.1/2, G.P1.1 |
| fast / index-read-only | D.* (no parse path), N.P0.3 |
| cap 20 / sort rank / exclude decl | N.P0.1/2 |

### 2.2 Test files & harness
- `server/test/blast-compose.test.ts` — **C + N.P0.1/2** (pure `mapFacadeBlast`/`summarizeBlast`/`callerName`, no Docker).
- `server/test/blast.it.test.ts` — **R + D + N.P0.3** (testcontainers): seed repo+PR+prFiles; `buildApp({overrides:{repoIntel: mock, llm:{openrouter: MockLLM}}})`; `inject('GET /pulls/:id/blast')`; assert body + `mock.calls===0`.
- `client/.../BlastRadius/BlastRadius.test.tsx` — **V + K + G** (mock nothing heavy; `NextIntlClientProvider` w/ `blast.json`).
- `client/.../BlastTab.test.tsx` (or in page) — **I** (mock `useBlast`).

### 2.3 Counts
Compose 5 · Non-functional 3 · Route 4 · Degraded 3 · View 3 · Click 2 · Graph 2 · Tab 2 = **24 tests**.
Gate: all P0 green + typecheck 0 (client/server/reviewer-core) + a `pnpm verify` alias green.
