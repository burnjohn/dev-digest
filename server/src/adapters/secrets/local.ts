import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SecretsProvider, SecretKey } from '@devdigest/shared';

/**
 * LocalSecretsProvider (§5) — writable MVP secrets backend.
 *
 * Reads stored overrides from a JSON file on disk (BYO keys entered via the
 * UI), falling back to process.env when a key has not been set. Writes persist
 * to the same file (mode 0600) so keys survive restarts. GITHUB_TOKEN falls
 * back to GITHUB_PAT (the name used in .env.example).
 *
 * Stored values take precedence over env so a key entered in the UI wins.
 * Swap for a VaultSecretsProvider later without touching call sites.
 */
export class LocalSecretsProvider implements SecretsProvider {
  private cache: Record<string, string> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    let data: Record<string, string> = {};
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (parsed && typeof parsed === 'object') data = parsed as Record<string, string>;
    } catch {
      // Missing or unreadable file → no stored overrides yet.
    }
    this.cache = data;
    return data;
  }

  async get(key: SecretKey): Promise<string | undefined> {
    const stored = (await this.load())[key as string];
    if (stored) return stored;
    if (key === 'GITHUB_TOKEN') return this.env.GITHUB_TOKEN ?? this.env.GITHUB_PAT;
    return this.env[key as string];
  }

  async set(key: SecretKey, value: string): Promise<void> {
    const data = await this.load();
    data[key as string] = value;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  }
}
