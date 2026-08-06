import { describe, it, expect } from 'vitest';
import { LocalSecretsProvider } from '../src/adapters/secrets/local.js';
import { SECRET_KEY_BY_PROVIDER } from '../src/modules/settings/constants.js';

describe('the env GitHub token is gone', () => {
  it('LocalSecretsProvider does not special-case GITHUB_TOKEN or GITHUB_PAT', async () => {
    const p = new LocalSecretsProvider('/nonexistent/secrets.json', {
      GITHUB_PAT: 'ghp_pat',
    } as NodeJS.ProcessEnv);
    // GITHUB_PAT must no longer stand in for GITHUB_TOKEN.
    await expect(p.get('GITHUB_TOKEN')).resolves.toBeUndefined();
  });

  it('no connection-test provider maps to the bare GITHUB_TOKEN key', () => {
    expect(Object.values(SECRET_KEY_BY_PROVIDER)).not.toContain('GITHUB_TOKEN');
    expect('github' in SECRET_KEY_BY_PROVIDER).toBe(false);
  });
});
