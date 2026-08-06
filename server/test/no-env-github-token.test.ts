import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalSecretsProvider } from '../src/adapters/secrets/local.js';
import { SECRET_KEY_BY_PROVIDER } from '../src/modules/settings/constants.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/**
 * `src/vendor/shared/` is skipped: `SecretKey` there still lists 'GITHUB_TOKEN'
 * as one arm of a union that ends in `(string & {})`. It is a type, so it
 * cannot perform a lookup, and the file is a shared contract this package may
 * not edit unilaterally.
 */
const SKIP = join(SRC, 'vendor', 'shared');

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path === SKIP) continue;
      out.push(...(await sourceFiles(path)));
    } else if (entry.name.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

describe('the env GitHub token is gone', () => {
  /**
   * The one regression that matters. Deleting LocalSecretsProvider's special
   * case did NOT close this hole: `get()`'s final line is
   * `return this.env[key as string]`, so ANY code asking for the literal
   * 'GITHUB_TOKEN' is still handed `process.env.GITHUB_TOKEN`. There is no
   * behavioural guard to lean on — the only thing keeping a bare env PAT out of
   * clone auth is that nothing asks for that key. So assert exactly that.
   *
   * Matching is on the quoted literal, which is how a lookup must spell it:
   * `secrets.get('GITHUB_TOKEN')`, or a constant like the deleted
   * `GITHUB_TOKEN_SECRET = 'GITHUB_TOKEN'` that a call site then passes. The
   * per-token keys are built as `` `GITHUB_TOKEN:${id}` `` — the ':' means the
   * quote does not immediately follow, so those do not match.
   */
  it('no production source asks the SecretsProvider for the bare GITHUB_TOKEN key', async () => {
    const bare = /(['"`])GITHUB_TOKEN\1/;
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      if (bare.test(await readFile(file, 'utf8'))) offenders.push(file.slice(SRC.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  it('and the env passthrough that would serve it is demonstrably still there', async () => {
    // Proof the test above is load-bearing rather than decorative: the generic
    // fallback happily resolves the bare key for anyone who asks.
    const p = new LocalSecretsProvider('/nonexistent/secrets.json', {
      GITHUB_TOKEN: 'ghp_env',
    } as NodeJS.ProcessEnv);
    await expect(p.get('GITHUB_TOKEN')).resolves.toBe('ghp_env');
  });

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
