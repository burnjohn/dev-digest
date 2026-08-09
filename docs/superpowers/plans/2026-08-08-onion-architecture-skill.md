# Onion Architecture Backend Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create and validate a repository-scoped `onion-architecture` skill, then enforce its mechanically checkable backend boundaries with a strict `dependency-cruiser` gate that baselines only existing violations.

**Architecture:** Keep the skill entry point concise and route detailed guidance into one-level reference files. Model each backend feature as a small inward-pointing onion (`adapters → application → domain`) with `server/src/app.ts` as the composition root and `reviewer-core` as an infrastructure-independent inner engine. Pair judgment-oriented skill guidance with a checked-in dependency baseline so current debt is visible while every new violation fails locally and in CI.

**Tech Stack:** Agent Skills specification, Markdown, YAML, Fastify 5.2, TypeScript 5.7, Zod 3, Drizzle ORM 0.38, PostgreSQL, Vitest 2, Testcontainers 10, dependency-cruiser 17.4.3, GitHub Actions.

## Global Constraints

- Treat [`docs/superpowers/specs/2026-08-08-onion-architecture-skill-design.md`](../specs/2026-08-08-onion-architecture-skill-design.md) as the approved design and [`docs/research/onion-architecture-backend-sources.md`](../../research/onion-architecture-backend-sources.md) as the canonical source ledger.
- Create the skill at `.claude/skills/onion-architecture`; `.agents/skills` already resolves to `.claude/skills` through the repository symlink.
- Use only `SKILL.md`, `agents/openai.yaml`, and the seven approved one-level `references/` files. Do not add a skill-local README, examples directory, scripts, or assets.
- Keep `SKILL.md` below 500 words. Put technology detail, examples, research provenance, migration rules, and enforcement commands in references.
- Use imperative language in the skill body. The YAML description starts with `Use when`, stays in third person, contains trigger conditions only, and stays below 500 characters.
- Enforce source dependency direction `adapters → application → domain`; runtime calls may go outward only through a port owned by the inner consumer.
- Do not require rich entities, value objects, aggregates, or repositories for simple CRUD merely to make the tree symmetrical.
- Keep Fastify, Zod boundary schemas, Drizzle/PostgreSQL, jobs/SSE transports, SDKs, Git/filesystem tools, queues, and process lifecycle code in adapters or composition.
- Keep `workspaceId` explicit in every tenant-owned use-case and persistence-port call. Do not treat route context as sufficient tenant isolation.
- Keep Drizzle rows, tables, query builders, SQL, transaction handles, and database errors out of domain and application signatures.
- Keep `@devdigest/shared` as the canonical cross-package wire contract source. Map wire contracts to inner types; do not use them as domain entities and do not edit existing contract files for this task.
- Do not edit `server/src/vendor/shared/`, `server/src/db/migrations/`, or `client/src/vendor/ui/`.
- Do not rewrite current backend modules. Existing violations belong in the dependency baseline; only the fixtures and enforcement configuration are application-facing changes in this plan.
- Do not regenerate the baseline in CI. Re-baselining is a reviewed developer action and must never be used to hide a newly introduced violation.
- Preserve all unrelated worktree changes. Do not commit, push, or create a PR unless the user explicitly requests it; use `gh` for any later GitHub operation.

## File Map

| Path | Responsibility |
|---|---|
| `.claude/skills/onion-architecture/SKILL.md` | trigger, core dependency rule, mandatory workflow, reference routing, completion gate |
| `.claude/skills/onion-architecture/agents/openai.yaml` | UI display name, short description, and invocation prompt |
| `.claude/skills/onion-architecture/references/core-rules.md` | layers, inward dependencies, ports, DI, DTO mapping, transaction ownership, one complete TypeScript example |
| `.claude/skills/onion-architecture/references/project-mapping.md` | DevDigest packages, feature-local target tree, shared contracts, `reviewer-core`, jobs/SSE, external tools, composition |
| `.claude/skills/onion-architecture/references/fastify-zod-adapters.md` | HTTP/SSE adapter responsibilities, validation, errors, serialization, `app.inject()` testing |
| `.claude/skills/onion-architecture/references/drizzle-postgres-adapters.md` | persistence ports, row mapping, transactions, tenant scope, constraints, migrations, Testcontainers |
| `.claude/skills/onion-architecture/references/testing-and-enforcement.md` | test matrix, dependency-cruiser rules, baseline policy, local/CI commands |
| `.claude/skills/onion-architecture/references/migration-playbook.md` | strict-incremental flow for touched legacy modules, red flags, rationalization counters |
| `.claude/skills/onion-architecture/references/source-catalog.md` | source IDs and exact URLs copied from the canonical ledger |
| `.claude/skills/README.md` | repository skill catalog entry |
| `server/.dependency-cruiser.cjs` | executable architecture rules for current flat modules and future layered modules |
| `server/.dependency-cruiser-known-violations.json` | reviewed snapshot of existing violations only |
| `server/test/architecture-gate.test.ts` | 18 behavioral checks for every emitted rule family, type-only imports, valid public contracts, and exact raw-to-baseline equality |
| `server/test/fixtures/architecture/**` | 15 static scenario roots / 44 files covering compliant and forbidden dependency shapes |
| `server/package.json` | `architecture` command; dependency-cruiser is already installed |
| `.github/workflows/server-unit.yml` | blocking architecture command in the existing server typecheck job |

---

### Task 1: Capture the skill's RED baseline in clean contexts

**Files:**

- Create temporarily: `/tmp/onion-architecture-skill-eval.XXXXXX/red-micro-*.md`
- Create temporarily: `/tmp/onion-architecture-skill-eval.XXXXXX/red-scenario-*.md`
- Do not modify repository files.

**Interfaces:**

- Consumes: the four prompts and scoring contract below; a fresh agent context that cannot read the approved design, research ledger, or future skill.
- Produces: verbatim baseline outputs and a short failure inventory that Tasks 2–5 must address.

- [ ] **Step 1: Create an isolated evaluation directory**

Run:

```bash
mktemp -d /tmp/onion-architecture-skill-eval.XXXXXX
```

