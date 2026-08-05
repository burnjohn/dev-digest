import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn(
    '[github-tokens-schema] Docker not available — skipping Testcontainers integration tests.',
  );
}

d('github_tokens schema', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('deleting a token nulls repos.github_token_id instead of cascading', async () => {
    const { db } = pg.handle;
    const { workspaceId, userId } = await seed(db);

    const [token] = await db
      .insert(t.githubTokens)
      .values({ workspaceId, label: 'work', githubLogin: 'octocat' })
      .returning();

    const [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'api',
        fullName: 'acme/api',
        createdBy: userId,
        githubTokenId: token!.id,
      })
      .returning();

    await db.delete(t.githubTokens).where(eq(t.githubTokens.id, token!.id));

    // The repo survives; it is merely left without a usable token.
    const [after] = await db.select().from(t.repos).where(eq(t.repos.id, repo!.id));
    expect(after).toBeDefined();
    expect(after!.githubTokenId).toBeNull();
  });

  it('label is unique per workspace', async () => {
    const { db } = pg.handle;
    const { workspaceId } = await seed(db);
    await db.insert(t.githubTokens).values({ workspaceId, label: 'dupe' });
    await expect(
      db.insert(t.githubTokens).values({ workspaceId, label: 'dupe' }),
    ).rejects.toThrow();

    // The constraint is composite, not global: a second workspace may reuse the
    // label. Without this half, a plain UNIQUE(label) would pass the test above.
    // seed() is idempotent (it looks the workspace up by name), so it cannot
    // hand back a second one — insert the workspace row directly.
    const [other] = await db.insert(t.workspaces).values({ name: 'other-ws' }).returning();
    await expect(
      db.insert(t.githubTokens).values({ workspaceId: other!.id, label: 'dupe' }),
    ).resolves.toBeDefined();
  });
});
