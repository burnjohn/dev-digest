import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema } from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * The handle Drizzle hands to a `.transaction()` callback.
 *
 * Derived from `Db` rather than imported, so it can never drift from the schema
 * generic. Widen a repository method's first/last parameter to `Db | Transaction`
 * when it has to be callable both standalone and inside a unit of work — `tx`
 * must never escape the callback or appear in a SERVICE signature.
 */
export type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  db: Db;
  sql: postgres.Sql;
  close: () => Promise<void>;
}

/**
 * Create a Drizzle client over postgres-js. Used by the app (one shared handle)
 * and by the Testcontainers harness (per-test handle).
 */
export function createDb(databaseUrl: string, opts?: { max?: number }): DbHandle {
  const sql = postgres(databaseUrl, { max: opts?.max ?? 10 });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