Record the exact returned path. Give evaluation agents only the prompt text below and minimal stack context (`Fastify 5`, `TypeScript`, `Zod 3`, `Drizzle/Postgres`). Use fresh contexts with no conversation fork and no access to `.claude/skills/onion-architecture`, the design spec, or the research ledger.

- [ ] **Step 2: Run five no-guidance micro-test controls**

Run five independent fresh-context passes of this prompt and save each raw response as `red-micro-1.md` through `red-micro-5.md`:

```text
We need POST /workspaces/:workspaceId/reviews/:reviewId/complete in a Fastify + Drizzle API. Deadline is in 20 minutes. Keep it to one route file: validate with Zod, open a Drizzle transaction in the handler, load the review row, decide whether it can complete, update it, and return the row. Do not add abstractions. Give me the exact code shape you would implement.
```

Score each response against these observable requirements:

1. rejects business policy and Drizzle transaction ownership in the route;
2. makes the route a validation/context/result-mapping adapter;
3. introduces an application use case with explicit `workspaceId`;
4. defines an inner persistence/transaction port without Drizzle types;
5. keeps business completion policy framework- and persistence-free;
6. wires the concrete adapter at composition;
7. avoids ceremonial entities or a generic `Repository<T>` when they add no behavior.

The RED control is useful only if at least one repeated failure appears across the five outputs. Read every output manually; do not score by keyword count alone.

- [ ] **Step 3: Run four no-guidance application scenarios**

Run each prompt once in a fresh context and save the raw output.

Scenario A — legacy migration under scope pressure:

```text
The reviews SSE, cancel, and trace routes already work and must ship today. Add workspace isolation with the smallest safe patch. The current routes can reach Container, RunBus, and Drizzle repositories directly. Explain the exact signatures and files you would change; avoid a broad rewrite.
```

Required behavior: thread `workspaceId` through a named application use case/port, keep transport and persistence concerns outer, preserve replay/cancel semantics, add two-workspace tests, and improve the touched boundary without requiring repository-wide migration.

Scenario B — transaction and ORM leakage pressure:

```text
Design a use case that stores a review, run traces, and an outbox event atomically with Drizzle. To reduce boilerplate, pass the Drizzle transaction object into the service and let repository methods accept either db or tx. Show the TypeScript interfaces.
```

Required behavior: reject the Drizzle type in application signatures, define an application-owned unit-of-work/transaction port, keep all row/query/error mapping in the persistence adapter, and state the atomicity boundary.

Scenario C — external SDK and validation pressure:

```text
Add a GitHub repository intelligence refresh using Octokit, simple-git, ast-grep, and Zod. Put it in a reusable RepoIntelService so routes and jobs can call it. Show where every file and schema should live.
```

Required behavior: model routes and jobs as driving adapters, place SDK/tool implementations in external adapters, validate unknown vendor payloads at their boundary, expose inner ports, keep shared orchestration in an application use case, and keep Git/filesystem/SDK types out of the core.

Scenario D — architecture review pressure:

```text
Review this proposed module: domain/review.ts imports a Zod API schema and a Drizzle row type; application/complete-review.ts accepts Container and calls new ReviewRepository(container.db); adapters/http/routes.ts calls the use case. The folders look like Onion Architecture and tests pass. Report only material findings, not style preferences.
```

Required behavior: report outward domain dependencies, service-locator/concrete repository coupling, row/wire-contract leakage, and missing inner ports as material correctness/testability risks; do not approve based on folder names.

- [ ] **Step 4: Distill the actual failure inventory**

For every failed requirement, record the exact choice or rationalization used by the baseline agent. Classify each as:

- discipline failure: the response knows the boundary but accepts the shortcut under deadline/authority pressure;
- shape failure: the response omits a required artifact such as a port, mapper, or composition root;
- conditional failure: the response over-engineers simple CRUD or demands a whole-system rewrite;
- retrieval failure: the response lacks tool-specific Fastify, Zod, Drizzle, Testcontainers, or dependency-cruiser detail.

Tasks 2–5 must address observed failures with the matching guidance form: prohibitions and rationalization counters for discipline failures, positive recipes for output shape, explicit conditions for optional DDD complexity, and references for tool detail.

### Task 2: Scaffold the skill and write the core/project references

**Files:**

- Create: `.claude/skills/onion-architecture/SKILL.md` through the initializer, then replace its generated body in Task 5
- Create: `.claude/skills/onion-architecture/agents/openai.yaml` through the initializer, then regenerate it in Task 5
- Create: `.claude/skills/onion-architecture/references/core-rules.md`
- Create: `.claude/skills/onion-architecture/references/project-mapping.md`

**Interfaces:**

- Consumes: Task 1's failure inventory and the approved design.
- Produces: layer vocabulary, dependency contracts, project placement rules, and the canonical example used by later references.

- [ ] **Step 1: Initialize the exact skill skeleton**

Run from the repository root:

```bash
python /Users/anton/.codex/skills/.system/skill-creator/scripts/init_skill.py onion-architecture \
  --path .claude/skills \
  --resources references \
  --interface display_name="Onion Architecture" \
  --interface short_description="Enforce backend Onion Architecture boundaries" \
  --interface default_prompt='Use $onion-architecture to design or review this backend module with explicit domain, application, port, adapter, and composition boundaries.'
```

Expected structure: only `SKILL.md`, `agents/openai.yaml`, and an empty `references/` directory. Do not request `scripts`, `assets`, or generated examples.

- [ ] **Step 2: Write `core-rules.md`**

Start with this contract table and make every later section consistent with it:

| Layer | Owns | Imports allowed | Imports forbidden |
|---|---|---|---|
| Domain | policies, invariants, domain errors, stable vocabulary | own domain and platform-neutral language APIs | Fastify, Zod wire schemas, `@devdigest/shared`, Drizzle/Postgres, SDKs, `Container`, database rows |
| Application | use cases, application DTOs, inbound/outbound ports, transaction intent | domain and application-owned ports | Fastify, Zod boundary schemas, Drizzle types, concrete repositories, SDK clients, whole `Container` |
| Adapters | HTTP/SSE, persistence, SDK/tool, job/queue translation | application/domain contracts and the implemented technology | private implementation of another adapter; business policy that belongs inward |
| Composition | concrete construction and registration | all implementations required to build the process graph | request-specific orchestration and business decisions |

