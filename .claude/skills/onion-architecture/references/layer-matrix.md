# Layer matrix — every file in `server/src`, classified

The lookup table for *"I'm editing `X.ts` — what may I import?"* Classification verified against
the tree on **2026-08-15** (103 `.ts` files under `server/src`).

Paths are relative to `server/src/`.

---

## 1. Path patterns → ring

Read top to bottom; **first match wins**. This ordering matters — `platform/container.ts` must be
caught by the R6 pattern before the R1 `platform/*.ts` pattern sees it.

| Order | Pattern | Ring |
|---|---|---|
| 1 | `app.ts`, `server.ts`, `platform/container.ts`, `modules/index.ts` | **R6** composition root |
| 2 | `db/{migrate,seed,seed-prompts}.ts` | **tools** — outside the rings |
| 3 | `vendor/shared/**` | **R0** contracts + ports |
| 4 | `platform/infra/**` | **R4** driven adapters |
| 5 | `platform/*.ts` | **R1** kernel |
| 6 | `adapters/**`, `db/**` | **R4** driven adapters |
| 7 | `modules/*/routes.ts`, `modules/_shared/context.ts` | **R5** transport |
| 8 | `modules/*/repository.ts`, `modules/*/repository/*.ts` | **R3** persistence |
| 9 | `modules/**` (everything else) | **R2** application |

## 2. Ring → allowed imports

| Ring | MAY import | MUST NOT import |
|---|---|---|
| **R0** | `zod`, `vendor/shared/**` | everything else — `fastify`, `drizzle-orm`, `src/**`, node builtins |
| **R1** | R0, `@devdigest/reviewer-core`, `zod`, `platform/*.ts` | `drizzle-orm`, `db/**`, `adapters/**`, `modules/**`, `fastify`, any other npm package ‡ |
| **R2** | R0, R1, engine, own module's R3, `db/rows.ts`, `type { Db } from db/client.js`, node builtins | `drizzle-orm`, `db/schema*`, `platform/container`, `fastify`, another module's anything |
| **R3** | R0, R1, `drizzle-orm`, `db/**` | `platform/container`, `adapters/**`, `modules/**` (incl. its own service), `fastify` |
| **R4** | R0, R1, engine, `drizzle-orm`, npm SDKs, node builtins | `modules/**`, `platform/container`, `fastify` |
| **R5** | R0, R1, own module's R2, `_shared/`, `fastify`, `fastify-type-provider-zod`, `app.container` | `drizzle-orm`, `db/**`, `adapters/**`, another module's anything, own module's R3 † |
| **R6** | everything | — |
| **tools** | anything | must be imported by nothing under `src/**` |

† Shrink-only exception: `workspace/routes.ts` and `polling/routes.ts` (pass-through modules with
no service) may reach their own persistence. No module joins that list.

‡ Bounded exceptions in force: `platform/config.ts` → `dotenv/config`; `platform/run-logger.ts` →
`import type { RunBus } from './sse.js'` (type-only).

---

## 3. Every file, classified

Legend: ✅ compliant · ⚠️ deviation with a verdict in `SKILL.md` §7 · 🔻 dead code.

### R0 — contracts + ports · `vendor/shared/**`

| File | Status |
|---|---|
| `vendor/shared/adapters.ts` | ✅ ports: `LLMProvider`, `Embedder`, `GitHubClient`, `GitClient`, `CodeIndex`, `AuthProvider`, `SecretsProvider` |
| `vendor/shared/index.ts` | ✅ barrel — the package entry point, the one legitimate barrel |
| `vendor/shared/contracts/{brief,eval-ci,findings,knowledge,observability,platform,productionize,review-api,trace,why}.ts` | ✅ Zod only |

The whole of `vendor/shared/**` imports nothing but `zod` and itself. **This ring is clean — keep it that way.**

### R1 — kernel · `platform/*.ts`

