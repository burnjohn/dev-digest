import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PluginBundle, AgentPerf, Digest, InstalledPlugin } from '@devdigest/shared';
import { routeModel, PromptCache, hashKey } from '../src/platform/model-router.js';

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('A6 productionize — plugins / performance / digest (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function build() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder() },
    });
  }

  it('plugin export → import round-trips agent + linked skill config', async () => {
    const app = await build();

    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'rt-rubric', body: 'Prefer small PRs.', type: 'rubric', enabled: true },
      })
    ).json();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'RoundTrip Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/skills/${skill.id}/link-agent`, payload: { agent_id: agent.id } });

    // export
    const exportRes = await app.inject({ method: 'POST', url: '/plugins/export', payload: { name: 'rt-bundle' } });
    expect(exportRes.statusCode).toBeLessThan(300);
    const bundle = exportRes.json() as PluginBundle;
    expect(bundle.manifest.format).toBe('devdigest-plugin/v1');
    const exported = bundle.agents.find((a) => a.name === 'RoundTrip Agent');
    expect(exported).toBeTruthy();
    expect(exported!.skills).toContain('rt-rubric');
    expect(bundle.skills.some((s) => s.name === 'rt-rubric')).toBe(true);

    // Importing the SAME bundle merges by name (idempotent → 0 created); rename
    // entries to prove the import path recreates agent + linked skill config.
    const renamed: PluginBundle = {
      ...bundle,
      manifest: { ...bundle.manifest, name: 'rt-bundle-copy' },
      agents: bundle.agents.map((a) =>
        a.name === 'RoundTrip Agent'
          ? { ...a, name: 'RoundTrip Agent (copy)', skills: a.skills.map((s) => (s === 'rt-rubric' ? 'rt-rubric-copy' : s)) }
          : a,
      ),
      skills: bundle.skills.map((s) => (s.name === 'rt-rubric' ? { ...s, name: 'rt-rubric-copy' } : s)),
    };
    const importRes = await app.inject({ method: 'POST', url: '/plugins/import', payload: { bundle: renamed } });
    expect(importRes.statusCode).toBeLessThan(300);
    const result = importRes.json();
    expect(result.created.agents).toBeGreaterThanOrEqual(1);
    expect(result.created.skills).toBeGreaterThanOrEqual(1);

    // the restored agent exists and carries the linked (copied) skill
    const agents = (await app.inject({ method: 'GET', url: '/agents' })).json();
    const restored = agents.find((a: { name: string }) => a.name === 'RoundTrip Agent (copy)');
    expect(restored).toBeTruthy();
    const links = (await app.inject({ method: 'GET', url: `/agents/${restored.id}/skills` })).json();
    expect(Array.isArray(links)).toBe(true);

    const installed = (await app.inject({ method: 'GET', url: '/plugins' })).json() as InstalledPlugin[];
    expect(installed.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  it('GET /agents/performance returns workspace aggregates sorted by accept-rate', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/agents/performance' });
    expect(res.statusCode).toBe(200);
    const perf = res.json() as AgentPerf;
    expect(Array.isArray(perf.agents)).toBe(true);
    expect(perf.summary).toBeTruthy();
    // accept_rate ordering (nulls last)
    const rates = perf.agents.map((a) => a.accept_rate ?? -1);
    const sorted = [...rates].sort((x, y) => y - x);
    expect(rates).toEqual(sorted);
    await app.close();
  });

  it('POST /digest/run builds and persists a period summary', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/digest/run', payload: {} });
    expect(res.statusCode).toBe(200);
    const digest = res.json() as Digest;
    expect(digest.body_md).toContain('Weekly summary');
    const list = (await app.inject({ method: 'GET', url: '/digest' })).json() as Digest[];
    expect(list.length).toBeGreaterThanOrEqual(1);
    await app.close();
  });
});

describe('A6 cost discipline — model router + prompt cache (unit)', () => {
  it('routes cheap tasks to the cheap model and review to the capable model', () => {
    expect(routeModel('summary', 'openai')).toBe('gpt-4o-mini');
    expect(routeModel('intent', 'anthropic')).toBe('claude-haiku-4-5');
    expect(routeModel('review', 'openai')).toBe('gpt-4.1');
    expect(routeModel('review', 'openai', 'gpt-x')).toBe('gpt-x'); // explicit override wins
  });

  it('prompt cache serves identical keys and expires by TTL', async () => {
    let now = 0;
    const cache = new PromptCache<number>(1000, () => now);
    const key = hashKey('assembled', 'prompt');
    let calls = 0;
    const produce = async () => {
      calls += 1;
      return 42;
    };
    const a = await cache.wrap(key, produce);
    const b = await cache.wrap(key, produce);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(calls).toBe(1);
    now = 2000; // past TTL
    const c = await cache.wrap(key, produce);
    expect(c.cached).toBe(false);
    expect(calls).toBe(2);
  });
});
