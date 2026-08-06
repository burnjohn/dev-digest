/**
 * Container.github(githubTokenId) — required-argument, per-token-id cache.
 *
 * No real DB: Container never touches `this.db` unless a route handler calls
 * it, and this suite only exercises the GitHub-client resolution path, so a
 * cast stub stands in for `Db` (avoids opening a real postgres-js connection
 * in a hermetic test).
 */
import { describe, it, expect } from 'vitest';
import type { SecretKey, SecretsProvider } from '@devdigest/shared';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MissingTokenError } from '../src/platform/errors.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import type { Db } from '../src/db/client.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const fakeDb = {} as Db;

function secretsWith(stored: Record<string, string>): SecretsProvider {
  return {
    async get(key: SecretKey) {
      return stored[key as string];
    },
    async set(key: SecretKey, value: string) {
      stored[key as string] = value;
    },
  };
}

describe('Container.github(githubTokenId)', () => {
  it('returns the same client for the same id and different clients per id', async () => {
    const c = new Container(config, fakeDb, {
      secrets: secretsWith({ 'GITHUB_TOKEN:a': 'ghp_a', 'GITHUB_TOKEN:b': 'ghp_b' }),
    });
    const a1 = await c.github('a');
    const a2 = await c.github('a');
    const b1 = await c.github('b');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b1);
  });

  it('throws MissingTokenError for a null id', async () => {
    const c = new Container(config, fakeDb, { secrets: secretsWith({}) });
    await expect(c.github(null)).rejects.toBeInstanceOf(MissingTokenError);
  });

  it('invalidateSecretCaches drops cached clients so a replaced value takes effect', async () => {
    const stored: Record<string, string> = { 'GITHUB_TOKEN:a': 'ghp_a' };
    const c = new Container(config, fakeDb, { secrets: secretsWith(stored) });
    const first = await c.github('a');
    stored['GITHUB_TOKEN:a'] = 'ghp_rotated';
    c.invalidateSecretCaches();
    const second = await c.github('a');
    expect(second).not.toBe(first);
  });

  it('an injected override wins over resolution, with any id', async () => {
    const gh = new MockGitHubClient();
    const c = new Container(config, fakeDb, { secrets: secretsWith({}), github: gh });
    await expect(c.github(null)).resolves.toBe(gh);
    await expect(c.github('anything')).resolves.toBe(gh);
  });
});
