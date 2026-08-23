/**
 * `pr_intent`'s four additive columns (confidence, sources, model, generated_at
 * — migration 0017_careless_serpent_society.sql) round-tripping through the
 * repository (plan 03-intent-layer.md T2): `upsertIntent` / `getIntent` in
 * `server/src/modules/reviews/repository/pull.repo.ts`. Gated on Docker (needs
 * Postgres); no GitHub token or LLM call is ever made here — pure DB round trip.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { upsertIntent, getIntent } from '../src/modules/reviews/repository/pull.repo.js';
import type { ClassifiedIntent } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `intent-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: repoSeq,
      title: `PR #${repoSeq}`,
      author: 'octocat',
      branch: `feat/${repoSeq}`,
      base: 'main',
      headSha: `sha${repoSeq}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return pr!;
}

d('pr_intent repository round trip (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('write then read back: every field round-trips exactly', async () => {
    const db = pg.handle.db;
    const pr = await setupRepoAndPr(db, workspaceId);

    const intent: ClassifiedIntent = {
      intent: 'Adds rate limiting to public API endpoints.',
      in_scope: ['src/middleware/ratelimit.ts'],
      out_of_scope: ['authentication flow'],
      confidence: 'medium',
      sources: [{ kind: 'pr_body', ref: 'body', status: 'used', chars: 120 }],
    };
    const generatedAt = new Date('2026-08-20T12:00:00.000Z');
    await upsertIntent(db, pr.id, intent, { model: 'deepseek/deepseek-v4-flash', generatedAt });

    const stored = await getIntent(db, pr.id);
    expect(stored).toBeDefined();
    expect(stored!.intent).toBe(intent.intent);
    expect(stored!.in_scope).toEqual(intent.in_scope);
    expect(stored!.out_of_scope).toEqual(intent.out_of_scope);
    expect(stored!.confidence).toBe('medium');
    expect(stored!.sources).toEqual(intent.sources);
    expect(stored!.model).toBe('deepseek/deepseek-v4-flash');
    expect(stored!.generatedAt).toBeInstanceOf(Date);
    expect(stored!.generatedAt.toISOString()).toBe('2026-08-20T12:00:00.000Z');
  });

  it('a null model (REQ-7 fallback / pre-feature row) persists and reads back as null, not a placeholder string', async () => {
    const db = pg.handle.db;
    const pr = await setupRepoAndPr(db, workspaceId);

    const intent: ClassifiedIntent = {
      intent: 'Fallback intent from title + file names.',
      in_scope: [],
      out_of_scope: [],
      confidence: 'low',
      sources: [],
    };
    await upsertIntent(db, pr.id, intent, { model: null, generatedAt: new Date() });

    const stored = await getIntent(db, pr.id);
    expect(stored).toBeDefined();
    expect(stored!.model).toBeNull();
  });

  it('getIntent on a PR with no intent row returns undefined (the absent case)', async () => {
    const db = pg.handle.db;
    const pr = await setupRepoAndPr(db, workspaceId);

    const stored = await getIntent(db, pr.id);
    expect(stored).toBeUndefined();
  });

  it('re-classification upserts the SAME row: one row per PR, never history, and the second write wins', async () => {
    const db = pg.handle.db;
    const pr = await setupRepoAndPr(db, workspaceId);

    const v1: ClassifiedIntent = {
      intent: 'First classification.',
      in_scope: ['a'],
      out_of_scope: [],
      confidence: 'low',
      sources: [],
    };
    const v2: ClassifiedIntent = {
      intent: 'Second, forced re-classification.',
      in_scope: ['b'],
      out_of_scope: ['c'],
      confidence: 'high',
      sources: [],
    };
    await upsertIntent(db, pr.id, v1, { model: 'm1', generatedAt: new Date() });
    await upsertIntent(db, pr.id, v2, { model: 'm2', generatedAt: new Date() });

    const rows = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.intent).toBe(v2.intent);
    expect(rows[0]!.model).toBe('m2');

    const stored = await getIntent(db, pr.id);
    expect(stored!.confidence).toBe('high');
  });

  it('upsertIntent defaults generatedAt to "now" when the caller omits it', async () => {
    const db = pg.handle.db;
    const pr = await setupRepoAndPr(db, workspaceId);
    const before = Date.now();

    const intent: ClassifiedIntent = {
      intent: 'No explicit generatedAt supplied.',
      in_scope: [],
      out_of_scope: [],
      confidence: 'low',
      sources: [],
    };
    await upsertIntent(db, pr.id, intent, { model: null });

    const stored = await getIntent(db, pr.id);
    const ts = stored!.generatedAt.getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 2000);
    expect(ts).toBeLessThanOrEqual(Date.now() + 2000);
  });
});
