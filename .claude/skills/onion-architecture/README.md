# onion-architecture

Answers one question: **which ring is this backend file in, and what may it import?**

Not how to write the route. Not how to write the query. Which folder, which layer, which import
edges are legal, and which name the operation gets.

- `SKILL.md` — the rules (loaded when the skill triggers)
- `references/layer-matrix.md` — every file in `server/src` classified, plus seven copy-pasteable greps
- `references/migration-playbook.md` — the nine violations with repairs, cheapest first
- `references/examples.md` — before/after for the four archetypes

Scope is **`server/` only**. `reviewer-core/` is cited as the exemplar of a pure core and appears in
the ring diagram as an inner dependency, but is governed by its own `reviewer-core/AGENTS.md`.

---

## Why this exists

The backend already contains most of an Onion — it just was not written down, so it was decaying
unevenly. Ports are declared in `vendor/shared/adapters.ts` with the rule stated in its own header;
implementations live in `adapters/` with `mocks.ts` as the test-double set; `platform/container.ts`
is a real composition root with an `overrides` bag; each SDK symbol appears in exactly one file.
And then roughly half the modules ignore all of it, because nothing says it out loud and nothing
checks.

Placement was also the gap nothing else covered. The existing backend skills are all about *what
happens inside a file*:

| Skill | Covers | Doesn't cover |
|---|---|---|
| `fastify-best-practices` | Hooks, lifecycle, validation, serialization, error handling | Which file the handler's logic belongs in |
| `drizzle-orm-patterns` | Schema, queries, relations, transactions, migrations | Which ring may import `drizzle-orm` |
| `postgresql-table-design` | Types, indexes, constraints | Nothing structural above the table |
| `typescript-expert`, `zod`, `security` | Types, schemas, authz | File placement |

The scope boundary is deliberately sharp, and there is a test for it: *could you violate this rule
without changing a line inside any function — only by moving/renaming a file, or by adding/removing
one `import` statement?* If not, it belongs to another skill. That is the frontend twin's test plus
exactly one dimension (the import edge), and no more.

---

## The position it takes

- **Seven rings** mapped onto real folders, not onto invented ones. An outer ring may call any
  inner ring directly (Palermo, part 3); inner may never call outer.
- **`platform/` splits.** Seven pure files are the kernel; `jobs`/`sse`/`prompts` own real I/O and
  belong in `platform/infra/` (R4); `container.ts` is the composition root (R6).
- **A service never takes the `Container`.** It declares an explicit `Deps` interface. `Container`
  is a type only `routes.ts`, `_shared/context.ts`, and the composition root may name.
- **The wire contract *is* the domain type.** No parallel domain model, no `domain/entities/`.
- **The repository class *is* the port.** No repository interfaces until a second implementation.
- **Rules only — no linter**, for now, with the reasoning stated in §6 rather than left implicit.
- **Onion applies inside a module, never across the top level.** `modules/<name>/` is a vertical
  slice, and where slice and onion conflict, the slice wins.

---

## Points of disagreement

Where the answer here is a synthesis rather than a consensus, the disagreement is shown, not hidden.

**Onion vs vertical slice.** Bogard argues that layering scatters a feature across four directories
and that the slice should be the unit; Palermo argues the opposite axis. This skill does not pick a
winner — it takes Jovanović's arrangement (**slices at the top, layers inside a module**), because
that is what `modules/` already is. The escape hatch says so explicitly: where the two conflict,
the slice wins and the shared piece becomes a port.

**Contract as domain type.** Textbook Onion puts a domain model at the centre and maps DTOs at the
edge. This skill refuses that here, and the refusal is the most contestable call in the document.
It is defensible for one specific reason: **ring 0 in DevDigest carries no behaviour** — only Zod
schemas and interfaces — so there is nothing to invert. Domain state lives in Postgres and domain
logic lives in `reviewer-core`. A server-only model would immediately drift from what the UI
renders, against the root AGENTS.md rule *"Edit the contract, not both ends."* If `vendor/shared`
ever grows behaviour, this call needs revisiting.

**No repository interfaces.** Classic Onion defines `IRepository` inside and implements it outside.
Palermo's own four-years-later retrospective is the counterweight: the pattern works without DDD,
CQRS, or an IoC container, and ceremony added "for later" is paid for on every change. The property
worth having — *application code cannot write SQL* — is bought by the import rule alone. Promote to
an interface on the second implementation, never before.

**Error handling.** `neverthrow` was considered for cross-ring error propagation and **not**
adopted. `platform/errors.ts` plus adapter-level translation to `ExternalServiceError`/`ConfigError`
is the existing answer and it is sufficient; a `Result` type would be a repo-wide change to solve a
problem nobody has reported.