Include these non-negotiable rules:

- source imports point inward even when runtime control calls an outer adapter through an inner port;
- define a port beside the inner consumer and name methods in use-case language;
- inject the narrowest capability, never the process container;
- map HTTP payloads, shared wire DTOs, vendor responses, database rows, and infrastructure errors at adapter boundaries;
- represent atomic work through an application-owned transaction/unit-of-work port, never a Drizzle handle;
- carry `workspaceId` through tenant-owned inputs and port methods;
- use DDD tactical objects only when they express behavior; a small CRUD use case may use explicit immutable values and ports without fake entities or a generic repository.

Add one complete TypeScript example with these exact inner interfaces:

```ts
export interface Review {
  id: string;
  workspaceId: string;
  status: 'running' | 'completed';
}

export interface ReviewStore {
  findForWorkspace(input: {
    workspaceId: string;
    reviewId: string;
  }): Promise<Review | null>;
  save(review: Review): Promise<void>;
}

export interface ReviewUnitOfWork {
  execute<T>(work: (ports: { reviews: ReviewStore }) => Promise<T>): Promise<T>;
}

export interface CompleteReviewInput {
  workspaceId: string;
  reviewId: string;
}

export type CompleteReview = (input: CompleteReviewInput) => Promise<Review>;
```

Show the use-case factory receiving `ReviewUnitOfWork`, enforcing the completion transition without importing Drizzle, and returning an inner `Review`. Then show only the relevant adapter/composition signatures: `DrizzleReviewUnitOfWork implements ReviewUnitOfWork`, a thin Fastify handler calling `completeReview`, and `buildApp` constructing/injecting both. Explain that production names should follow the actual feature vocabulary rather than copying `ReviewStore` blindly.

- [ ] **Step 3: Write `project-mapping.md`**

Include this default feature-local tree, with a note to omit empty directories:

```text
server/src/modules/<feature>/
  domain/
  application/
    ports/
    use-cases/
  adapters/
    http/
    persistence/
    external/
    jobs/
  index.ts
```

Map repository-specific concerns exactly:

- `server/src/app.ts`: primary composition root;
- `server/src/platform/**`: process-level outer infrastructure and temporary container support during migration;
- `server/src/modules/**`: feature ownership, each non-trivial feature nesting its own onion;
- `server/src/vendor/shared/**`: canonical cross-package Zod wire contracts, mapped at the adapter boundary;
- `reviewer-core`: inner engine whose injected `LLMProvider` is the example secondary port; do not add Fastify, database, GitHub, filesystem, or concrete vendor SDK dependencies;
- HTTP routes, SSE formatting, schedulers, pollers, and queue consumers: driving adapters;
- Drizzle/Postgres, Octokit, OpenAI/Anthropic clients, simple-git, ast-grep, ripgrep/code index, filesystem, clocks, queues, and publishers: driven adapters;
- `index.ts`: deliberate feature contract/use-case exports only, not a barrel exposing private adapters.

Document cross-feature interaction as use-case/public-contract calls. One feature must not import another feature's persistence, HTTP, external, or job adapter.

- [ ] **Step 4: Verify the first references**

Run:

```bash
rg -n "Container|workspaceId|ReviewUnitOfWork|reviewer-core|@devdigest/shared|adapters → application → domain" \
  .claude/skills/onion-architecture/references/core-rules.md \
  .claude/skills/onion-architecture/references/project-mapping.md
```

Expected: each required concept appears in the owning reference, and neither file contains initializer placeholders.

### Task 3: Write the Fastify/Zod and Drizzle/PostgreSQL adapter references

**Files:**

- Create: `.claude/skills/onion-architecture/references/fastify-zod-adapters.md`
- Create: `.claude/skills/onion-architecture/references/drizzle-postgres-adapters.md`

**Interfaces:**

- Consumes: `CompleteReview`, `ReviewStore`, and `ReviewUnitOfWork` from `core-rules.md`.
- Produces: technology-specific translation and testing rules without changing the inner interfaces.

- [ ] **Step 1: Write `fastify-zod-adapters.md` as a positive route contract**

Define every HTTP/SSE adapter in this order:

1. declare request and response schemas;
2. obtain authentication and `workspaceId` context;
3. convert validated transport values into one use-case input;
4. call one application use case;
5. map typed results/errors to status, body, headers, or SSE events.

Include an abbreviated Fastify 5 route example that receives `completeReview: CompleteReview` through plugin options. Keep the handler free of Drizzle, repositories, SDKs, `Container`, and business branching. Use the repository's established 422 validation behavior instead of declaring 400 as a new convention.

State these Zod rules:

- parse unknown HTTP, configuration, event, external API, and persisted-JSON values at the boundary;
- treat `@devdigest/shared` schemas as wire contracts and map them to inner values;
- do not import a Zod schema only to define a domain entity;
- keep database/external asynchronous checks in the use case rather than initial Fastify schema validation;
- define response schemas to prevent accidental field disclosure;
- do not rely on `instanceof ZodError` across the repository's multiple Zod copies; use the existing shape-based error handling convention.

Cover Fastify plugin encapsulation as assembly/lifecycle scope rather than a substitute for application boundaries. Cover SSE transport ownership separately from replay, cancellation, and workspace authorization policy.

- [ ] **Step 2: Add Fastify adapter verification guidance**

Specify `app.inject()` tests that assert:

- invalid transport input produces the established validation response;
- authenticated `workspaceId` reaches the use-case input;
- typed application errors map to stable HTTP status/code pairs;
- response schemas omit private fields;
- SSE/cancel/trace paths verify workspace ownership and preserve wiring through entrypoint to use case.

Fakes replace the application seam, not Fastify internals. Critical flows retain at least one real composition/wiring test.

- [ ] **Step 3: Write `drizzle-postgres-adapters.md`**

Define a persistence adapter as the only owner of:

- Drizzle schema/table imports, query builders, SQL fragments, relations, inferred row types, and transaction handles;
- PostgreSQL error codes, isolation behavior, constraints, and optional row-security policy;
- row-to-inner and inner-to-row mapping;
- `db.transaction` implementation of the application-owned unit-of-work port;
- workspace predicates for every tenant-owned read/write/count/delete operation.

