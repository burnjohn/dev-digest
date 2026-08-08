# Testing and architecture enforcement

Use the smallest proof that exercises the real boundary. Layer tests establish local behavior; adapter tests establish translation against the real framework or technology; wiring tests establish that composition connects those pieces at runtime.

## Minimum layer test matrix

| Target | Proof |
|---|---|
| Domain policy | hermetic unit test with no framework, database, container, or SDK |
| Application use case | public use-case test with small fakes implementing inner ports |
| Fastify adapter | `app.inject()` with real plugin registration and a fake application seam where needed |
| Drizzle adapter | PostgreSQL Testcontainers `*.it.test.ts` using `pg.handle.db`/`.sql` |
| External adapter | contract/integration test at the vendor/tool boundary |
| Composition root | smoke/wiring test across `route/job → use case → adapter` |
| Architecture | dependency-cruiser valid/invalid fixtures plus the production baseline gate |

Mocking Drizzle query builders, transaction handles, Fastify validation, request/reply objects, or plugin internals does not prove an inner port or a real adapter. Test the application through a small port fake, Fastify through `app.inject()`, and SQL behavior through PostgreSQL.

Contract tests alone do not prove runtime assembly. Keep a smoke/wiring test for every critical path whose composition could break even while its isolated contracts still pass. In this repository that means exercising the real `route/job → use case → adapter` graph rather than trusting type checking or isolated handlers.

## Blocking architecture gate

From the repository root, these are the exact architecture and baseline commands. They are a command reference, not a routine two-command sequence: the final line is subject to the exceptional policy below.

```bash
cd server
pnpm architecture
pnpm exec depcruise-baseline --config .dependency-cruiser.cjs src ../reviewer-core/src
```

`pnpm architecture` is routine and blocking. A new rule violation, a cycle, or a production dependency not covered by the reviewed legacy baseline fails the task; do not downgrade the rule or hide the import.

The gate enforces these rule families:

- cycles;
- domain/application outward imports;
- flat legacy routes importing persistence;
- flat legacy services constructing repositories or using `Container`;
- cross-feature private adapter imports;
- adapter-category coupling;
- `reviewer-core` importing server/infrastructure vendors.

Architecture fixtures must include valid and invalid examples for the relevant rule families so a configuration change proves both acceptance and rejection. The production gate then checks the actual `server/src` and `reviewer-core/src` graph against the checked-in debt inventory.

## Exceptional baseline policy

This command is exceptional. Run it only after reviewing every added and removed violation and recording why each remaining violation is pre-existing debt. Never run it in CI, never regenerate it automatically, and never run it merely to make `pnpm architecture` green.

`.dependency-cruiser-known-violations.json` is debt inventory, not permission. It records legacy violations so strict rules can block new ones. New or copied violations are defects even when a similar path already appears in the file. When a migrated path becomes compliant, remove its corresponding baseline entry; do not replace it with a different violation.

Before accepting an intentional baseline change:

1. inspect the baseline diff and map every added or removed entry to an actual import change;
2. reject any addition caused by new or materially changed code;
3. confirm removals correspond to inward dependency improvements;
4. run `pnpm architecture` against the reviewed file;
5. report any unrelated legacy entries left in place without treating them as in-scope work.

## Verification order

For a backend change, run the evidence appropriate to every touched row of the matrix, then type checking, then the blocking architecture gate. A green architecture gate cannot replace behavior, tenant-isolation, transaction, error-mapping, or composition tests; those prove different failure modes.