| File | Status |
|---|---|
| `platform/errors.ts` | ✅ zero imports |
| `platform/resilience.ts` | ✅ zero imports |
| `platform/model-router.ts` | ✅ |
| `platform/price-book.ts` | ✅ R0 only |
| `platform/trace-builder.ts` | ✅ R0 only |
| `platform/run-logger.ts` | ✅ R0 + `import type { RunBus }` from `sse.ts` — type-only, survives the `infra/` move |
| `platform/config.ts` | ✅ `zod` + node builtins + `dotenv/config` (bounded exception: it *is* the env boundary) |
| `platform/grounding.ts` | ⚠️ re-export shim → delete (SKILL §1) |
| `platform/prompt.ts` | ⚠️ re-export shim → delete |
| `platform/structured.ts` | ⚠️ re-export shim → delete; 2 src + 4 test importers |

### R2 — application · `modules/**`

| File | Status |
|---|---|
| `modules/_shared/schemas.ts` | ✅ `zod` only |
| `modules/agents/{constants,helpers}.ts` | ✅ |
| `modules/agents/service.ts` | ⚠️ **V1** — takes `Container` |
| `modules/pulls/status.ts` | ✅ R0 only — the one clean file in `pulls/` |
| `modules/repo-intel/{constants,types}.ts` | ⚠️ **V6/V8** — `constants.ts` is imported by `repos/service.ts` and by two adapters |
| `modules/repo-intel/service.ts` | ⚠️ **V1** |
| `modules/repo-intel/pipeline/{full,incremental}.ts` | ⚠️ **V1** |
| `modules/repo-intel/pipeline/{rank,repo-map,walk}.ts` | ✅ |
| `modules/repo-intel/index.ts` | 🔻 dead barrel, zero importers — and it re-exports `repository.js`, leaking R3. **Delete** |
| `modules/repos/{constants}.ts` | ✅ |
| `modules/repos/helpers.ts` | ⚠️ **V3** — `typeof t.repos.$inferSelect` at `helpers.ts:50` |
| `modules/repos/service.ts` | ⚠️ **V1** + **V6** |
| `modules/reviews/{constants,findings,helpers}.ts` | ✅ |
| `modules/reviews/diff-loader.ts` | ⚠️ **V1** + **V3** (type leak, `diff-loader.ts:17`) |
| `modules/reviews/run-executor.ts` | ⚠️ **V1** + **V3** (type leaks at `:58`, `:141`) |
| `modules/reviews/service.ts` | ⚠️ **V1** |
| `modules/settings/{constants,helpers}.ts` | ✅ |
| `modules/settings/feature-models.ts` | ⚠️ **V1** + **V2** — a repository wearing a helper's name; split into R2 defaults + R3 read |

### R3 — persistence · `modules/*/repository*.ts`

| File | Status |
|---|---|
| `modules/agents/repository.ts` | ✅ |
| `modules/repo-intel/repository.ts` | ✅ |
| `modules/repos/repository.ts` | ✅ |
| `modules/reviews/repository/{pull,review,run}.repo.ts` | ✅ free functions taking `db` first — the shape to copy |
| `modules/reviews/repository.ts` | ⚠️ **V7** — class façade re-declaring parameter types |

### R4 — driven adapters · `adapters/**`, `db/**`, → `platform/infra/**`

| File | Status |
|---|---|
| `adapters/{codeindex/extract,codeindex/ripgrep,embedder/openai,git/diff-parser,git/simple-git,github/octokit,llm/pricing,mocks,secrets/local,tokenizer/index}.ts` | ✅ |
| `adapters/llm/{anthropic,openai}.ts` | ⚠️ import `platform/structured.js` — the shim that misreports the dependency (SKILL §1) |
| `adapters/astgrep/index.ts` | ⚠️ **V8** — `astgrep/index.ts:25` imports `modules/repo-intel/constants.js` |
| `adapters/depgraph/index.ts` | ⚠️ **V8** — `depgraph/index.ts:20` |
| `adapters/auth/local.ts` | ⚠️ **V9** — `auth/local.ts:5` imports `db/seed.js`. Its `drizzle-orm` + `db/schema` imports are **blessed** (V3) |
| `adapters/index.ts` | 🔻 dead barrel, zero importers. **Delete** |
| `db/client.ts`, `db/rows.ts`, `db/schema.ts`, `db/schema/*.ts` (14) | ✅ |
| `platform/jobs.ts` | ⚠️ **V3** blessed-relocate → `platform/infra/jobs.ts` |
| `platform/sse.ts` | ⚠️ relocate → `platform/infra/sse.ts` |
| `platform/prompts.ts` | ⚠️ relocate → `platform/infra/prompts.ts` |

