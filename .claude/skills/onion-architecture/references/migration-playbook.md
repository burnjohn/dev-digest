# Strict-incremental migration playbook

Migrate the touched path, not the whole repository. A migration is complete when ownership and source dependency direction improve and the corresponding known violation disappears; moving files into architectural folders without changing their imports is not progress.

## Required sequence

For every changed legacy flow:

1. characterize the current path with a focused behavior or wiring test;
2. name the use case in business language;
3. define the narrow inner ports and explicit tenant input;
4. move HTTP/Zod and Drizzle/SDK translation behind adapters;
5. inject concrete implementations at `app.ts`/composition;
6. remove the corresponding baseline violation rather than re-baselining it;
7. verify behavior, tenant isolation, transaction semantics, error mapping, wiring, typecheck, and architecture gate.

Preserve externally observable behavior while moving ownership. For a tenant-owned flow, `workspaceId` must remain explicit from the driving adapter through the use-case input and every relevant port. If several writes are one business operation, the use case expresses that atomicity through an application-owned unit-of-work port; the outer persistence adapter alone owns the Drizzle transaction.

## Scope decision table

| Situation | Required response |
|---|---|
| New module | start compliant; no baseline entry |
| Small change in a legacy module | do not expand the violation; improve the touched seam when safe |
| Boundary must change to implement behavior safely | add a characterization test and migrate that path |
| Unrelated legacy violations | leave in baseline and report them; do not broaden scope |
| Simple CRUD | use an explicit use case/port without invented aggregates |
| Rich invariant/state machine | move reusable policy into domain objects/services |
| Deadline request asks for route/ORM shortcut | keep the boundary; reduce ceremony elsewhere, not dependency safety |

“When safe” never permits a new outward dependency. It decides how much existing debt can be removed without changing unrelated behavior. The minimum safe changed-flow shape remains `driving adapter → named use case with explicit tenant input → narrow inner port`, with concrete implementations selected by composition.

## Rationalization counters

These counters close the shortcuts observed in the skill's no-guidance RED controls and the strict-baseline loophole they would otherwise create.

| Rationalization or shortcut | Required response |
|---|---|
| “The deadline is in 20 minutes; keep validation, the Drizzle transaction, lookup, completion decision, update, and response in one route.” | Keep the route to transport validation/context/result mapping. Add the smallest named use case and inner port; time pressure reduces ceremony, not the dependency boundary. |
| “The smallest safe patch is a shared Drizzle guard; do not move `Container`, `RunBus`, or tracing behind use cases today.” | Characterize replay/cancel/trace behavior, then move the touched authorization and orchestration behind a named application seam. Do not pass `Container` “temporarily”; inject only the narrow bus, store, or cancellation capability the use case needs. |
| “A `Db | Tx` executor is pragmatic; the Drizzle transaction appears only in application orchestration and port signatures.” | “Only as a type” is still an outward source dependency. Define an application-owned unit-of-work callback over inner ports; create transaction-scoped Drizzle adapters inside its persistence implementation. |
| “The SDK result is already mapped, so a domain Zod schema can parse it in the use case.” | Parse unknown vendor data in the external adapter before mapping it to framework-free inner values. Domain/application contracts must not import Zod or vendor response types. |
| Folder-only compliance: “The folders look like Onion Architecture and tests pass.” | Inspect imports and ownership. A `domain/` file importing a wire schema or Drizzle row, or an application file receiving `Container`/constructing a repository, remains a material boundary violation. |
| New-violation re-baselining: “This is the same shape as legacy debt; re-baseline the new violation and clean it up later.” | Do not re-baseline new or expanded debt. Restore the boundary, or stop and report why the requested behavior cannot be implemented safely within scope. The baseline is inventory of pre-existing violations only. |

## Red flags — stop and correct the boundary

- A route or job entrypoint executes Drizzle queries, opens a transaction, or owns a business decision.
- A use case imports Fastify, Zod boundary schemas, Drizzle/table types, a concrete SDK, or `Container`.
- `Container` is passed “temporarily” into application or domain code.
- A Drizzle transaction/database type leaks inward “only as a type,” optional parameter, or `Db | Tx` union.
- A domain type aliases a database row, shared wire DTO, or vendor response.
- An external adapter maps a vendor response before validating its unknown boundary shape.
- `workspaceId` is checked in a route but omitted from the use-case input or persistence predicate.
- A persistence adapter returns a raw row, SQL fragment, driver error, or transaction handle inward.
- One feature imports another feature's private persistence, HTTP, external, or job adapter.
- A folder move is offered as compliance while source imports still point outward.
- Isolated or contract tests pass, but no test exercises the critical runtime composition path.
- A new violation is added to `.dependency-cruiser-known-violations.json` or the baseline is regenerated merely to make the gate green.

Any red flag in changed code blocks completion. Fix the touched boundary, retain unrelated legacy violations without copying them, and rerun focused behavior tests, typecheck, and `pnpm architecture`.