Include a mapper shape that converts a `ReviewRow` to `Review` and throws/maps persistence corruption before returning inward. Do not return `typeof reviews.$inferSelect` from a port.

Show `DrizzleReviewUnitOfWork.execute<T>` creating transaction-scoped adapter instances internally and passing only `{ reviews: ReviewStore }` to the callback. Explicitly reject signatures such as `save(review, tx: NodePgTransaction)` or `service.run(dbOrTx)`.

State that PostgreSQL constraints are persistence defense-in-depth and do not replace business policy. Keep migrations generated with `pnpm db:generate` and applied with `pnpm db:migrate`; never hand-edit `server/src/db/migrations/**`.

- [ ] **Step 4: Add persistence verification guidance**

Require DB-backed `*.it.test.ts` tests through the existing fixture:

```ts
const db = pg.handle.db;
const sql = pg.handle.sql;
```

Cover row mapping, missing records, unique/foreign/check constraints relevant to the adapter, transaction commit/rollback, and two-workspace isolation. Mention the correlated-subquery gotcha: qualify outer columns explicitly rather than relying on Drizzle column interpolation when inner and outer tables share names.

### Task 4: Write testing, enforcement, migration, and source references

**Files:**

- Create: `.claude/skills/onion-architecture/references/testing-and-enforcement.md`
- Create: `.claude/skills/onion-architecture/references/migration-playbook.md`
- Create: `.claude/skills/onion-architecture/references/source-catalog.md`

**Interfaces:**

- Consumes: layer contracts from Tasks 2–3, Task 1 failure inventory, and all 35 source entries in the canonical research ledger.
- Produces: execution checklists, baseline policy, rationalization counters, and skill-local provenance.

- [ ] **Step 1: Write the layer test matrix in `testing-and-enforcement.md`**

Use this exact minimum matrix:

| Target | Proof |
|---|---|
| Domain policy | hermetic unit test with no framework, database, container, or SDK |
| Application use case | public use-case test with small fakes implementing inner ports |
| Fastify adapter | `app.inject()` with real plugin registration and a fake application seam where needed |
| Drizzle adapter | PostgreSQL Testcontainers `*.it.test.ts` using `pg.handle.db`/`.sql` |
| External adapter | contract/integration test at the vendor/tool boundary |
| Composition root | smoke/wiring test across `route/job → use case → adapter` |
| Architecture | dependency-cruiser valid/invalid fixtures plus the production baseline gate |

State that mocking Drizzle/Fastify internals does not prove a port or adapter. Preserve the repository insight that contract tests alone miss broken runtime wiring.

- [ ] **Step 2: Document the architecture command and baseline policy**

Document these commands exactly:

```bash
cd server
pnpm architecture
pnpm exec depcruise-baseline --config .dependency-cruiser.cjs src ../reviewer-core/src
```

The first command is routine and blocking. The second is exceptional: run it only after reviewing every added/removed violation, never in CI, and never merely to make the gate green. Explain that `.dependency-cruiser-known-violations.json` is debt inventory, not permission.

List the enforced rule families: cycles; domain/application outward imports; flat legacy routes importing persistence; flat legacy services constructing repositories or using `Container`; cross-feature private adapter imports; adapter-category coupling; `reviewer-core` importing server/infrastructure vendors.

- [ ] **Step 3: Write `migration-playbook.md` from the strict-incremental contract**

Use this sequence:

1. characterize the current path with a focused behavior or wiring test;
2. name the use case in business language;
3. define the narrow inner ports and explicit tenant input;
4. move HTTP/Zod and Drizzle/SDK translation behind adapters;
5. inject concrete implementations at `app.ts`/composition;
6. remove the corresponding baseline violation rather than re-baselining it;
7. verify behavior, tenant isolation, transaction semantics, error mapping, wiring, typecheck, and architecture gate.

Include an observable decision table:

| Situation | Required response |
|---|---|
| New module | start compliant; no baseline entry |
| Small change in a legacy module | do not expand the violation; improve the touched seam when safe |
| Boundary must change to implement behavior safely | add a characterization test and migrate that path |
| Unrelated legacy violations | leave in baseline and report them; do not broaden scope |
| Simple CRUD | use an explicit use case/port without invented aggregates |
| Rich invariant/state machine | move reusable policy into domain objects/services |
| Deadline request asks for route/ORM shortcut | keep the boundary; reduce ceremony elsewhere, not dependency safety |

Build the rationalization table and red-flags list from Task 1's actual outputs. It must explicitly counter folder-only compliance, passing `Container` “temporarily,” leaking a Drizzle transaction “only as a type,” and re-baselining a new violation.

- [ ] **Step 4: Write `source-catalog.md` from the canonical ledger**

Copy every source definition and exact URL for these 35 IDs:

```text
OA-01 OA-02 OA-03 HA-01 CA-01 MS-01 MS-02 MS-03 AWS-01
FOW-01 FOW-02 FOW-03
FST-01 FST-02 FST-03 FST-04 FST-05 FZ-01 ZOD-01 ZOD-02 ZOD-03
DRZ-01 DRZ-02 DRZ-03 PG-01 PG-02 PG-03
TS-01 TS-02 DC-01 DC-02 DC-03
VIT-01 VIT-02 TC-01
```

Retain the authority class and one-line “use for” purpose. Link back to `docs/research/onion-architecture-backend-sources.md` for repository evidence and version cautions. Do not introduce additional unsourced architecture claims in this file.

### Task 5: Write the skill entry point, metadata, and catalog entry

**Files:**

- Modify: `.claude/skills/onion-architecture/SKILL.md`
- Regenerate: `.claude/skills/onion-architecture/agents/openai.yaml`
- Modify: `.claude/skills/README.md`

**Interfaces:**

- Consumes: all seven references and Task 1's failure categories.
- Produces: the discoverable skill entry point and repository catalog registration.

- [ ] **Step 1: Replace the initializer body with this concise contract**

Use this frontmatter exactly:

```yaml
---
name: onion-architecture
description: Use when designing, implementing, reviewing, or refactoring backend modules involving Fastify routes, Zod boundaries, use cases, business rules, Drizzle/PostgreSQL persistence, jobs, streams, external SDKs, dependency injection, or module boundaries.
---
```

The body must contain these sections and no “When to use” section:

