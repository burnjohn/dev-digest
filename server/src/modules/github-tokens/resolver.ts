import type { SecretsProvider } from '@devdigest/shared';
import { MissingTokenError } from '../../platform/errors.js';

/**
 * The ONE place that knows how a token id maps to a secrets key. Swapping
 * LocalSecretsProvider for a Vault backend stays a one-adapter change.
 */
export const tokenSecretKey = (githubTokenId: string): string => `GITHUB_TOKEN:${githubTokenId}`;

/**
 * Resolve the PAT for a repo's assigned token. One lookup, no fallback —
 * a bare GITHUB_TOKEN in the environment is deliberately never consulted.
 * An empty stored value counts as absent (that is how deletion tombstones).
 */
export async function resolveGitHubToken(
  secrets: SecretsProvider,
  githubTokenId: string | null,
): Promise<string> {
  if (!githubTokenId) throw new MissingTokenError();
  const value = await secrets.get(tokenSecretKey(githubTokenId));
  if (!value) throw new MissingTokenError();
  return value;
}