**Rules without a linter.** The frontend twin ends on *"structure is a wish until a linter enforces
it in CI"* and ships a verified ESLint config. This skill deliberately does not, and says so in §6:
`server/` has no linter at all, so adding one to enforce a dozen path rules opens the much larger
"which style rules do we also turn on?" argument. The rules are written as path patterns so they
stay checkable by grep — and `references/layer-matrix.md` ships those greps, tested. That is the
honest halfway house, not an oversight.

**`@fastify/awilix`.** Considered as the DI mechanism and rejected. The hand-rolled `Container` plus
per-service `Deps` interfaces needs no dependency, and the structural-typing trick means adopting it
costs nothing at the call sites.

---

## Sources

All 20 fetched and returning HTTP 200 on **2026-08-15**. Nothing in `SKILL.md` rests on a citation
outside this list.

### Canonical Onion / hexagonal / layering

| Source | Supports |
|---|---|
| [Palermo — The Onion Architecture, part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) | The core rule — all coupling points inward; "the database is not the center. It is external." |
| [Palermo — part 2](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/) | Layer composition; interfaces inside, implementations outside |
| [Palermo — part 3](https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/) | The four tenets; onion vs classic layering — "any outer layer can directly call any inner layer" (§1) |
| [Palermo — part 4, after four years](https://jeffreypalermo.com/2013/08/onion-architecture-part-4-after-four-years/) | Works **without** DDD, CQRS, or an IoC container — the anti-ceremony argument behind V4 |
| [Herberto Graça — Onion Architecture](https://herbertograca.com/2017/09/21/onion-architecture/) | Onion = Ports & Adapters + explicit internal structure; "inner layers define interfaces, outer layers implement" |
| [Alistair Cockburn — Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) | Ports & adapters origin; "developed and tested in isolation from its eventual run-time devices and databases" — the §5 Tests payoff |
| [Martin Fowler — PresentationDomainDataLayering](https://martinfowler.com/bliki/PresentationDomainDataLayering.html) | Layering "should only be applied at a relatively small granularity" — the top-level-folders anti-pattern (§9) and the §8 escape hatch |

### Counter-position (shown, not hidden)

| Source | Supports |
|---|---|
| [Jimmy Bogard — Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/) | Organise by feature, not by technical layer |
| [Milan Jovanović — Where vertical slices fit inside the modular monolith](https://milanjovanovic.tech/blog/where-vertical-slices-fit-inside-the-modular-monolith-architecture) | Layers *within* a module, slices at the top — which is what `modules/` already is |

### Node / TypeScript application

| Source | Supports |
|---|---|
| [Remo Jansen — SOLID and the onion architecture in Node.js with TypeScript](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad) | The Node-flavoured layer taxonomy |
| [Sentry — Atomic Repositories in Clean Architecture and TypeScript](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/) | Repositories accepting an optional Drizzle `tx`; `const invoker = tx ?? db`; where a unit of work may start (§5 Drizzle rule 5) |

### Tool-specific

| Source | Supports |
|---|---|
| [Fastify — Decorators](https://fastify.dev/docs/latest/Reference/Decorators/) | `decorate` as the DI seam; `dependencies` checked before boot |
| [Fastify — Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/) | Children inherit from parents, never the reverse — why plugin ordering is architecture |
| [Fastify — The hitchhiker's guide to plugins](https://fastify.dev/docs/latest/Guides/Plugins-Guide/) | Plugins as the unit of composition; ordering |
| [`@fastify/awilix`](https://github.com/fastify/fastify-awilix) | The container-library alternative — considered and rejected |
| [Drizzle — Transactions](https://orm.drizzle.team/docs/transactions) | `tx` is valid only inside the callback and cannot be passed out — the constraint behind §5 Drizzle rule 5 |
| [Zod](https://zod.dev/) | Schema as the single boundary contract |
| [neverthrow](https://github.com/supermacro/neverthrow) | Considered for cross-ring error handling and **not** adopted |

### Enforcement (context for §6, no config shipped)

| Source | Supports |
|---|---|
| [dependency-cruiser — rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) | `forbidden` rule schema, regex `path`/`pathNot`, `$1` group matching, tsconfig path-alias support, `--ignore-known` baselines |
| [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) | The ESLint alternative, for the record |

---

## Verification performed

The deliverable is documentation, so verification is claim-checking. Everything below was run
against the tree on **2026-08-15**; nothing in the skill is asserted from memory.

**The one claim that could have been wrong was tested, not argued.** §3's structural-compatibility
trick — that `Container` satisfies a per-service `Deps` interface with no call-site edit — was
applied for real to `modules/repos/service.ts` (`RepoServiceDeps { db, jobs, git, secrets }`,
`this.container.` → `this.deps.`) and `pnpm typecheck` was run. It passed: no error in
`service.ts`, and none at `new RepoService(app.container)` in `routes.ts`. The only two errors were
pre-existing and unrelated (`db/migrate.ts:37`, `db/seed.ts:228` — both `string | undefined` on
`DATABASE_URL`; both are tools, outside the rings). The file was then restored byte-for-byte. If
that check had failed, the whole V1 verdict would have needed restating before shipping.

Also verified:

- **Every path pattern in §2 resolves against the real tree**, and the seven greps in
  `references/layer-matrix.md` were executed as written — they are copy-pasteable, not
  illustrative. `platform/*.ts` minus `container`/`jobs`/`sse`/`prompts` is exactly the seven pure
  kernel files.
- **Every violation re-confirmed with a grep**, file:line recorded in the playbook: 10 files import
  `Container` (9 illegally — `_shared/context.ts` is the legal one); 13 illegal `drizzle-orm` /
  `db/schema` import lines across 7 files; 18 inline `container.db` calls in `pulls/routes.ts`; V6,
  V8 and V9 each confirmed at an exact line.
- **The "zero `.transaction(` call sites" claim** — re-grepped, still zero, so §5's transaction rule
  is prospective and labelled as such.
- **All 20 source URLs re-fetched** the day of writing; every one returned 200, so nothing was
  dropped.

### Three plan claims corrected against the tree

The plan this skill was built from asserted three things the code did not support. The skill ships
the corrected versions:

1. **"`process.env` is read in exactly one file."** It is read in two: `platform/config.ts` *and*
   `adapters/secrets/local.ts` — which `config.ts`'s own header states, calling the
   `SecretsProvider` "the one chokepoint that reads `process.env` directly". Plus `db/migrate.ts`
   and `db/seed.ts` (tools, exempt) and `adapters/git/simple-git.ts`, which *writes* two subprocess
   variables. The rule became: **`process.env` never appears under `modules/**`, and in `platform/`
   only in `config.ts`.**
2. **"There is not one hermetic service unit test in the repo."** Two exist —
   `test/repo-intel-facade-degraded.test.ts` and `test/repo-intel-resync.test.ts`. But both buy
   hermeticity with `as never` on a fake container plus a write to a private field. The true claim
   is sharper than the plan's and makes the same point better: hermetic service tests are possible
   today *only by defeating the type system*, and that is the service-locator pattern billing you.
3. **"Most routes omit `schema.response`."** All eight omit it. `grep -rc "response:"
   src/modules/*/routes.ts` returns 0 across the board, which makes it the single largest gap in R5
   rather than a partial one.

One rule was also **added** that the plan's matrix lacked: R2 may `import type { Db } from
'db/client.js'`. The typecheck above proved it is required — a `Deps` interface must name `Db` to
stay structurally compatible with `Container`. It is safe because holding a `Db` handle buys nothing
without `drizzle-orm` operators and `db/schema` tables, both still banned, so *"application code
cannot write SQL"* survives intact.

### Found while verifying, not in the plan

- `src/adapters/index.ts` and `src/modules/repo-intel/index.ts` are **dead barrels** with zero
  importers. The latter re-exports `./repository.js`, which would leak R3 outside its module the
  moment anyone imported it. Both are marked for deletion in the playbook (step 4).
- `platform/run-logger.ts` imports `type { RunBus }` from `sse.ts` — a kernel→infra edge that is
  type-only, and therefore survives the `platform/infra/` move unchanged. Documented as a bounded
  exception rather than silently ignored.
- `platform/config.ts` imports `dotenv/config`, so the kernel's "no npm package but `zod`" rule
  needed one named exception rather than being quietly wrong.

### Not verified

**The trigger check has not been run.** Confirming that a fresh session asking *"where should a new
endpoint's DB query go in the server?"* loads `onion-architecture` rather than
`drizzle-orm-patterns` requires a new session, which cannot be done from inside the one that wrote
the skill. The `description` frontmatter was written against the sibling's proven shape and ends
with that exact phrasing as an edge trigger, but it is untested. **Run it before relying on the
skill firing on its own.**

---

## Changelog

### 1.0.0 — 2026-08-15

Initial release.

- `SKILL.md`: the seven-ring model over real folders, the dependency matrix, `Deps`-not-`Container`
  DI, a what-goes-where table, per-tool rules for Fastify / Drizzle / Zod / SDKs / tests, the
  deliberate no-linter position, the nine known violations with verdicts, escape hatches,
  anti-patterns, and an "adjacent, not covered here" section pointing at the neighbouring skills.
- `references/layer-matrix.md`, `references/migration-playbook.md`, `references/examples.md`.
- Every violation grep-confirmed at file:line; the V1 structural-compatibility claim type-checked
  on a real service rather than asserted.
- Three claims inherited from the source plan corrected against the tree, and one matrix rule added
  (the `type { Db }` carve-out) that the typecheck proved necessary.
