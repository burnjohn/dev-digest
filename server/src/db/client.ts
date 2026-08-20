import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema } from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

/** The transaction handle `Db['transaction']` hands its callback. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * A database connection a repository HELPER may run on: the shared client or a
 * transaction handle. Only persistence-layer internals accept this union — it
 * lets a repository method compose single-statement helpers atomically inside
 * one `db.transaction`. Never put it on a port/service signature (see the
 * onion-architecture skill: transaction-leaking signatures are forbidden).
 */
export type DbConn = Db | Tx;

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