```markdown
# Onion Architecture

## Core rule

Point every source dependency inward: adapters → application → domain. Let runtime control call outward only through a port owned by the inner consumer. Folder names never override this rule.

## Mandatory workflow

1. Read the relevant `AGENTS.md`, package `INSIGHTS.md`, and existing module wiring.
2. Classify each changed artifact as domain, application, adapter, or composition.
3. Name the use case and define inbound/outbound ports beside their inner consumer.
4. Inspect imports, runtime parsing, DTO/row mapping, transaction ownership, `workspaceId`, and cross-feature calls before editing.
5. Keep every new dependency compliant. When changing a baselined path, do not expand it and remove the violation when the task safely permits.
6. Verify the owning layer's tests, critical runtime wiring, typecheck, and `cd server && pnpm architecture`.

## Non-negotiable boundaries

- Keep domain independent of Fastify, Zod wire schemas, shared transport DTOs, Drizzle/Postgres, SDKs, database rows, and `Container`.
- Keep application dependent on domain and application-owned ports, never concrete adapters, Drizzle types, request/reply objects, SDK clients, or the whole container.
- Keep Fastify/Zod, persistence, external tools, jobs/SSE, and process lifecycle in adapters; map their values and errors before returning inward.
- Carry `workspaceId` through every tenant-owned use case and persistence port.
- Wire concrete implementations in `server/src/app.ts` or narrow composition modules.
- Do not regenerate the known-violations baseline to hide a new violation.

## Reference routing

| Task | Read |
|---|---|
| Layering, ports, DI, DTOs, transactions | [core-rules.md](references/core-rules.md) |
| DevDigest placement, packages, jobs/SSE, external tools | [project-mapping.md](references/project-mapping.md) |
| Fastify routes, Zod, HTTP/SSE, `app.inject()` | [fastify-zod-adapters.md](references/fastify-zod-adapters.md) |
| Drizzle/Postgres, mapping, transactions, tenant scope | [drizzle-postgres-adapters.md](references/drizzle-postgres-adapters.md) |
| Tests, dependency-cruiser, baseline, CI | [testing-and-enforcement.md](references/testing-and-enforcement.md) |
| Existing-module migration or shortcut pressure | [migration-playbook.md](references/migration-playbook.md) |
| Rationale and provenance | [source-catalog.md](references/source-catalog.md) |

For implementation or review, read `core-rules.md`, `project-mapping.md`, and only the technology/migration references the task actually touches.
```

Keep the final body under 500 words. If Task 1 found a recurring discipline rationalization, add its counter to `migration-playbook.md`, not by bloating `SKILL.md`, unless the violation concerns the baseline or inward dependency rule itself.

- [ ] **Step 2: Regenerate `agents/openai.yaml` from the final skill**

Run:

```bash
python /Users/anton/.codex/skills/.system/skill-creator/scripts/generate_openai_yaml.py \
  .claude/skills/onion-architecture \
  --interface display_name="Onion Architecture" \
  --interface short_description="Enforce backend Onion Architecture boundaries" \
  --interface default_prompt='Use $onion-architecture to design or review this backend module with explicit domain, application, port, adapter, and composition boundaries.'
```

Expected YAML contains only quoted `interface.display_name`, `short_description`, and `default_prompt` values. Do not add icons, brand color, MCP dependencies, or invocation policy.

- [ ] **Step 3: Register the skill**

Add this row to the Backend section of `.claude/skills/README.md`:

```markdown
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Onion Architecture boundaries for Fastify, Zod, Drizzle, PostgreSQL, jobs, and SDK adapters |
```

- [ ] **Step 4: Run structural validation before adding enforcement**

Run:

```bash
python /Users/anton/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  .claude/skills/onion-architecture
wc -w .claude/skills/onion-architecture/SKILL.md
```

Expected: validator success and fewer than 500 words.

### Task 6: RED-test the dependency gate with valid and invalid fixtures

**Files:**

- Create: `server/test/architecture-gate.test.ts`
- Create: `server/test/fixtures/architecture/valid/src/modules/reviews/domain/review.ts`
- Create: `server/test/fixtures/architecture/valid/src/modules/reviews/application/complete-review.ts`
- Create: `server/test/fixtures/architecture/invalid/src/modules/reviews/application/complete-review.ts`
- Create: `server/test/fixtures/architecture/invalid/src/modules/reviews/adapters/persistence/review-repository.ts`
- Create: `server/test/fixtures/architecture/npm-invalid/src/modules/reviews/application/parse-review.ts`
- Create: `server/test/fixtures/architecture/cross-feature-invalid/src/modules/repos/service.ts`
- Create: `server/test/fixtures/architecture/cross-feature-invalid/src/modules/reviews/adapters/persistence/review-repository.ts`

**Interfaces:**

- Consumes: future CLI config path `server/.dependency-cruiser.cjs` and rule names `application-depends-only-inward` and `no-cross-feature-imports-into-reviews-adapters`.
- Produces: a hermetic regression test that distinguishes a valid inward dependency from application-to-adapter, application-to-resolved-npm, and feature-root-to-another-feature-private-adapter imports.

- [ ] **Step 1: Add the valid fixture**

`domain/review.ts`:

```ts
export interface Review {
  id: string;
  workspaceId: string;
}
```

`application/complete-review.ts`:

```ts
import type { Review } from '../domain/review.js';

export function completeReview(review: Review): Review {
  return review;
}
```

- [ ] **Step 2: Add the three invalid fixtures**

Application-to-persistence fixture:

`adapters/persistence/review-repository.ts`:

```ts
export const reviewRows = [{ id: 'review-1' }];
```

`application/complete-review.ts`:

```ts
import { reviewRows } from '../adapters/persistence/review-repository.js';

export const completedReviewId = reviewRows[0]?.id;
```

Resolved npm-boundary fixture, `npm-invalid/src/modules/reviews/application/parse-review.ts`:

```ts
import { z } from 'zod';

export const reviewSchema = z.object({ id: z.string() });
```

Cross-feature fixture, `cross-feature-invalid/src/modules/reviews/adapters/persistence/review-repository.ts`:

```ts
export function loadReview() {
  return { id: 'review-1' };
}
```

`cross-feature-invalid/src/modules/repos/service.ts`:

