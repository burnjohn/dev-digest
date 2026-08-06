/** Constants for the settings module. */
import type { ConnTestProvider, SecretKey } from '@devdigest/shared';

/** Provider id used by the GitHub connection test branch. */
export const GITHUB_PROVIDER = 'github';

/** Maps a connection-test provider to the SecretsProvider key it persists to.
    `github` is absent on purpose — GitHub PATs are per-repo tokens managed by
    the github-tokens module, not a single global secret. */
export const SECRET_KEY_BY_PROVIDER: Partial<Record<ConnTestProvider, SecretKey>> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};
