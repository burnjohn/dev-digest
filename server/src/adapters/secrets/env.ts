import type { SecretsProvider, SecretKey } from '@devdigest/shared';

/**
 * EnvSecretsProvider (§5) — MVP secrets backend reading from process.env.
 * GITHUB_TOKEN falls back to GITHUB_PAT (the name used in .env.example).
 * Swap for a VaultSecretsProvider later without touching call sites.
 */
export class EnvSecretsProvider implements SecretsProvider {
  constructor(private env: NodeJS.ProcessEnv = process.env) {}

  async get(key: SecretKey): Promise<string | undefined> {
    if (key === 'GITHUB_TOKEN') {
      return this.env.GITHUB_TOKEN ?? this.env.GITHUB_PAT;
    }
    return this.env[key as string];
  }
}