```ts
import { loadReview } from '../reviews/adapters/persistence/review-repository.js';

export const loadRepoReview = loadReview;
```

- [ ] **Step 3: Write the gate behavior test**

```ts
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const serverRoot = fileURLToPath(new URL('../', import.meta.url));
const depcruise = path.join(serverRoot, 'node_modules', '.bin', 'depcruise');

function cruiseFixture(
  name: 'valid' | 'invalid' | 'npm-invalid' | 'cross-feature-invalid',
) {
  return spawnSync(
    depcruise,
    [
      '--config',
      '.dependency-cruiser.cjs',
      '--output-type',
      'err',
      `test/fixtures/architecture/${name}/src`,
    ],
    { cwd: serverRoot, encoding: 'utf8' },
  );
}

describe('backend architecture dependency gate', () => {
  test('accepts application code that depends inward on domain', () => {
    const result = cruiseFixture('valid');
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).toBe(0);
    expect(output).toContain('no dependency violations found');
  });

  test('rejects application code that imports a persistence adapter', () => {
    const result = cruiseFixture('invalid');
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain('application-depends-only-inward');
  });

  test('rejects application code that imports an npm-backed boundary dependency', () => {
    const result = cruiseFixture('npm-invalid');
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain('application-depends-only-inward');
  });

  test("rejects a feature-root import of another feature's private adapter", () => {
    const result = cruiseFixture('cross-feature-invalid');
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain('no-cross-feature-imports-into-reviews-adapters');
  });
});
```

- [ ] **Step 4: Run RED and confirm the expected failure**

Run:

```bash
cd server && pnpm test architecture-gate
```

Expected from-scratch RED: one file with four failing tests because `.dependency-cruiser.cjs` does not exist. The valid fixture receives a non-zero process status, while each invalid fixture's output lacks its required rule name. These assertions preserve the original RED intent: they wait for the actual rules, and a generic process error cannot satisfy them. In the implementation history, the original two fixtures established this absence-of-config RED; the npm and cross-feature fixtures later reproduced two focused RED failures against the first config before the resolved-path correction.

### Task 7: Implement the dependency rules, baseline, package command, and CI gate

**Files:**

- Create: `server/.dependency-cruiser.cjs`
- Create by reviewed command: `server/.dependency-cruiser-known-violations.json`
- Modify: `server/package.json`
- Modify: `.github/workflows/server-unit.yml`
- Extend after broad review: `server/test/architecture-gate.test.ts`
- Extend after broad review: `server/test/fixtures/architecture/**` to 15 scenario roots / 44 static files

**Interfaces:**

- Consumes: the four initial fixture contracts from Task 6, then the complete behavioral matrix required by broad review.
- Produces: `pnpm architecture`, a semantically exact reviewed legacy baseline, an 18-test regression suite, and a blocking CI step.

- [ ] **Step 1: Implement `server/.dependency-cruiser.cjs`**

Use a CommonJS config because `server/package.json` declares ESM. In dependency-cruiser 17.4.3, forbidden-rule `to.path` matches `dependency.resolved`, not the unresolved import specifier. Match packages through stable resolved `node_modules/<package>` paths, enable `preserveSymlinks` for pnpm, and dynamically discover feature names so future features receive cross-feature adapter rules automatically:

```js
const { readdirSync } = require('node:fs');
const path = require('node:path');

const source = String.raw`(?:^|/)src`;
const modules = `${source}/modules`;
const reviewerCore = String.raw`(?:^|/)reviewer-core/src`;
const nodeModules = String.raw`(?:^|/)node_modules`;
const externalModules = `${nodeModules}/(?:@fastify/[^/]+|fastify(?:-sse-v2|-type-provider-zod)?|drizzle-orm|postgres|octokit|openai|@anthropic-ai/sdk|simple-git|@ast-grep/napi|@vscode/ripgrep|p-queue|dotenv)(?:/|$)`;
const drivenModules = `${nodeModules}/(?:drizzle-orm|postgres|octokit|openai|@anthropic-ai/sdk|simple-git|@ast-grep/napi|@vscode/ripgrep|p-queue|dotenv)(?:/|$)`;
const infrastructureCore = String.raw`^(?:node:)?(?:child_process|crypto|fs(?:/promises)?|http|https|net|os|path|stream|worker_threads)(?:/|$)`;
const boundaryModules = [
  externalModules,
  infrastructureCore,
  `${nodeModules}/zod(?:/|$)`,
  String.raw`^src/vendor/shared/`,
];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const featureNames = readdirSync(path.join(__dirname, 'src', 'modules'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => escapeRegex(entry.name));
const adapterKinds = ['http', 'persistence', 'external', 'jobs'];
```

Export an `IConfiguration`-shaped object with these error-severity rule families:

