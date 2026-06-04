import { timestamp } from 'drizzle-orm/pg-core';

/**
 * Shared internal column helpers for the schema domain files. NOT re-exported
 * by the `db/schema.ts` barrel — it stays out of the public schema surface.
 */

/** Standard `created_at` column: timestamptz, defaults to now(), not null. */
export const now = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
