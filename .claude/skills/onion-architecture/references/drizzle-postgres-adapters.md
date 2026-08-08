# Drizzle and PostgreSQL adapters

A persistence adapter implements an inner port. It translates between PostgreSQL/Drizzle representations and the application or domain values defined in [core-rules.md](core-rules.md); it does not redefine `ReviewStore`, `ReviewUnitOfWork`, or their transaction semantics.

## Persistence ownership

The persistence adapter is the only owner of:

- Drizzle schema and table imports, relations, query builders, SQL fragments, inferred select/insert row types, database clients, and transaction handles;
- PostgreSQL error codes, isolation behavior, constraints, and optional row-security policy;
- row-to-inner and inner-to-row mapping, including validation of persisted JSON and corruption detection;
- the `db.transaction` implementation of an application-owned transaction or unit-of-work port;
- workspace predicates for every tenant-owned read, write, count, update, and delete operation.

Domain and application code must not import a table merely to reuse `typeof reviews.$inferSelect`, accept a Drizzle database/transaction union, inspect PostgreSQL error codes, or return a raw row. A port returns its own inner `Review`, not `typeof reviews.$inferSelect`.

## Row mapping and tenant scope

Keep inferred row types private to the adapter and map every row before it travels inward. Detect impossible values or malformed persisted JSON at this boundary. Do not coerce corrupt storage into a plausible domain value.

```ts
import { and, eq } from 'drizzle-orm';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { Db } from '../../../../db/client.js';
import type { Review, ReviewStore } from '../../application/complete-review.js';

// Illustrative adapter-owned schema for the core-rules teaching example.
// This is not DevDigest's production `reviews` table.
const reviewRecords = pgTable('review_records_example', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  status: text('status', { enum: ['running', 'completed'] }).notNull(),
});

type ReviewRow = typeof reviewRecords.$inferSelect;
type ReviewTransaction = Parameters<
  Parameters<Db['transaction']>[0]
>[0];

class PersistenceCorruptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PersistenceCorruptionError';
  }
}

function toReview(row: ReviewRow): Review {
  if (row.status !== 'running' && row.status !== 'completed') {
    throw new PersistenceCorruptionError(
      `review ${row.id} has invalid persisted status`,
    );
  }

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    status: row.status,
  };
}

function toReviewUpdate(review: Review) {
  return { status: review.status };
}

class DrizzleReviewStore implements ReviewStore {
  constructor(private readonly db: ReviewTransaction) {}

  async findForWorkspace(input: {
    workspaceId: string;
    reviewId: string;
  }): Promise<Review | null> {
    const [row] = await this.db
      .select()
      .from(reviewRecords)
      .where(
        and(
          eq(reviewRecords.workspaceId, input.workspaceId),
          eq(reviewRecords.id, input.reviewId),
        ),
      )
      .for('update');

    return row ? toReview(row) : null;
  }

  async save(review: Review): Promise<void> {
    const [updated] = await this.db
      .update(reviewRecords)
      .set(toReviewUpdate(review))
      .where(
        and(
          eq(reviewRecords.workspaceId, review.workspaceId),
          eq(reviewRecords.id, review.id),
        ),
      )
      .returning({ id: reviewRecords.id });

    if (!updated) {
      throw new Error('scoped review update matched no row');
    }
  }
}
```

The `reviewRecords` declaration is self-contained illustrative schema for the teaching `Review` from `core-rules.md`; it is not the production table in `server/src/db/schema/reviews.ts`, which has no `status` column. In production, import the actual feature table and adapt the private mapper to fields that table really defines. The important shape is invariant: the adapter-private `ReviewRow` is checked and converted to an inner `Review`, and both lookup and update include `workspaceId`. `DrizzleReviewStore` accepts only the transaction handle created by `ReviewUnitOfWork`; its `FOR UPDATE` lookup keeps the loaded-state decision and save in one lock scope, so a second Read Committed transaction waits and then observes `completed`. Apply the same predicate rule to lists, joins, aggregates, counts, bulk operations, soft deletes, and hard deletes. A route-level ownership check does not make an unscoped query safe, and a prior scoped lookup does not excuse a later unscoped write.

If a mapper detects corruption, stop before returning inward. Translate the failure to a stable application-facing failure at the adapter boundary where the flow requires one, retain the original cause for logs, and never expose row contents, SQL, or a PostgreSQL error to HTTP/SSE output.