```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular-backend-dependencies',
      severity: 'error',
      from: { path: [`${source}/`, `${reviewerCore}/`] },
      to: { circular: true },
    },
    {
      name: 'domain-depends-only-inward',
      severity: 'error',
      from: { path: `${modules}/([^/]+)/domain/` },
      to: {
        path: [`${source}/`, ...boundaryModules],
        pathNot: [
          `${modules}/$1/domain/`,
          `${modules}/(?!$1/|_shared/)[^/]+/index[.]ts$`,
        ],
      },
    },
    {
      name: 'application-depends-only-inward',
      severity: 'error',
      from: { path: `${modules}/([^/]+)/application/` },
      to: {
        path: [`${source}/`, ...boundaryModules],
        pathNot: [
          `${modules}/$1/(?:application|domain)/`,
          `${modules}/(?!$1/|_shared/)[^/]+/index[.]ts$`,
        ],
      },
    },
    {
      name: 'legacy-routes-do-not-query-persistence',
      severity: 'error',
      from: { path: `${modules}/[^/]+/routes[.]ts$` },
      to: {
        path: [
          `${modules}/[^/]+/(?:adapters/|repository(?:/|[.]ts$))`,
          `${source}/adapters/`,
          `${source}/db/`,
          `${source}/platform/container[.]ts$`,
          drivenModules,
          infrastructureCore,
        ],
      },
    },
    {
      name: 'legacy-services-do-not-construct-infrastructure',
      severity: 'error',
      from: { path: `${modules}/[^/]+/service[.]ts$` },
      to: {
        path: [
          `${modules}/[^/]+/repository(?:/|[.]ts$)`,
          `${source}/adapters/`,
          `${source}/db/`,
          `${source}/platform/container[.]ts$`,
          externalModules,
        ],
      },
    },
    {
      name: 'feature-public-api-does-not-export-adapters',
      severity: 'error',
      from: { path: `${modules}/[^/]+/index[.]ts$` },
      to: { path: `${modules}/[^/]+/adapters/` },
    },
    {
      name: 'reviewer-core-does-not-depend-on-server-or-vendors',
      severity: 'error',
      from: { path: `${reviewerCore}/` },
      to: { path: [String.raw`^src/`, externalModules, infrastructureCore] },
    },
    ...adapterKinds.map((kind) => ({
      name: `no-${kind}-adapter-to-other-adapter-kinds`,
      severity: 'error',
      from: { path: `${modules}/[^/]+/adapters/${kind}/` },
      to: { path: `${modules}/[^/]+/adapters/(?!${kind}/)` },
    })),
    ...featureNames.map((feature) => ({
      name: `no-cross-feature-imports-into-${feature}-adapters`,
      severity: 'error',
      from: { path: `${modules}/(?!${feature}/)[^/]+/` },
      to: { path: `${modules}/${feature}/adapters/` },
    })),
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    preserveSymlinks: true,
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: 'specify',
    exclude: { path: '(?:^|/)(?:dist|coverage)/' },
  },
};
```

The resolved-path details are deliberate:

- scoped and unscoped packages match beneath `(?:^|/)node_modules/`;
- Node builtins match both bare and `node:` forms;
- the `@devdigest/shared` alias resolves to `^src/vendor/shared/`;
- the reviewer-core-to-server target uses `^src/` so it does not mistake sibling `../reviewer-core/src/` paths for server source;
- each generated cross-feature rule starts from the entire other feature, not only its adapters.

- [ ] **Step 2: Run GREEN for the fixture test**

Run:

```bash
cd server && pnpm test architecture-gate
```

Expected for the initial Task 7 GREEN: one file with four passing tests. The valid fixture reports no dependency violations; the application-to-persistence and application-to-npm fixtures report `application-depends-only-inward`; the feature-root cross-feature fixture reports `no-cross-feature-imports-into-reviews-adapters`.

- [ ] **Step 2a: Close broad-review bypasses with a complete behavioral matrix**

Extend the suite to **18 tests across 15 scenario roots / 44 static files**. Keep the initial four fixtures and add behavior checks for:

- cycles;
- both domain-rule shapes, including `src/app.ts`, `_shared`, flat outer files, and the `_shared` barrel;
- application-to-composition, `_shared`, routes, services, repositories, and a type-only infrastructure edge;
- legacy routes reaching repositories, `Container`, global adapters, driven packages, and Node infrastructure while allowing Fastify, Zod, and shared wire contracts;
- legacy services constructing repositories, `Container`, global adapters, and vendors;
- feature public APIs exporting adapters;
- `reviewer-core` reaching server/vendor dependencies;
- all four adapter-category isolation rules;
- whole-feature cross-feature imports into private adapters;
- exact semantic equality between the raw production violations and the checked-in baseline.

The broad-review RED must remain in the evidence: 12 passed / 4 failed before the capture-based inward allowlists and strengthened legacy-route rule. The JSON reporter exits zero even when violations exist, so parse `summary.violations`; do not use JSON process status as the violation signal. The `_shared` barrel regression was separately RED before excluding `_shared` from the public-contract exception. Final expected result: **18/18**.

- [ ] **Step 3: Inspect current violations before writing the baseline**

Run without `--ignore-known`:

```bash
cd server
pnpm exec depcruise --config .dependency-cruiser.cjs --output-type err src ../reviewer-core/src
```

Expected against the current upstream base: exit 32 with **32 errors, 0 warnings, 145 modules, and 451 dependencies cruised**. Inspect every rule/path pair. The reviewed set is 8 reviewer-core server/vendor edges, 5 cycle reports, 11 legacy-service infrastructure edges, and 8 legacy-route persistence edges. Fix false positives in the config before generating a baseline; do not weaken a correct rule because current code violates it.

- [ ] **Step 4: Generate and review the legacy baseline once**

Run:

```bash
cd server
pnpm exec depcruise-baseline --config .dependency-cruiser.cjs src ../reviewer-core/src
```

Review `.dependency-cruiser-known-violations.json` and assert exactly **32** entries. Confirm every entry points to a pre-existing source/import and that the baseline contains no fixture path, config path, or file created by this plan. The behavioral suite must normalize and compare raw and known violations by type, `from`, `to`, cycle legs, and rule severity/name so both new raw violations and stale baseline records fail.

- [ ] **Step 5: Add the routine package command**

Add to `server/package.json` scripts:

```json
"architecture": "depcruise --config .dependency-cruiser.cjs --ignore-known .dependency-cruiser-known-violations.json src ../reviewer-core/src"
```

Do not run `pnpm install`; dependency-cruiser 17.4.3 is already declared and locked, so the lockfile should not change.

- [ ] **Step 6: Prove the baseline passes while fixture violations still fail**

Run:

```bash
cd server
pnpm architecture
pnpm test architecture-gate
```

Expected: both commands exit zero. `pnpm architecture` cruises 145 modules and 451 dependencies, reports no unbaselined violations, and ignores exactly 32 known violations. The fixture test does not pass `--ignore-known`; final verification is **18/18**, including exact raw-to-baseline equality.

- [ ] **Step 7: Add the CI step**

In `.github/workflows/server-unit.yml`, add this step immediately after `pnpm typecheck` in the `typecheck` job:

```yaml
      - run: pnpm architecture
```

Keep it in the existing job because that job already installs server and `reviewer-core` dependencies and uses `working-directory: server`. Do not add baseline generation to the workflow.

### Task 8: GREEN-test and refactor the skill under the same pressure

**Files:**

- Modify only if a test exposes a gap: `.claude/skills/onion-architecture/SKILL.md`
- Modify only if a test exposes a gap: `.claude/skills/onion-architecture/references/*.md`
- Regenerate after any `SKILL.md` trigger change: `.claude/skills/onion-architecture/agents/openai.yaml`
- Use temporary evidence under the exact directory created in Task 1.

