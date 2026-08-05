import { describe, it, expect, afterEach, vi } from 'vitest';
import type { SecretKey, SecretsProvider } from '@devdigest/shared';
import { resolveGitHubToken, tokenSecretKey } from '../src/modules/github-tokens/resolver.js';
import { MissingTokenError } from '../src/platform/errors.js';

/**
 * Serves ONLY from `stored`, and by presence (`in`) rather than truthiness, so a
 * stored `''` reaches the resolver verbatim and the resolver's own falsy check is
 * what rejects a tombstone. A fake written as `if (v) return v` would swallow the
 * empty string itself, turning the tombstone test into a copy of the
 * nothing-stored test that passes even if the resolver only rejects `undefined`.
 *
 * No env fallback on purpose: the environment is modelled by stubbing the REAL
 * `process.env`, never by a lookalike object the fake consults.
 */
function fakeSecrets(stored: Record<string, string>): SecretsProvider {
  return {
    async get(key: SecretKey) {
      if (key in stored) return stored[key as string];
      return undefined;
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveGitHubToken', () => {
  it('reads the namespaced key for the given token id', async () => {
    const secrets = fakeSecrets({ 'GITHUB_TOKEN:abc': 'ghp_abc' });
    await expect(resolveGitHubToken(secrets, 'abc')).resolves.toBe('ghp_abc');
  });

  it('throws MissingTokenError for a null id', async () => {
    const secrets = fakeSecrets({ 'GITHUB_TOKEN:abc': 'ghp_abc' });
    await expect(resolveGitHubToken(secrets, null)).rejects.toBeInstanceOf(MissingTokenError);
  });

  it('throws MissingTokenError when nothing is stored for the id', async () => {
    await expect(resolveGitHubToken(fakeSecrets({}), 'abc')).rejects.toBeInstanceOf(
      MissingTokenError,
    );
  });

  // Task 7 deletes a token by storing '' (SecretsProvider has no delete), so an
  // empty value must count as ABSENT. The first assertion pins the fake's own
  // behaviour — without it this test silently degrades into the nothing-stored
  // case above and would keep passing if the resolver rejected only `undefined`.
  it('treats a tombstoned empty value as absent', async () => {
    const secrets = fakeSecrets({ 'GITHUB_TOKEN:abc': '' });
    await expect(secrets.get('GITHUB_TOKEN:abc')).resolves.toBe('');
    await expect(resolveGitHubToken(secrets, 'abc')).rejects.toBeInstanceOf(MissingTokenError);
  });

  // Regression guard for the env fallback Task 6 deletes: the vars are stubbed
  // onto the REAL process.env, so a resolver that reads process.env.GITHUB_TOKEN
  // (or GITHUB_PAT) directly finds a genuine value, returns it, and fails this
  // assertion. A fake-mediated env map could not catch that shape of regression.
  it('never falls back to a bare GITHUB_TOKEN in the real environment', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_env');
    vi.stubEnv('GITHUB_PAT', 'ghp_env_pat');
    expect(process.env.GITHUB_TOKEN).toBe('ghp_env');

    await expect(resolveGitHubToken(fakeSecrets({}), 'abc')).rejects.toBeInstanceOf(
      MissingTokenError,
    );
  });

  // The other shape the deleted fallback could return as: asking the secrets
  // provider for the un-namespaced key instead of reading process.env.
  it('never falls back to a bare GITHUB_TOKEN key in the secrets provider', async () => {
    const secrets = fakeSecrets({ GITHUB_TOKEN: 'ghp_bare', GITHUB_PAT: 'ghp_bare_pat' });
    await expect(resolveGitHubToken(secrets, 'abc')).rejects.toBeInstanceOf(MissingTokenError);
  });

  it('MissingTokenError is a 422 with code token_missing', () => {
    const err = new MissingTokenError();
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('token_missing');
  });

  it('tokenSecretKey namespaces by id', () => {
    expect(tokenSecretKey('abc')).toBe('GITHUB_TOKEN:abc');
  });
});
