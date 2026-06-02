import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder } from '../src/adapters/mocks.js';
import { MemoryService } from '../src/modules/memory/service.js';
import { Container } from '../src/platform/container.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Deterministic embedder where content controls the vector → similarity test. */
class KeyedEmbedder extends MockEmbedder {
  override async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array(1536).fill(0);
      // hash a few words into stable slots so similar text → similar vector
      for (const w of text.toLowerCase().split(/\W+/).filter(Boolean)) {
        let h = 0;
        for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 1536;
        v[h] = 1;
      }
      return v;
    });
  }
}

d('A1 memory: store + cosine retrieval round-trip (Testcontainers pgvector)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('POST /memory embeds + stores, GET /memory lists with filters', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new KeyedEmbedder() },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/memory',
      payload: {
        content: 'We reuse a single Redis connection pool across requests.',
        scope: 'global',
        kind: 'decision',
        confidence: 0.9,
      },
    });
    expect(created.statusCode).toBe(201);
    const item = created.json();
    expect(item.kind).toBe('decision');

    const list = (await app.inject({ method: 'GET', url: '/memory?kind=decision' })).json();
    expect(list.some((m: { id: string }) => m.id === item.id)).toBe(true);

    // filter by a non-matching kind → excluded
    const pref = (await app.inject({ method: 'GET', url: '/memory?kind=preference' })).json();
    expect(pref.some((m: { id: string }) => m.id === item.id)).toBe(false);
    await app.close();
  });

  it('retrieveMemory returns the most cosine-similar item first', async () => {
    const container = new Container(config(), pg.handle.db, { embedder: new KeyedEmbedder() });
    const ws = (await pg.handle.db.select().from((await import('../src/db/schema.js')).workspaces))[0]!;
    const service = new MemoryService(container);

    await service.create(ws.id, {
      content: 'Redis connection reuse avoids socket exhaustion under load.',
      scope: 'global',
      kind: 'fact',
    });
    await service.create(ws.id, {
      content: 'Frontend uses Tailwind v4 design tokens for theming.',
      scope: 'global',
      kind: 'preference',
    });

    const hits = await service.retrieveMemory(ws.id, 'redis connection reuse', { topK: 1 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.content.toLowerCase()).toContain('redis');
    expect(hits[0]!.similarity).toBeGreaterThan(0);
  });

  it('learnFromFinding creates a kind=learning row with source PR provenance', async () => {
    const container = new Container(config(), pg.handle.db, { embedder: new KeyedEmbedder() });
    const ws = (await pg.handle.db.select().from((await import('../src/db/schema.js')).workspaces))[0]!;
    const service = new MemoryService(container);

    const mem = await service.learnFromFinding(ws.id, {
      content: 'Always include a Retry-After header on 429 responses.',
      prNumber: 482,
      context: 'Learned from finding on PR #482',
    });
    expect(mem.kind).toBe('learning');
    expect(mem.sources[0]!.pr).toBe(482);
  });

  it('PATCH re-embeds on content change, DELETE removes', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new KeyedEmbedder() },
    });
    const item = (
      await app.inject({
        method: 'POST',
        url: '/memory',
        payload: { content: 'initial', scope: 'repo', kind: 'fact' },
      })
    ).json();

    const patched = (
      await app.inject({ method: 'PATCH', url: `/memory/${item.id}`, payload: { content: 'updated content' } })
    ).json();
    expect(patched.content).toBe('updated content');

    const del = await app.inject({ method: 'DELETE', url: `/memory/${item.id}` });
    expect(del.statusCode).toBe(200);
    await app.close();
  });
});