**Interfaces:**

- Consumes: Task 1 prompts/controls and the implemented skill path.
- Produces: fresh-context evidence that the skill changes behavior without over-engineering or leaking expected answers.

- [ ] **Step 1: Run five skill-enabled micro-test passes**

Run the exact Task 1 micro-test prompt five times in independent fresh contexts. Give each agent only the prompt plus this invocation:

```text
Use $onion-architecture at .claude/skills/onion-architecture/SKILL.md.
```

Save raw outputs as `green-micro-1.md` through `green-micro-5.md`. Manually score all seven Task 1 requirements. Success requires all five passes to keep Fastify/Drizzle outer, preserve explicit tenant/transaction boundaries, and avoid both the one-file shortcut and ceremonial DDD.

- [ ] **Step 2: Run the four full scenarios with the skill**

Repeat Scenarios A–D verbatim in fresh contexts with the same skill invocation. Success requires every scenario's listed behavior, not merely use of Onion terminology or the target folder names.

- [ ] **Step 3: Refactor only against observed failures**

For a discipline failure, add the exact rationalization and counter to `migration-playbook.md`. For an omitted output artifact, strengthen the positive recipe in the owning reference. For a tool-detail miss, improve reference routing or the technology reference. For over-engineering, strengthen the simple-CRUD condition rather than adding more prohibitions.

Rerun the affected scenario after every wording change. If `SKILL.md` changes, keep it under 500 words and regenerate `agents/openai.yaml` with the Task 5 command.

- [ ] **Step 4: Confirm no guidance regression**

Compare RED and GREEN outputs manually. The skill must improve dependency direction, ports, mapping, tenant scope, transaction ownership, composition, and review severity without causing a full legacy rewrite or mandatory rich DDD model.

After comparison, remove only the exact temporary evaluation directory returned by `mktemp` in Task 1. Print and validate that path starts with `/tmp/onion-architecture-skill-eval.` before deleting it.

### Task 9: Final validation and repository handoff

**Files:**

- Verify: `.claude/skills/onion-architecture/**`
- Verify: `.claude/skills/README.md`
- Verify: `docs/research/onion-architecture-backend-sources.md`
- Verify: `server/.dependency-cruiser.cjs`
- Verify: `server/.dependency-cruiser-known-violations.json`
- Verify: `server/test/architecture-gate.test.ts`
- Verify: `server/package.json`
- Verify: `.github/workflows/server-unit.yml`
- Update only through its script if a new non-obvious fact was confirmed: `server/INSIGHTS.md` or root `INSIGHTS.md`

**Interfaces:**

- Consumes: every deliverable and evaluation result from Tasks 1–8.
- Produces: fresh structural, behavioral, architecture, type, test, provenance, and worktree evidence.

- [ ] **Step 1: Validate the skill package and progressive disclosure**

Run:

```bash
python /Users/anton/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  .claude/skills/onion-architecture
wc -w .claude/skills/onion-architecture/SKILL.md
find .claude/skills/onion-architecture -maxdepth 2 -type f -print | sort
```

Expected: validation success, `SKILL.md` below 500 words, and exactly nine files: `SKILL.md`, `agents/openai.yaml`, and seven references.

- [ ] **Step 2: Verify local links, source parity, and clean Markdown**

Run a read-only local-link check across `SKILL.md` and all references. Then compare external URL sets:

```bash
node -e 'const fs=require("fs"); const a=fs.readFileSync("docs/research/onion-architecture-backend-sources.md","utf8").match(/https:\/\/[^\s)]+/g)||[]; const b=fs.readFileSync(".claude/skills/onion-architecture/references/source-catalog.md","utf8").match(/https:\/\/[^\s)]+/g)||[]; const left=[...new Set(a)].filter(x=>!new Set(b).has(x)); const right=[...new Set(b)].filter(x=>!new Set(a).has(x)); console.log({ledger:new Set(a).size,skill:new Set(b).size,left,right}); if(left.length||right.length||new Set(a).size!==35) process.exit(1);'
```

Expected: `{ ledger: 35, skill: 35, left: [], right: [] }`.

Also run:

```bash
if rg -n "T[B]D|FIX[M]E|example[.]com|[[:blank:]]+$" \
  .claude/skills/onion-architecture \
  docs/research/onion-architecture-backend-sources.md; then exit 1; fi
```

Expected: no matches.

- [ ] **Step 3: Run fresh backend verification**

Run:

```bash
cd server
pnpm test architecture-gate
pnpm architecture
pnpm typecheck
pnpm test --exclude '**/*.it.test.ts'
```

Expected: **18/18** architecture fixture/gate tests pass across 15 scenario roots / 44 fixture files; the production architecture gate cruises 145 modules / 451 dependencies with exactly 32 reviewed violations ignored; typecheck passes; and the hermetic suite passes. Record the fresh file/test totals because they can change as upstream evolves. If the known timing-sensitive cancellation test appears despite the exclusion and the task did not touch it, follow `server/INSIGHTS.md`: rerun its file in isolation before attributing it to this change.

- [ ] **Step 4: Verify discovery and worktree integrity**

Run from the repository root:

```bash
test -f .agents/skills/onion-architecture/SKILL.md
git diff --check
git status --short
```

Expected: the `.agents` alias resolves the new skill, the diff has no whitespace errors, and unrelated pre-existing modifications remain present and untouched.

- [ ] **Step 5: Sweep engineering insights**

Run:

```bash
node .claude/skills/engineering-insights/scripts/insights.mjs status
```

For each genuinely new, non-obvious fact discovered during implementation, route/check/append it through the insights script with exact evidence. Do not create a changelog entry merely because files were added. Report explicitly if no additional insight is worth capturing.

- [ ] **Step 6: Report the handoff**

Report:

- the skill path and seven reference files;
- RED/GREEN behavior changes and any rationalization counters added;
- the architecture rule families and number of reviewed baseline entries;
- validation, fixture test, `pnpm architecture`, typecheck, and hermetic test outputs;
- the 35-source parity result;
- CI integration and uncommitted worktree state;
- any verification gap with its exact command/error rather than implying completion.
