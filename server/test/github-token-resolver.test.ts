import { describe, it, expect } from 'vitest';
import type { SecretKey, SecretsProvider } from '@devdigest/shared';
import { resolveGitHubToken, tokenSecretKey } from '../src/modules/github-tokens/resolver.js';
import { MissingTokenError } from '../src/platform/errors.js';

function fakeSecrets(stored: Record<string, string>, env: NodeJS.ProcessEnv = {}): SecretsProvider {
  return {
    async get(key: SecretKey) {
      const v = stored[key as string];
      if (v) return v;
      return env[key as string];
    },
  };
}

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

  it('treats a tombstoned empty value as absent', async () => {
    const secrets = fakeSecrets({ 'GITHUB_TOKEN:abc': '' });
    await expect(resolveGitHubToken(secrets, 'abc')).rejects.toBeInstanceOf(MissingTokenError);
  });

  // Regression guard for the removed env fallback: a bare GITHUB_TOKEN in the
  // environment must NEVER be used for any repo.
  it('never falls back to a bare GITHUB_TOKEN from the environment', async () => {
    const secrets = fakeSecrets({}, { GITHUB_TOKEN: 'ghp_env', GITHUB_PAT: 'ghp_env_pat' });
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
