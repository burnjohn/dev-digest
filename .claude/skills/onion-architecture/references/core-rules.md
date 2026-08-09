# Core Onion Architecture rules

| Layer | Owns | Imports allowed | Imports forbidden |
|---|---|---|---|
| Domain | policies, invariants, domain errors, stable vocabulary | own domain and platform-neutral language APIs | Fastify, Zod wire schemas, `@devdigest/shared`, Drizzle/Postgres, SDKs, `Container`, database rows |
| Application | use cases, application DTOs, inbound/outbound ports, transaction intent | domain and application-owned ports | Fastify, Zod boundary schemas, Drizzle types, concrete repositories, SDK clients, whole `Container` |
| Adapters | HTTP/SSE, persistence, SDK/tool, job/queue translation | application/domain contracts and the implemented technology | private implementation of another adapter; business policy that belongs inward |
| Composition | concrete construction and registration | all implementations required to build the process graph | request-specific orchestration and business decisions |

## Contents

- [Dependency contract](#dependency-contract)
- [Ports, injection, and mappings](#ports-injection-and-mappings)
- [Transactions and tenant ownership](#transactions-and-tenant-ownership)
- [DDD without ceremony](#ddd-without-ceremony)
- [Complete review example](#complete-review-example)

## Dependency contract

The source dependency chain is `adapters → application → domain`; composition constructs the graph around it. Every source import points inward. Runtime control may call outward—for example, an application use case can cause a persistence adapter to run—only through a port whose interface is owned by the inner consumer.

Folder names do not prove compliance. Classify code by what it owns and inspect its imports. Domain and application code must remain executable without Fastify, Zod boundary schemas, Drizzle/Postgres, concrete SDKs, or the process `Container`.

A deadline, a "one route file" request, a smallest-patch constraint, or pressure to "avoid abstractions" does not permit policy or transaction ownership in the route. The minimum touched-flow shape is a driving adapter calling a named use case with `workspaceId`; the use case calls a narrow inner port, and composition injects the outer implementation.

When asked for the exact code shape, show the complete chain: driving-adapter input mapping; use-case and inner-port signatures; outer-adapter implementation with database-row-to-inner mapping and required concurrency control; explicit inner-result/error-to-HTTP-or-SSE mapping; and concrete composition construction.

With source or schema context unavailable, give a short assumptions block followed by illustrative code for every item in that same order, including mapper bodies and transaction-scoped lock or guarded-write code. The use-case code owns the loaded-state decision; the outer adapter code only realizes the inner port and its concurrency mechanism.

## Ports, injection, and mappings

Define a port beside the inner consumer that needs the capability. Name its methods in use-case language and expose only the operations that consumer needs. Inject the narrowest capability; never pass the whole process `Container` into domain or application code and never locate dependencies from it at runtime.

Adapters translate both data and errors at the boundary:

- HTTP and SSE adapters parse transport input and map inner results and errors to wire output.
- Map canonical `@devdigest/shared` Zod wire DTOs to application/domain values; a shared wire contract is not a domain entity.
- External adapters validate unknown vendor responses before mapping them to framework-free inner values. SDK response and error types do not cross inward.
- Persistence adapters map database rows to inner values and translate infrastructure errors. Drizzle row, query-builder, SQL, transaction, and error types stay outside application and domain contracts.

## Transactions and tenant ownership

The application use case owns transaction intent. Represent atomic work with an application-owned transaction or unit-of-work port. Its persistence adapter may use `db.transaction`, but an inner signature must never expose a Drizzle database or transaction handle.

When a transition depends on loaded state, make that decision concurrency-safe in the outer persistence implementation. Either lock the scoped row while the unit-of-work transaction is open so a waiter observes the committed state, or use an expected-state guarded write and translate a miss to a typed conflict; an unlocked read followed by an unconditional write is unsafe at Read Committed.

Carry `workspaceId` through every tenant-owned use-case input and port method. Do not discard tenant ownership after the route checks it. Persistence predicates must scope reads and writes to that workspace, including flows driven by jobs, polling, cancellation, or streams.

## DDD without ceremony

Use entities, value objects, aggregates, or domain services only when they express actual behavior or invariants. A small CRUD use case may use explicit immutable values plus narrow ports. Do not invent fake entities, one repository per table, or a generic `Repository<T>` merely to make the directory tree look architectural.

Port names must follow the feature's real language. The example below uses `ReviewStore` for a compact teaching case; production code should choose the capability name and operations that the actual feature vocabulary demands rather than copying it blindly.

## Complete review example

These are the complete inner contracts. They contain tenant scope and atomicity intent but no Fastify, shared wire DTO, `Container`, Drizzle, or database-row types.

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

The use-case factory receives only the application-owned unit of work. It loads within the tenant boundary, enforces the transition, saves an immutable inner value, and returns that value.

```ts
export class ReviewNotFoundError extends Error {}
export class ReviewAlreadyCompletedError extends Error {}

export function createCompleteReview(
  reviewUnitOfWork: ReviewUnitOfWork,
): CompleteReview {
  return (input) =>
    reviewUnitOfWork.execute(async ({ reviews }) => {
      const review = await reviews.findForWorkspace({
        workspaceId: input.workspaceId,
        reviewId: input.reviewId,
      });

      if (!review) {
        throw new ReviewNotFoundError();
      }
      if (review.status !== 'running') {
        throw new ReviewAlreadyCompletedError();
      }

      const completed: Review = { ...review, status: 'completed' };
      await reviews.save(completed);
      return completed;
    });
}
```

The persistence adapter owns Drizzle construction and converts its transaction handle into inner ports. Only the adapter knows `AppDatabase`, the transaction type, rows, and `DrizzleReviewStore`.

```ts
export class DrizzleReviewUnitOfWork implements ReviewUnitOfWork {
  constructor(private readonly db: AppDatabase) {}

  execute<T>(
    work: (ports: { reviews: ReviewStore }) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction((tx) =>
      work({ reviews: new DrizzleReviewStore(tx) }),
    );
  }
}
```

The driving HTTP adapter is thin: boundary schemas validate before this handler, and the handler maps authenticated context plus transport parameters to one use-case call. It then explicitly maps the inner `Review` to the wire DTO rather than returning the use-case result directly.

```ts
interface CompleteReviewResponse {
  id: string;
  status: 'running' | 'completed';
}

function toReviewResponse(review: Review): CompleteReviewResponse {
  return { id: review.id, status: review.status };
}

export function makeCompleteReviewHandler(completeReview: CompleteReview) {
  return async function completeReviewHandler(request: CompleteReviewRequest) {
    const review = await completeReview({
      workspaceId: request.auth.workspaceId,
      reviewId: request.params.reviewId,
    });

    return toReviewResponse(review);
  };
}
```

The composition root constructs the driven adapter and use case, then injects the use case into the driving adapter. It chooses implementations but makes no completion decision itself.

```ts
export async function buildApp() {
  const app = createFastifyApp();
  const db = createDatabase();
  const reviewUnitOfWork = new DrizzleReviewUnitOfWork(db);
  const completeReview = createCompleteReview(reviewUnitOfWork);

  await app.register(reviewRoutes, { completeReview });
  return app;
}
```
