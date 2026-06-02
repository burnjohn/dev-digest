import type { AuthProvider, AuthUser, AuthWorkspace } from '@devdigest/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { DEFAULT_WORKSPACE_NAME, SYSTEM_USER_EMAIL } from '../../db/seed.js';

/**
 * LocalNoAuthProvider (§5, §11) — MVP no-login mode. Always returns the single
 * seeded system user + default workspace. Resolves them from the DB (lazily
 * cached) so every request scopes to the same workspace_id.
 *
 * Swap for a real AuthProvider later; call sites only depend on the interface.
 */
export class LocalNoAuthProvider implements AuthProvider {
  private cachedUser?: AuthUser;
  private cachedWorkspace?: AuthWorkspace;

  constructor(private db: Db) {}

  async currentUser(): Promise<AuthUser> {
    if (this.cachedUser) return this.cachedUser;
    const [u] = await this.db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
    if (!u) throw new Error('No system user found — run `pnpm db:seed`.');
    this.cachedUser = { id: u.id, email: u.email, name: u.name };
    return this.cachedUser;
  }

  async currentWorkspace(): Promise<AuthWorkspace> {
    if (this.cachedWorkspace) return this.cachedWorkspace;
    const [w] = await this.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    if (!w) throw new Error('No default workspace found — run `pnpm db:seed`.');
    this.cachedWorkspace = { id: w.id, name: w.name };
    return this.cachedWorkspace;
  }
}
