import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { inArray } from 'drizzle-orm';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { hermeticOverrides } from './helpers/overrides.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { ContextAttachResponse, ContextDocumentList } from '@devdigest/shared';

/**
 * T7 (SPEC-01 project context) — the `context` module's HTTP surface plus
 * `container.contextDocs` (the port `run-executor`/T12 will consume).
 * Repository-heavy behaviour lives here (real Postgres): the replace-set
 * write, REQ-18's DB-backed traversal, REQ-7's usage counts. Filesystem-only
 * behaviour (preview/upload path safety, `computeUsageCounts`) is covered
 * hermetically in `context-service.test.ts`.
 */
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context-api] Docker not available — skipping integration tests.');
}

type Db = PgFixture['handle']['db'];

let repoSeq = 0;

d('context module — routes + container.contextDocs (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let cloneRoot: string;
  let uploadRoot: string;
  let app: FastifyInstance;
  const createdAgentIds: string[] = [];
  const createdSkillIds: string[] = [];

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  afterEach(async () => {
    await app?.close();
    // `freshRepo()`/per-test repo seeding does NOT isolate workspace-scoped
    // rows — agents/skills leak across tests in one file (server/INSIGHTS.md,
    // 2026-08-17). Delete what this file wrote.
    if (createdAgentIds.length > 0) {
      await pg.handle.db.delete(t.agents).where(inArray(t.agents.id, createdAgentIds));
      createdAgentIds.length = 0;
    }
    if (createdSkillIds.length > 0) {
      await pg.handle.db.delete(t.skills).where(inArray(t.skills.id, createdSkillIds));
      createdSkillIds.length = 0;
    }
    if (cloneRoot) await rm(cloneRoot, { recursive: true, force: true });
    if (uploadRoot) await rm(uploadRoot, { recursive: true, force: true });
  });

  async function makeApp(): Promise<FastifyInstance> {
    cloneRoot = await mkdtemp(join(tmpdir(), 'context-it-clone-'));
    uploadRoot = await mkdtemp(join(tmpdir(), 'context-it-upload-'));
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DEVDIGEST_CLONE_DIR: cloneRoot,
      DEVDIGEST_CONTEXT_UPLOAD_DIR: uploadRoot,
    } as NodeJS.ProcessEnv);
    app = await buildApp({ config, db: pg.handle.db, overrides: hermeticOverrides() });
    return app;
  }

  async function setupRepo() {
    const name = `context-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    return repo!;
  }

  function cloneDirFor(repo: { owner: string; name: string }): string {
    return join(cloneRoot, repo.owner, repo.name);
  }

  async function writeDoc(repo: { owner: string; name: string }, relPath: string, content: string) {
    const full = join(cloneDirFor(repo), relPath);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  async function createAgent(overrides: { enabled?: boolean } = {}): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `Agent ${createdAgentIds.length}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
        ...(overrides.enabled !== undefined ? { enabled: overrides.enabled } : {}),
      },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    createdAgentIds.push(id);
    return id;
  }

  async function createSkill(overrides: { enabled?: boolean } = {}): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: `Skill ${createdSkillIds.length}`,
        type: 'convention',
        source: 'manual',
        body: 'Follow the convention.',
        enabled: overrides.enabled ?? true,
      },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    createdSkillIds.push(id);
    return id;
  }

  async function linkSkill(agentId: string, skillIds: string[]) {
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: skillIds },
    });
    expect(res.statusCode).toBe(200);
  }

  it('REQ-5/REQ-3 — lists a discovered document and previews it unchanged', async () => {
    await makeApp();
    const repo = await setupRepo();
    await writeDoc(repo, 'specs/a.md', 'Hello, project.');

    const listRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json() as ContextDocumentList;
    expect(list.total).toBe(1);
    expect(list.documents[0]).toMatchObject({
      path: 'specs/a.md',
      type: 'specs',
      source: 'repo',
      oversized: false,
      used_by_agents: 0,
      used_by_disabled_skill_only: 0,
    });

    const previewRes = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/preview?path=specs/a.md`,
    });
    expect(previewRes.statusCode).toBe(200);
    expect(previewRes.json()).toMatchObject({ path: 'specs/a.md', content: 'Hello, project.' });
  });

  it('REQ-4/REQ-31 — an upload lands under the upload dir, is listed with source "upload", and rejects a bad request', async () => {
    await makeApp();
    const repo = await setupRepo();

    const uploadRes = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/context/upload`,
      payload: { filename: '../../evil/notes.md', content: '# uploaded' },
    });
    expect(uploadRes.statusCode).toBe(201);
    const doc = uploadRes.json();
    expect(doc.path).toBe('notes.md'); // path.basename of the submitted name
    expect(doc.source).toBe('upload');

    const listRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    const list = listRes.json() as ContextDocumentList;
    expect(list.documents.some((d) => d.path === 'notes.md' && d.source === 'upload')).toBe(true);

    const badExt = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/context/upload`,
      payload: { filename: 'notes.txt', content: 'x' },
    });
    expect(badExt.statusCode).toBe(422);

    const tooBig = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/context/upload`,
      payload: { filename: 'big.md', content: 'x'.repeat(400 * 1024 + 1) },
    });
    expect(tooBig.statusCode).toBe(422);
  });

  it('REQ-30 — a preview request whose path escapes both directories is refused, not opened', async () => {
    await makeApp();
    const repo = await setupRepo();

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/preview?${new URLSearchParams({ path: '../../../etc/passwd' })}`,
    });
    expect(res.statusCode).toBe(422);
  });

  it('REQ-10/REQ-11/REQ-12/REQ-13 — the replace-set write persists path/position/repo_id and no text; a permuted second write returns the permutation', async () => {
    await makeApp();
    const repo = await setupRepo();
    await writeDoc(repo, 'specs/a.md', 'A');
    await writeDoc(repo, 'specs/b.md', 'B');
    const agentId = await createAgent();

    const first = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context`,
      payload: { repo_id: repo.id, paths: ['specs/a.md', 'specs/b.md'] },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ repo_id: repo.id, paths: ['specs/a.md', 'specs/b.md'] });

    const read1 = await app.inject({ method: 'GET', url: `/agents/${agentId}/context?repo_id=${repo.id}` });
    expect((read1.json() as ContextAttachResponse).paths).toEqual(['specs/a.md', 'specs/b.md']);

    const second = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context`,
      payload: { repo_id: repo.id, paths: ['specs/b.md', 'specs/a.md'] },
    });
    expect(second.statusCode).toBe(200);

    const read2 = await app.inject({ method: 'GET', url: `/agents/${agentId}/context?repo_id=${repo.id}` });
    expect((read2.json() as ContextAttachResponse).paths).toEqual(['specs/b.md', 'specs/a.md']);

    // No document text anywhere in `context_attachments`.
    const rows = await pg.handle.db.select().from(t.contextAttachments);
    for (const row of rows) {
      expect(row).not.toHaveProperty('content');
      expect(row).not.toHaveProperty('body');
    }
  });

  it('REQ-8 — an attach request naming a path over 400 KB returns 422 and names the path', async () => {
    await makeApp();
    const repo = await setupRepo();
    await writeDoc(repo, 'specs/big.md', 'x'.repeat(400 * 1024 + 1));
    const agentId = await createAgent();

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context`,
      payload: { repo_id: repo.id, paths: ['specs/big.md'] },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).toContain('specs/big.md');
  });

  it('REQ-18 — container.contextDocs.resolveEffectiveAttachments: agent own attachments, then the ENABLED skill in agent_skills.order, deduped, disabled skill excluded', async () => {
    await makeApp();
    const repo = await setupRepo();
    await writeDoc(repo, 'specs/own.md', 'own');
    await writeDoc(repo, 'specs/shared.md', 'shared');
    await writeDoc(repo, 'specs/enabled-only.md', 'enabled-only');
    await writeDoc(repo, 'specs/disabled-only.md', 'disabled-only');

    const agentId = await createAgent();
    const enabledSkillId = await createSkill({ enabled: true });
    const disabledSkillId = await createSkill({ enabled: false });

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/context`,
      payload: { repo_id: repo.id, paths: ['specs/own.md', 'specs/shared.md'] },
    });
    await app.inject({
      method: 'POST',
      url: `/skills/${enabledSkillId}/context`,
      payload: { repo_id: repo.id, paths: ['specs/shared.md', 'specs/enabled-only.md'] },
    });
    await app.inject({
      method: 'POST',
      url: `/skills/${disabledSkillId}/context`,
      payload: { repo_id: repo.id, paths: ['specs/disabled-only.md'] },
    });
    // agent_skills.order — enabled skill linked first.
    await linkSkill(agentId, [enabledSkillId, disabledSkillId]);

    const effective = await app.container.contextDocs.resolveEffectiveAttachments(agentId, repo.id);
    expect(effective).toEqual(['specs/own.md', 'specs/shared.md', 'specs/enabled-only.md']);
    expect(effective).not.toContain('specs/disabled-only.md');
  });

  it('REQ-7 — the "Used by N agents" chip counts an agent once regardless of enabled state, and reports the disabled-skill-only subset separately', async () => {
    await makeApp();
    const repo = await setupRepo();
    await writeDoc(repo, 'specs/shared.md', 'shared');

    const directAgentId = await createAgent();
    const viaDisabledSkillAgentId = await createAgent();
    const disabledSkillId = await createSkill({ enabled: false });

    await app.inject({
      method: 'POST',
      url: `/agents/${directAgentId}/context`,
      payload: { repo_id: repo.id, paths: ['specs/shared.md'] },
    });
    await app.inject({
      method: 'POST',
      url: `/skills/${disabledSkillId}/context`,
      payload: { repo_id: repo.id, paths: ['specs/shared.md'] },
    });
    await linkSkill(viaDisabledSkillAgentId, [disabledSkillId]);

    const listRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    const list = listRes.json() as ContextDocumentList;
    const doc = list.documents.find((d) => d.path === 'specs/shared.md');
    expect(doc).toMatchObject({ used_by_agents: 2, used_by_disabled_skill_only: 1 });
  });
});
