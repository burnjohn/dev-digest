import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

/**
 * Apply all migrations to the given database URL. Ensures the `vector`
 * extension exists first (pgvector), since several tables declare
 * `vector(1536)` columns. Safe to call repeatedly (idempotent).
 *
 * Reused by both `pnpm db:migrate` and the Testcontainers harness.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    // pgvector must exist before tables with vector columns are created.
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    if (!existsSync(MIGRATIONS_DIR)) {
      throw new Error(
        `No migrations found at ${MIGRATIONS_DIR}. Run \`pnpm db:generate\` first.`,
      );
    }
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log('✓ migrations applied');
      process.exit(0);
    })
    .catch((err) => {
      console.error('✗ migration failed:', err);
      process.exit(1);
    });
}
