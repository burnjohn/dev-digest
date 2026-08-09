---
name: onion-architecture
description: Use when designing, implementing, reviewing, or refactoring backend modules involving Fastify routes, Zod boundaries, use cases, business rules, Drizzle/PostgreSQL persistence, jobs, streams, external SDKs, dependency injection, or module boundaries.
---

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
