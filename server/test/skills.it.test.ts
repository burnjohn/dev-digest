import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * The skills module end to end: CRUD, the version snapshot rule, import parsing,
 * and the two-switch link semantics that decide what reaches an agent's prompt.
 */
d('skills module', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const newSkill = (name: string) => ({
    name,
    description: 'When X happens, do Y.',
    type: 'rubric' as const,
    body: '# Rule\nDo the thing.',
  });

  async function createSkill(app: Awaited<ReturnType<typeof makeApp>>, name: string) {
    const res = await app.inject({ method: 'POST', url: '/skills', payload: newSkill(name) });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  it('seeds the two skill-driven reviewers, disabled, with their skills attached', async () => {
    const app = await makeApp();
    const agents = (await app.inject({ url: '/agents' })).json();

    for (const name of ['Test Quality Reviewer', 'API Contract Reviewer']) {
      const agent = agents.find((a: { name: string }) => a.name === name);
      expect(agent, `${name} should be seeded`).toBeTruthy();
      // Off by default: turning them on is step one of the control experiment.
      expect(agent.enabled).toBe(false);

      const links = (await app.inject({ url: `/agents/${agent.id}/skills` })).json();
      expect(links.length).toBeGreaterThan(0);
      expect(links.every((l: { link_enabled: boolean }) => l.link_enabled)).toBe(true);
      // Seeded links keep SEED_SKILLS order and are contiguous from zero.
      expect(links.map((l: { order: number }) => l.order)).toEqual(links.map((_: unknown, i: number) => i));
    }
    await app.close();
  });

  it('creates a skill at version 1 with a matching version snapshot', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'create-v1');
    expect(skill).toMatchObject({ name: 'create-v1', version: 1, enabled: true, source: 'manual' });

    const versions = await app.inject({ url: `/skills/${skill.id}/versions` });
    expect(versions.json()).toHaveLength(1);
    expect(versions.json()[0]).toMatchObject({ version: 1, body: skill.body });
    await app.close();
  });

  it('bumps the version and snapshots the body when the content changes', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'bump-on-edit');

    const updated = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: '# Rule\nDo it differently.' },
    });
    expect(updated.json().version).toBe(2);

    const versions = await app.inject({ url: `/skills/${skill.id}/versions` });
    // Newest first, and the old body is still readable.
    expect(versions.json().map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions.json()[1].body).toBe('# Rule\nDo the thing.');
    await app.close();
  });

  it('records the author\'s version message on the version that save writes', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'with-message');

    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: '# Rule\nWith a note.', version_message: 'Added the async section' },
    });

    const versions = (await app.inject({ url: `/skills/${skill.id}/versions` })).json();
    expect(versions[0]).toMatchObject({ version: 2, message: 'Added the async section' });
    // v1 predates the note and stays unlabelled rather than inheriting it.
    expect(versions[1].message).toBeNull();
    await app.close();
  });

  it('stores no message when the note is blank or absent', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'blank-message');

    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: '# Rule\nOne.', version_message: '   ' },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: '# Rule\nTwo.' },
    });

    const versions = (await app.inject({ url: `/skills/${skill.id}/versions` })).json();
    // Whitespace-only and omitted both mean "no note": the UI derives a summary.
    expect(versions.map((v: { message: string | null }) => v.message)).toEqual([null, null, null]);
    await app.close();
  });

  it('ignores a version message on an enabled-only toggle, which writes no version', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'toggle-with-message');

    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { enabled: false, version_message: 'should not be recorded' },
    });

    const versions = (await app.inject({ url: `/skills/${skill.id}/versions` })).json();
    expect(versions).toHaveLength(1);
    expect(versions[0].message).toBeNull();
    await app.close();
  });

  it('rejects a version message longer than the cap', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'long-message');
    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: '# Rule\nLong note.', version_message: 'x'.repeat(201) },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('does NOT bump the version when only `enabled` is toggled', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'toggle-no-bump');

    const off = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { enabled: false },
    });
    expect(off.json()).toMatchObject({ enabled: false, version: 1 });

    const versions = await app.inject({ url: `/skills/${skill.id}/versions` });
    expect(versions.json()).toHaveLength(1);
    await app.close();
  });

  it('404s on an unknown skill and on an unknown version', async () => {
    const app = await makeApp();
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await app.inject({ url: `/skills/${missing}` })).statusCode).toBe(404);

    const skill = await createSkill(app, 'version-404');
    expect((await app.inject({ url: `/skills/${skill.id}/versions/9` })).statusCode).toBe(404);
    await app.close();
  });

  it('reports how many agents use a skill, and deleting it unlinks them', async () => {
    const app = await makeApp();
    const skill = await createSkill(app, 'usage-count');
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: `Usage Agent ${Date.now()}`,
          provider: 'openai',
          model: 'gpt-4o-mini',
          system_prompt: 'Review.',
        },
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skills: [{ skill_id: skill.id, enabled: true }] },
    });

    const listed = (await app.inject({ url: '/skills' })).json();
    expect(listed.find((s: { id: string }) => s.id === skill.id).used_by).toBe(1);

    const users = (await app.inject({ url: `/skills/${skill.id}/agents` })).json();
    expect(users).toEqual([{ id: agent.id, name: agent.name }]);

    await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    const afterDelete = (await app.inject({ url: `/agents/${agent.id}/skills` })).json();
    expect(afterDelete).toEqual([]);
    await app.close();
  });

  describe('agent links', () => {
    async function makeAgent(app: Awaited<ReturnType<typeof makeApp>>, name: string) {
      return (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: {
            name,
            provider: 'openai',
            model: 'gpt-4o-mini',
            system_prompt: 'Review.',
          },
        })
      ).json();
    }

    it('keeps the link (and its order) when a skill is switched off for an agent', async () => {
      const app = await makeApp();
      const a = await createSkill(app, `link-a-${Date.now()}`);
      const b = await createSkill(app, `link-b-${Date.now()}`);
      const agent = await makeAgent(app, `Link Agent ${Date.now()}`);

      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: {
          skills: [
            { skill_id: a.id, enabled: true },
            { skill_id: b.id, enabled: false },
          ],
        },
      });

      const links = (await app.inject({ url: `/agents/${agent.id}/skills` })).json();
      expect(links.map((l: { id: string; link_enabled: boolean }) => [l.id, l.link_enabled])).toEqual([
        [a.id, true],
        [b.id, false],
      ]);
      // The disabled one is still attached, so its position survives.
      expect(links[1].order).toBe(1);
      await app.close();
    });

    it('reorders by resending the set, and the order is what comes back', async () => {
      const app = await makeApp();
      const a = await createSkill(app, `order-a-${Date.now()}`);
      const b = await createSkill(app, `order-b-${Date.now()}`);
      const agent = await makeAgent(app, `Order Agent ${Date.now()}`);

      const set = (ids: string[]) =>
        app.inject({
          method: 'POST',
          url: `/agents/${agent.id}/skills`,
          payload: { skills: ids.map((id) => ({ skill_id: id, enabled: true })) },
        });

      await set([a.id, b.id]);
      await set([b.id, a.id]);

      const links = (await app.inject({ url: `/agents/${agent.id}/skills` })).json();
      expect(links.map((l: { id: string }) => l.id)).toEqual([b.id, a.id]);
      await app.close();
    });

    it('bumps the agent version on a link change and snapshots only enabled skills', async () => {
      const app = await makeApp();
      const a = await createSkill(app, `snap-a-${Date.now()}`);
      const b = await createSkill(app, `snap-b-${Date.now()}`);
      const agent = await makeAgent(app, `Snapshot Agent ${Date.now()}`);
      expect(agent.version).toBe(1);

      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: {
          skills: [
            { skill_id: a.id, enabled: true },
            { skill_id: b.id, enabled: false },
          ],
        },
      });

      const after = (await app.inject({ url: `/agents/${agent.id}` })).json();
      expect(after.version).toBe(2);

      const versions = (await app.inject({ url: `/agents/${agent.id}/versions` })).json();
      // The snapshot records what shaped the prompt — the disabled link did not.
      expect(versions[0]).toMatchObject({ version: 2 });
      expect(versions[0].config.skills).toEqual([a.id]);
      await app.close();
    });

    it('accepts the older skill_ids form and treats every id as enabled', async () => {
      const app = await makeApp();
      const a = await createSkill(app, `legacy-${Date.now()}`);
      const agent = await makeAgent(app, `Legacy Agent ${Date.now()}`);

      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_ids: [a.id] },
      });

      const links = (await app.inject({ url: `/agents/${agent.id}/skills` })).json();
      expect(links[0]).toMatchObject({ id: a.id, link_enabled: true });
      await app.close();
    });
  });

  describe('import', () => {
    const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

    it('parses a markdown upload into a preview without persisting anything', async () => {
      const app = await makeApp();
      const before = (await app.inject({ url: '/skills' })).json().length;

      const res = await app.inject({
        method: 'POST',
        url: '/skills/import',
        payload: {
          filename: 'imported-rule.md',
          content_b64: b64('---\ntype: security\n---\n# Imported rule\n\nFlag hardcoded secrets.'),
        },
      });

      expect(res.json()).toMatchObject({
        name: 'Imported rule',
        description: 'Flag hardcoded secrets.',
        type: 'security',
        source: 'imported_url',
        ignored_entries: [],
      });
      // Preview only: the library is unchanged until the user confirms.
      expect((await app.inject({ url: '/skills' })).json()).toHaveLength(before);
      await app.close();
    });

    it('takes the markdown out of an archive and lists everything else as ignored', async () => {
      const app = await makeApp();
      const archive = zipSync({
        'SKILL.md': strToU8('# Archived skill\n\nThe body.'),
        'scripts/install.sh': strToU8('#!/bin/sh\necho pwned'),
        'assets/logo.png': strToU8('not really a png'),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/skills/import',
        payload: {
          filename: 'bundle.zip',
          content_b64: Buffer.from(archive).toString('base64'),
        },
      });

      const preview = res.json();
      expect(preview.name).toBe('Archived skill');
      expect(preview.body).toContain('The body.');
      // The script is reported, never read into the skill and never run.
      expect(preview.ignored_entries).toEqual(['assets/logo.png', 'scripts/install.sh']);
      expect(preview.body).not.toContain('pwned');
      expect(preview.warnings[0]).toContain('install.sh');
      await app.close();
    });

    it('422s an archive with no markdown in it', async () => {
      const app = await makeApp();
      const archive = zipSync({ 'run.sh': strToU8('#!/bin/sh') });
      const res = await app.inject({
        method: 'POST',
        url: '/skills/import',
        payload: {
          filename: 'no-md.zip',
          content_b64: Buffer.from(archive).toString('base64'),
        },
      });
      expect(res.statusCode).toBe(422);
      await app.close();
    });
  });
});