## Application-owned unit of work

The application contract states the atomicity intent:

```ts
ReviewUnitOfWork.execute<T>(
  work: (ports: { reviews: ReviewStore }) => Promise<T>,
): Promise<T>
```

Its Drizzle implementation creates transaction-scoped adapters internally. Only application-owned ports cross the callback boundary:

```ts
import type {
  ReviewStore,
  ReviewUnitOfWork,
} from '../../application/complete-review.js';
import type { Db } from '../../../../db/client.js';

export class DrizzleReviewUnitOfWork implements ReviewUnitOfWork {
  constructor(private readonly db: Db) {}

  execute<T>(
    work: (ports: { reviews: ReviewStore }) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const transactionReviews = new DrizzleReviewStore(tx);
      return work({ reviews: transactionReviews });
    });
  }
}
```

The application use case chooses what must be atomic; the adapter chooses how Drizzle/PostgreSQL realizes that intent, including an isolation level when the use case's consistency requirement needs one. A thrown callback error causes the adapter transaction to roll back; a returned value commits.

Reject transaction-leaking signatures such as:

```ts
save(review: Review, tx: NodePgTransaction): Promise<void>;
service.run(dbOrTx): Promise<Result>;
execute(input: Input, db: Db | Transaction): Promise<Output>;
```

Those signatures make inner code coordinate an outer technology and allow operations to escape the intended transaction. Do not put an optional transaction parameter on a port, and do not let an application service select between a database and transaction handle.

## PostgreSQL errors, constraints, and row security

Inspect PostgreSQL codes only in the persistence adapter. Translate expected unique, foreign-key, check, serialization, or deadlock failures into stable failures meaningful to the inner consumer; wrap/log unexpected failures without leaking SQL, constraint names, or driver objects inward. Retry only when the use case's semantics make retry safe.

Use `NOT NULL`, unique, foreign-key, and check constraints to defend stored integrity and use the isolation level required by the operation. Optional PostgreSQL row-level security can add tenant defense-in-depth. Constraints and RLS do not replace business policy, application authorization, explicit `workspaceId` port inputs, or scoped query predicates.

## Schema changes and migrations

Change the Drizzle schema source, then use the repository scripts from `server/`:

```sh
cd server
pnpm db:generate
pnpm db:migrate
```

Review the generated migration and test it against the intended database. Never hand-edit `server/src/db/migrations/**`, never assume migrations run during application boot, and do not replace the reviewed generate/apply workflow with `db:push`.

## PostgreSQL integration verification

Persistence adapters require DB-backed `*.it.test.ts` coverage through the existing Testcontainers fixture. Destructure the two real handles exactly as provided:

```ts
const db = pg.handle.db;
const sql = pg.handle.sql;
```

Use `db` for typed Drizzle setup and assertions and `sql` when the test must inspect PostgreSQL behavior directly. Cover:

- valid row-to-inner and inner-to-row mapping, plus malformed persisted JSON or otherwise corrupt rows when the schema can contain them;
- a missing record returning the port's defined absence value rather than a fabricated row;
- unique, foreign-key, and check constraints relevant to the adapter, including the adapter's error translation;
- unit-of-work commit on success and rollback when any callback step throws;
- concurrent attempts to perform the same loaded-state transition: exactly one succeeds and the waiter observes the committed state or a typed expected-state conflict;
- two-workspace isolation for every relevant read/write/count/delete shape: create matching-looking resources in workspaces A and B, operate as A, and prove B is neither observed nor mutated.

Do not mock Drizzle query builders or a transaction object for these claims. Unit tests can cover a pure mapper, but SQL predicates, constraints, isolation, commit/rollback, and driver error translation need PostgreSQL.

### Correlated-subquery qualification

When an inner and outer table share a column name, especially `id`, do not rely on interpolating the outer Drizzle column into a correlated SQL fragment. In this repository, interpolation can render a bare quoted column, which PostgreSQL binds to the inner scope and silently produces the wrong result.

Qualify the outer column explicitly with the actual outer table name or alias:

```ts
repoCount: sql<number>`(
  SELECT count(*)::int FROM ${repos}
  WHERE ${repos.githubTokenId} = github_tokens.id
)`
```

Keep a real PostgreSQL regression test whose data makes the correct correlated count distinguishable from the incorrectly inner-bound count. Inspecting types or seeing valid SQL syntax is not enough; the faulty query executes successfully and returns the wrong number.