### R5 — transport · `modules/*/routes.ts`

| File | Lines | Inline `container.db` | Status |
|---|---|---|---|
| `modules/repos/routes.ts` | 48 | 0 | ✅ **the canonical shape** — copy this one |
| `modules/repo-intel/routes.ts` | 66 | 0 | ✅ |
| `modules/reviews/routes.ts` | 150 | 0 | ✅ |
| `modules/agents/routes.ts` | 178 | 0 | ✅ |
| `modules/workspace/routes.ts` | 34 | 1 | ⚠️ **V2b** blessed pass-through |
| `modules/polling/routes.ts` | 68 | 3 | ⚠️ **V2b** blessed pass-through |
| `modules/settings/routes.ts` | 98 | 3 | ⚠️ **V2** — needs `repository.ts` |
| `modules/pulls/routes.ts` | 381 | 18 | ⚠️ **V2** — the worst offender; needs `repository.ts` + `service.ts` |
| `modules/_shared/context.ts` | 24 | 0 | ✅ the one legal non-R6 `Container` importer |

**Zero routes declare `schema.response`.** All eight. That is the single largest gap in R5
(SKILL §5, Fastify rule 5).

### R6 — composition root

| File | Note |
|---|---|
| `app.ts` | `app.decorate('container', container)` — line 68, the only decorate site |
| `server.ts` | |
| `platform/container.ts` | imports `agents/repository.js`, `reviews/repository.js`, `repo-intel/service.js` — **blessed (V5)**, bounded to `repository.ts` / `service.ts` only |
| `modules/index.ts` | static module registry |

### Tools — outside the rings

`db/migrate.ts` · `db/seed.ts` · `db/seed-prompts.ts`

Nothing under `src/**` may import them. One violation today: **V9**.

---

## 4. Greps that check the rules

Run from `server/`. Each is one line; the trailing comment states what a *compliant* tree returns,
and the parenthesis states what it returns **today** (2026-08-15). All seven were executed as
written — they are copy-pasteable, not illustrative.

```bash
# R1 kernel purity — expect only config.ts's node builtins (today: 2 hits, both node: builtins)
grep -rn "from '" src/platform/*.ts | grep -v "container\.ts\|jobs\.ts\|sse\.ts\|prompts\.ts" | grep -v "@devdigest/\|'zod'\|'\./"
```

```bash
# R2/R5 must not touch SQL — expect 0 (today: 13 lines across 7 files = V2 + V3)
grep -raEn "^import .*(from 'drizzle-orm|db/schema)" src/modules --include=*.ts | grep -v "/repository"
```

```bash
# Container leakage — expect exactly 1: modules/_shared/context.ts (today: 10 files = V1)
grep -rln "import type { Container }" src/modules
```

```bash
# No module imports another module — expect 0 (today: 1 = V6)
grep -rn "from '\.\./[a-z-]*/" src/modules/*/*.ts | grep -v "_shared\|\.\./\.\."
```

```bash
# Adapters are feature-agnostic — expect 0 (today: 2 = V8; -a is needed, depgraph reads as binary)
grep -raEn "^import .*from '.*modules/" src/adapters --include=*.ts
```

```bash
# Tools are not imported — expect 0 (today: 1 = V9)
grep -rn "db/seed\|db/migrate" src --include=*.ts | grep -v "^src/db/"
```

```bash
# Response gate — expect >=1 per route file (today: 0 in all 8)
grep -rc "response:" src/modules/*/routes.ts
```
