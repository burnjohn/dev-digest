---
name: onion-architecture
description: "Where backend code goes in `server/` — which ring a file sits in and what it may
  import, not how to write the code inside it. Use when creating any file under `server/src/`,
  adding a route/module/adapter/repository, deciding whether a module needs a service, asking
  'can X import Y', when a service takes the whole Container, or reviewing backend structure.
  Covers the ring model over modules/adapters/platform/db, the import matrix, dependency
  injection via explicit Deps interfaces, contracts-as-domain-types, and the test lane each ring
  implies. Use this even when the user just asks 'where should this DB query go?'"
metadata:
  version: "1.0.0"
---

# Onion Architecture — `server/`

Answers exactly one question: **which ring is this backend file in, and what may it import?**

Everything here is checkable from a file *path* and an *import list* — never from a function body.
The test for whether a rule belongs in this skill: *could you violate it without changing a line
inside any function, only by moving/renaming a file or by adding/removing one `import` statement?*
If not, it belongs to `fastify-best-practices` / `drizzle-orm-patterns` / `typescript-expert`
(see [§10](#10-adjacent-not-covered-here)).

One extra dimension over the frontend twin (`frontend-ui-architecture`): the import edge. And no more.

**Scope is `server/` only.** `reviewer-core/` is the exemplar of a pure core and appears in the
diagram as an inner dependency, but is governed by its own
[reviewer-core/AGENTS.md](../../../reviewer-core/AGENTS.md). No rule here targets it.

---

## 1. The rings

Mapped onto real folders. `server/src` unless noted.

```
   R6  composition root   │ app.ts · server.ts · platform/container.ts · modules/index.ts
   R5  transport          │ modules/<m>/routes.ts · modules/_shared/context.ts
   R4  driven adapters    │ adapters/** · db/client.ts · db/schema/** · platform/infra/**
   R3  persistence        │ modules/<m>/repository.ts · repository/*.repo.ts  (module-private)
   R2  application        │ modules/<m>/{service,helpers,constants,types}.ts · pipeline/**
   R1  platform kernel    │ platform/*.ts (pure)
   R0  contracts + ports  │ vendor/shared/**          ← imports only `zod`
        ↑ everything points inward.  reviewer-core/ sits alongside R0/R1 as a pure engine
          the server depends on and never the reverse.
```

Higher number = further out. **An outer ring may import any inner ring directly** — that is what
separates an onion from classic layering (Palermo, part 3). Inner may never import outer. The one
exception is R6, which is *defined* as the place that names everything.

The rule already lives in the codebase, unenforced:
[vendor/shared/adapters.ts](../../../server/src/vendor/shared/adapters.ts) says *"ALL external
calls go behind these interfaces… Services depend on the interface, not the impl."* This skill is
that sentence, made checkable.

### `platform/` is not one ring — it splits

Seven files are the pure R1 kernel: `errors` · `resilience` · `model-router` · `price-book` ·
`trace-builder` · `run-logger` · `config`. Three own real I/O and belong in a new
**`platform/infra/`** (R4): `jobs.ts` (a durable queue over the `jobs` table), `sse.ts` (a
process-global `EventEmitter`), `prompts.ts` (a `node:fs` template loader). `container.ts` is R6.

`platform/infra/` is **target state** — the three files still sit at `platform/*.ts` today. New
I/O-owning platform code goes in `infra/` from day one; the three are a listed deviation, not a
precedent.

The kernel then has one checkable property:

> **No file in `platform/*.ts` imports `db/**`, `adapters/**`, `modules/**`, or any npm package
> other than `zod`.**

Two bounded exceptions, both real today: `config.ts` imports `dotenv/config` (it *is* the env
boundary), and `run-logger.ts` does `import type { RunBus } from './sse.js'` — type-only, and it
survives the move to `infra/` unchanged because a type import carries no runtime edge.

### Two calls the skill makes outright

- **`process.env` is read in `platform/config.ts` and `adapters/secrets/local.ts` — nowhere under
  `modules/**`.** `config.ts` parses env into `AppConfig`; the `SecretsProvider` is the one
  chokepoint for keys, which `config.ts`'s own header states. (`db/{migrate,seed}.ts` also read it
  and are exempt — tools, outside the rings; `adapters/git/simple-git.ts` *writes* two subprocess
  vars, which is an adapter configuring its own child process.)
- **The three re-export shims `platform/{grounding,prompt,structured}.ts` should be deleted** and
  their six importers pointed at `@devdigest/reviewer-core` directly. Today
  [adapters/llm/openai.ts](../../../server/src/adapters/llm/openai.ts) imports
  `platform/structured.js`, which makes an *adapter* look like it depends on the *kernel* when it
  actually depends on the engine. A shim that misreports the dependency graph is worse than none.

### Where Zod contracts sit — the tension, resolved

`vendor/shared/` holds two things that must never be conflated:

- **`adapters.ts` = ports.** Interfaces defined innermost, implemented outermost. This is the real
  dependency inversion.
- **`contracts/*.ts` = Zod schemas.** Simultaneously the wire shape, the DTO, and the client's types.

**Position: in DevDigest the wire contract *is* the domain type. Do not build a parallel domain
model.** Domain *state* lives in Postgres; domain *logic* lives in `reviewer-core`. A
`domain/entities/` layer would be pure ceremony, and a server-only model would immediately drift
from what the UI renders — the root AGENTS.md rule is *"Edit the contract, not both ends."*

This is unusual but coherent: **ring 0 carries no behaviour**, only schemas and interfaces, so it
has nothing to invert. Bounded by three hard rules:

1. R0 imports `zod` and itself. Nothing else, ever.
2. Contracts are serializable wire shapes — no classes, no `Date` on the boundary.
3. **A Drizzle row type never enters `vendor/shared`, and a contract type never enters a
   `repository.ts` signature.** The mapping happens in `helpers.ts`. `toRepoDto` in
   [modules/repos/helpers.ts](../../../server/src/modules/repos/helpers.ts) is the canonical example.

[db/rows.ts](../../../server/src/db/rows.ts) is the counterpart: shared row types, `import type`
only, legal anywhere in `modules/**`. It already exists with exactly this rationale in its header —
this skill promotes it from an accident to a rule.

---

## 2. The dependency matrix

The one table the skill exists for. Every cell is a path pattern; nothing here requires reading a
function body.

| Ring | Path | MAY import | MUST NOT import |
|---|---|---|---|
| **R0** contracts + ports | `vendor/shared/**` | `zod`, itself | everything else — `fastify`, `drizzle-orm`, `src/**`, node builtins |
| **R1** kernel | `platform/*.ts` (not `infra/`, not `container.ts`) | R0, `@devdigest/reviewer-core`, `zod`, itself | `drizzle-orm`, `db/**`, `adapters/**`, `modules/**`, `fastify`, any other npm package ‡ |
| **R2** application | `modules/<m>/{service,helpers,constants,types}.ts`, `modules/<m>/pipeline/**`, `modules/_shared/**` | R0, R1, engine, own module's R3, `db/rows.ts` and `type { Db }` (type-only), node builtins | `drizzle-orm`, `db/schema*`, `platform/container`, `fastify`, **another module's anything** |
| **R3** persistence | `modules/<m>/repository.ts`, `modules/<m>/repository/*.repo.ts` | R0, R1, `drizzle-orm`, `db/**` | `platform/container`, `adapters/**`, `modules/**` (including its own service), `fastify` |
| **R4** driven adapters | `adapters/**`, `platform/infra/**`, `db/**` | R0, R1, engine, `drizzle-orm`, npm SDKs, node builtins | **`modules/**`**, `platform/container`, `fastify` |
| **R5** transport | `modules/<m>/routes.ts` | R0, R1, own module's R2, `_shared/`, `fastify`, `fastify-type-provider-zod`, `app.container` | `drizzle-orm`, `db/**`, `adapters/**`, another module's anything, own module's R3 † |
| **R6** composition root | `app.ts`, `server.ts`, `platform/container.ts`, `modules/index.ts` | **everything** | nothing — this is what a composition root is for |

† Named exception, **shrink-only**: `workspace/` and `polling/` are pass-through modules that go
routes → repository with no service. No module joins that list.

‡ Bounded exceptions in force: `config.ts` → `dotenv/config`; `run-logger.ts` → `type { RunBus }`.

**The `type { Db }` carve-out in R2 is deliberate and load-bearing.** A service's `Deps` interface
needs to name `Db` to stay structurally compatible with `Container` ([§3](#3-dependency-injection--deps-not-container)).
Holding a `Db` handle buys nothing without `drizzle-orm` operators and `db/schema` tables — both
still banned — so the property that matters survives intact: **application code cannot write SQL.**

### Three cross-cutting rules

1. **`platform/container.ts` may be imported by R6, by `modules/*/routes.ts`, and by
   `_shared/context.ts`. Nowhere else.**
2. **No module imports another module.** `_shared/` is the only shared point, and may hold only
   R0/R1-grade code. When two modules need the same thing, it becomes a port on the container —
   `container.repoIntel` is already the right answer to exactly that case.
3. **No cycles.** Today every service ↔ container pair is a type-only cycle: the structural
   signature of the service-locator pattern, and the argument that ends the debate.

---

## 3. Dependency injection — `Deps`, not `Container`

**A service never takes the `Container`.** It declares an explicit `Deps` interface naming exactly
what it uses. `Container` is a type that only `routes.ts`, `_shared/context.ts`, and the
composition root may name.

The reason it is affordable: `Container` already exposes `db`, `jobs`, `git`, `secrets`, `config`,
`runBus`, `llm(id)`, `github()`, `repoIntel`, `agentsRepo`, `reviewRepo`, `depgraph`, `tokenizer`,
`priceBook` as public members/getters — so a per-service `Deps` interface is **structurally
satisfied by `Container` with no adapter and no container change**:

```ts
export interface RepoServiceDeps {
  db: Db; jobs: JobRunner; git: GitClient; secrets: SecretsProvider;
}

export class RepoService {
  private repo: RepoRepository;
  constructor(private deps: RepoServiceDeps) {
    this.repo = new RepoRepository(deps.db);
  }
}
```

`new RepoService(app.container)` in [modules/repos/routes.ts](../../../server/src/modules/repos/routes.ts)
keeps compiling **untouched**. (Verified, not asserted — see the README.)

Per service: write the interface, `s/this\.container\./this.deps./`, delete
`import type { Container }`. No call sites, no tests, no container edit. One PR per module, and the
remaining `import type { Container }` line is a one-second grep for *"did this module migrate?"*

Three follow-on rules:

- **Lazy resolvers stay lazy.** `container.github()` and `container.llm(id)` resolve secrets on
  call. A `Deps` accepts the *resolver* (`github: () => Promise<GitHubClient>`), never a resolved
  client — otherwise boot-with-no-keys breaks, and booting with no keys is a product requirement.
- **A service constructs its own repository** from `deps.db`. The repository is module-private;
  nothing outside the module names it.
- **`Deps` is the mock seam.** A hermetic test passes an object literal, not a cast.

---

## 4. Where a new thing goes

| What | Where | Rule |
|---|---|---|
| HTTP endpoint | `modules/<m>/routes.ts` | read input → resolve tenancy → one service call → status code |
| Business logic | `modules/<m>/service.ts` | takes `Deps`, never `Container` |
| SQL | `modules/<m>/repository.ts` | the only place `drizzle-orm` may appear inside `modules/` |
| SQL for a big module | `modules/<m>/repository/<aggregate>.repo.ts` | free functions taking `db` first — see [§5 Drizzle](#drizzle) |
| Pure transform, row → DTO | `modules/<m>/helpers.ts` | no I/O, no container |
| Literal used twice in the module | `modules/<m>/constants.ts` | module-private by definition |
| Literal used by two modules | `platform/job-kinds.ts` or a contract | a cross-module constant is a contract |
| Module-local type | `modules/<m>/types.ts` | |
| Shared row shape | `db/rows.ts` | `import type` only; growing this file is the *correct* fix |
| Wire/API type | `vendor/shared/contracts/<new>.ts` | add a file; never edit another's |
| New external dependency | port in R0 → `adapters/<port>/<impl>.ts` → wired in `container.ts` | three files, always that order |
| Retry / timeout / backoff | inside the adapter, via `platform/resilience.ts` | never in a service |
| Background work | `platform/infra/jobs.ts` handler, registered by a service | |
| Pure cross-cutting logic | `platform/<name>.ts` | must import nothing but `zod` |
| One-off script | `db/seed.ts`, `db/migrate.ts` | **tools, outside the rings** — nothing in `src/**` imports them |
| Hermetic test | `test/<name>.test.ts` | |
| DB-backed test | `test/<name>.it.test.ts` | mandatory suffix — see [§5 Tests](#tests) |

---

## 5. Per-tool rules

### Fastify

1. `app.decorate('container', …)` happens in `app.ts` and nowhere else.
2. **Resolve dependencies in the plugin body, not the handler.**
   [modules/repos/routes.ts](../../../server/src/modules/repos/routes.ts) is the canonical shape.
   The one legitimate in-handler read is `getContext(app.container, req)`, request-scoped by nature.
3. A handler does exactly four things: read validated input, resolve tenancy, call **one** service
   method, map a status code. Anything else belongs in the service.
4. Schema-first from R0 contracts. Never hand-roll `.parse()` in a handler.
5. **Declare `schema.response`, not just the request schema.** It is the outward DTO gate — the
   thing that stops a Drizzle row reaching the wire. Zero routes declare one today; that is the
   single largest gap in R5.
6. Plugin ordering is architecture: transport plugins (helmet, cors, rate-limit, SSE, error
   handler) register before modules, so encapsulated module plugins inherit them. Children inherit
   from parents, never the reverse.
7. `FastifyRequest` / `FastifyReply` never appear below R5.

### Drizzle

1. The import allowlist in [§2](#2-the-dependency-matrix) is the whole rule: `drizzle-orm` and
   `db/schema` appear in R3 and R4 only.
2. Row types travel via `db/rows.ts`, `import type` only. **Growing that file is the correct
   response to "I need a row shape in a service"** — not `import * as schema`.
3. Repositories return `XRow` or scalars. `XRow → Contract` mapping is `helpers.ts`'s job.
4. A repository returns row types or DTOs — **never a query builder, never `SQL`, never `Db`** —
   and takes scalars, not query fragments.
5. **Transactions.** There are currently **zero** `.transaction(` call sites in `server/src`, so
   this is prospective and worth fixing before the first one lands: the unit of work is a
   *repository* method. `tx` never escapes the callback and never appears in a service signature
   (Drizzle scopes it to the closure — it is not valid outside). For a multi-aggregate write, widen
   the first parameter to `Db | Transaction` — which is exactly why the free-function form in
   `modules/reviews/repository/*.repo.ts` is the better shape.
6. `db/migrations/**` is generated output. Never hand-edited, never imported.
7. `db/seed.ts` and `db/migrate.ts` are tools outside the rings.

### Zod contracts

1. R0 owns the schema; the service receives already-parsed values.
2. **A `.parse()` below `routes.ts` means the boundary is misplaced.** One exception: an LLM
   response is untrusted input arriving at an *adapter* boundary, correctly parsed by
   `reviewer-core`'s `parseWithRepair`.
3. Extend by adding a file to `contracts/`, never by editing an existing one out from under the client.
4. Never re-declare a contract type server-side.

### External SDKs

1. Port in R0 → implementation in `adapters/<port>/<impl>.ts` → wiring in the container → consumed
   as an **interface type** in R2. Three files, always in that order.
2. **The leaky-abstraction test: the SDK's own types must not appear in the port.** Today each SDK
   symbol (`Octokit`, `SimpleGit`, `OpenAI`, `Anthropic`, `postgres`) appears in exactly one file.
   That is the invariant to preserve.
3. Errors are part of the port. An adapter translates to `ExternalServiceError` / `ConfigError`;
   SDK error classes never escape `adapters/`.
4. Retries and timeouts live in the adapter via `platform/resilience.ts`, never in a service.
5. Degradation is the adapter's declared contract (`DepGraph.buildEdges` "never throws — returns
   `[]`") and belongs in the *interface's* doc comment, not only the implementation's.
6. **Driven adapters are feature-agnostic.** An adapter never imports `modules/**`. If a constant
   describes what the adapter does, it belongs to the adapter.
7. A new port ⇒ a new mock in `adapters/mocks.ts` in the same PR.

### Tests

**Once the onion holds, the CI lane is derivable from the ring instead of remembered.** The
mechanical rule, which matches the existing convention in `server/AGENTS.md`:

> A test needs the `.it.test.ts` suffix **iff** its subject directly imports `drizzle-orm`,
> `postgres`, `db/client`, or a `repository.ts`.

| Ring | Lane |
|---|---|
| R0 / R1 / R2 | hermetic `.test.ts`, `Deps` supplied as an object literal |
| R3 | `.it.test.ts` |
| R4 / R5 | both — `.it` only when the DB is real |

Hermetic service tests today exist only by defeating the type system: both
`test/repo-intel-facade-degraded.test.ts` and `test/repo-intel-resync.test.ts` build a fake
container with `as never` and then write a private field
(`(svc as unknown as {repo: …}).repo = {…}`). That is not a testing-style problem — it is the
service-locator pattern billing you. **[§3](#3-dependency-injection--deps-not-container) is what
unlocks writing them honestly**, and that is the concrete payoff, not an aesthetic one.

---

## 6. Enforcement — rules only, deliberately

**These rules are not machine-checked.** That is a choice, not an oversight: `server/` has no
linter at all, and adding one to enforce a dozen path rules would immediately raise the much larger
*"so which style rules do we also turn on?"* argument. The rules are therefore written as path
patterns, so they stay checkable by eye, by grep, or by a tool later.

The door is open and the cost is unusually low: `dependency-cruiser@^17.4.3` is **already** a
`server/` dependency (it drives `adapters/depgraph/index.ts`), so automating this would add zero
packages. Its `forbidden` rules take regex `path`/`pathNot` pairs with `$1` group matching — enough
to express every row of [§2](#2-the-dependency-matrix), including "no module imports another
module" — and `depcruise-baseline --ignore-known` would grandfather existing edges at edge
granularity while failing new ones. No config is shipped with this skill.

Until then: [§7](#7-known-violations-and-their-verdicts) is the baseline, written down.

---

## 7. Known violations and their verdicts

Verified in the tree on 2026-08-15. Repairs, cheapest first, are in
`references/migration-playbook.md`.

| # | Violation | Verdict | Repair |
|---|---|---|---|
| **V1** | `constructor(private container: Container)` — 9 files carry `import type { Container }` illegally | **Forbidden** | Per-service `Deps` interface. Cost is near zero — [§3](#3-dependency-injection--deps-not-container) |
| **V2** | `pulls` / `settings` have no service and no repository | **Forbidden** | Extract `repository.ts` + `service.ts`. `settings/feature-models.ts` is already a repository wearing a helper's name — split it |
| **V2b** | `polling` / `workspace` have no service | **Blessed** | Pass-through modules; the named shrink-only exception |
| **V3** | `drizzle-orm` / `db/schema` outside repositories | **Split** | `run-executor`, `diff-loader`, `repos/helpers` are *type* leaks (`typeof schema.repos.$inferSelect`) → add `RepoRow` to `db/rows.ts`. `platform/jobs.ts` → **blessed, relocate** to `platform/infra/`. `adapters/auth/local.ts` → **blessed** (an adapter's store may be Postgres) |
| **V4** | DB not behind a port; concrete repositories over a concrete `Db` | **Blessed, bounded** | No repository interfaces. The bounds are [§5 Drizzle](#drizzle) rules 3–4. Promote to an interface on the second implementation, never before |
| **V5** | `container.ts` imports module repositories and services | **Blessed** | That is what a composition root is. Bound: it may import a module's `repository.ts` / `service.ts` only — never `helpers.ts`, `constants.ts`, or `routes.ts` |
| **V6** | `repos/service.ts` imports `repo-intel/constants.js` | **Forbidden** | A job kind is a contract *between* modules → hoist `INDEX_JOB_KIND` / `REFRESH_JOB_KIND` to `platform/job-kinds.ts`. Two constants, three files |
| **V7** | `reviews/repository.ts` is a class façade re-declaring parameter types | **Forbidden as a pattern** | Do *not* restructure — the split-by-aggregate is good. Kill only the duplication: `values: Parameters<typeof runRepo.completeAgentRun>[2]`. There is a logged bug from exactly this ([server/INSIGHTS.md](../../../server/INSIGHTS.md), 2026-08-09: a `TS2353` that points at the wrong file) |
| **V8** | `adapters/{astgrep,depgraph}` import `modules/repo-intel/constants.js` | **Forbidden** | Pure onion permits outer→inner, so the rule here is sharper: **driven adapters are feature-agnostic.** `SUPPORTED_EXT` describes what the parsers parse → move to `adapters/astgrep/constants.ts` |
| **V9** | `adapters/auth/local.ts` imports `db/seed.js` | **Forbidden** | `seed.ts` / `seed-prompts.ts` / `migrate.ts` are tools outside the rings — nothing in `src/**` may import them. Move the two constants to `db/constants.ts` |

**Migrate one module end-to-end at a time.** Half-migrated is worse than either state.

---

## 8. Escape hatches

- **`reviewer-core` is done.** Out of scope, cited as the exemplar of a pure core.
- **Onion applies *inside* a module, never across the top level.** `modules/<name>/` is already a
  vertical slice, and that is correct (Jovanović: layers within a module, slices at the top). Where
  slice and onion conflict, **the slice wins** and the shared piece becomes a port.
- **Small modules skip the service.** The threshold is behavioural, not line-count: *the moment a
  route body branches on domain state, loops, or touches a second data source, extract the service.*
- **One implementation ⇒ no interface.** Onion works without DDD, CQRS, or an IoC container
  (Palermo, part 4); ceremony you add "for later" is a cost you pay every change.
- **Tools are outside the rings** — `db/seed.ts`, `db/migrate.ts`, `db/seed-prompts.ts`.
- **Placing a file should take under a minute.** If it needs a debate, the answer is almost always
  *"it is two files in two rings"* — `settings/feature-models.ts` is the worked example: a registry
  of defaults (R2) plus a settings read (R3).
- **A spike branch is exempt. `main` is not.**

---

## 9. Anti-patterns

- **A service that takes the container.** Dependencies become invisible at the signature, and the
  only way to test it is to fake the whole world or write a private field.
- **SQL in a route handler.** The HTTP handler *is* the repository, and the operation has no
  callable name. [modules/pulls/routes.ts](../../../server/src/modules/pulls/routes.ts) is 381
  lines with ~18 inline `container.db` queries: "import PRs" cannot be called, reused, or tested.
- **`import * as schema` to read a type.** Use `db/rows.ts`.
- **Top-level `domain/` / `application/` / `infrastructure/` folders.** Fowler: layering "should
  only be applied at a relatively small granularity". Scatters one feature across four directories.
- **A repository interface with one implementation.**
- **A class façade over free repository functions** that re-declares parameter types instead of
  deriving them.
- **`tx` in a service signature.**
- **An adapter that imports a feature module.**
- **A module importing another module's `constants.ts`.**
- **A `shared/` or `common/` module.** `_shared/` holds R0/R1-grade code only; anything with
  behaviour becomes a port.
- **Re-export shims that hide the real dependency.**
- **`process.env` outside `platform/config.ts` and `adapters/secrets/local.ts`.**
- **Returning a Drizzle row from a route with no `schema.response`.**

---

## 10. Adjacent, not covered here

Do not import rules from these areas into a placement decision:

| Question | Owner |
|---|---|
| How to write the route: hooks, lifecycle, encapsulation, serialization perf | `fastify-best-practices` |
| How to write the query: relations, joins, `onConflict`, migration authoring | `drizzle-orm-patterns` |
| Table design, indexes, constraints, pgvector | `postgresql-table-design` |
| Schema authoring: refinements, unions, `safeParse`, error formatting | `zod` |
| Type design, generics, `Parameters<>`, `tsconfig` | `typescript-expert` |
| Authz placement, secret handling, injection, what to expose in a DTO | `security` |
| Where **client** code goes | `frontend-ui-architecture` |

*"Where does this query go" is placement; "is this query N+1" is not. "Which ring owns retries" is
placement; "how many retries" is not.*

---

## Reference files

Read on demand — not needed for most answers:

- **`references/layer-matrix.md`** — the matrix with exact path patterns plus a ring classification
  of every file in `server/src/`. The lookup for *"I'm editing `X.ts` — what may I import?"*
- **`references/migration-playbook.md`** — the nine violations with copy-pasteable repairs, ordered
  cheapest first, each with the grep that finds every call site.
- **`references/examples.md`** — before/after for four archetypes: routes-with-SQL → routes +
  service + repository; `Container` → `Deps` with unchanged call sites; `typeof
  schema.x.$inferSelect` → `db/rows.ts`; cross-module constant → kernel.
