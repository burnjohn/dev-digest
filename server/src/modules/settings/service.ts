import type { Container } from '../../platform/container.js';
import type {
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  Settings,
  SettingsUpdate,
} from '@devdigest/shared';
import { SettingsRepository } from './repository.js';
import { GITHUB_PROVIDER, SECRET_KEY_BY_PROVIDER } from './constants.js';
import { rowsToSettings } from './helpers.js';
import { ValidationError } from '../../platform/errors.js';
import { GitHubTokenService } from '../github-tokens/service.js';

/**
 * F1 — settings service. Non-secret workspace prefs, plus the provider
 * connection test.
 *
 * The split that matters here: PREFS live in the `settings` table, KEYS live in
 * SecretsProvider. `secretsStatus` deliberately returns booleans — the values
 * are never read back out over the API.
 */
export class SettingsService {
  private repo: SettingsRepository;

  constructor(private container: Container) {
    this.repo = new SettingsRepository(container.db);
  }

  async get(workspaceId: string): Promise<Settings> {
    return rowsToSettings(await this.repo.listForWorkspace(workspaceId));
  }

  /** Upsert the supplied prefs (one transaction), then return the resulting set. */
  async update(workspaceId: string, userId: string, patch: SettingsUpdate): Promise<Settings> {
    await this.repo.upsertMany(workspaceId, userId, patch);
    return this.get(workspaceId);
  }

  /** Which provider keys are configured — booleans only, never the values. */
  async secretsStatus(workspaceId: string): Promise<SecretsStatus> {
    const entries = await Promise.all(
      (Object.entries(SECRET_KEY_BY_PROVIDER) as [keyof SecretsStatus, string][]).map(
        async ([provider, key]) => [provider, Boolean(await this.container.secrets.get(key))] as const,
      ),
    );
    // GitHub PATs are per-repo tokens (github-tokens module), so the contract's
    // required `github` boolean reports whether ANY stored token value resolves —
    // the honest reading of "true ⇒ a key/PAT is stored".
    const tokens = await new GitHubTokenService(this.container).list(workspaceId);
    return {
      ...(Object.fromEntries(entries) as Omit<SecretsStatus, 'github'>),
      github: tokens.some((token) => token.configured),
    };
  }

  /**
   * Test a provider credential with a cheap live call (listModels / GET user).
   *
   * A failure is a RESULT, not an exception: the panel renders the message
   * inline, so every path returns `{ ok: false, message }` rather than throwing
   * into the error handler.
   */
  async testConnection(provider: ConnTestProvider, key?: string): Promise<ConnTestResult> {
    // GitHub PATs are per-repo tokens managed by the github-tokens module —
    // there is no global GitHub secret left to test here.
    if (provider === GITHUB_PROVIDER) {
      throw new ValidationError('Use POST /github-tokens/test to validate a GitHub token');
    }
    try {
      const secretKey = SECRET_KEY_BY_PROVIDER[provider];
      if (!secretKey) return { provider, ok: false, message: 'Unsupported provider' };
      // A supplied key is persisted (BYO key) BEFORE the test, so the test
      // reflects — and the rest of the app can use — the new value.
      if (key) {
        if (!this.container.secrets.set) {
          return { provider, ok: false, message: 'Secrets backend is read-only' };
        }
        await this.container.secrets.set(secretKey, key);
        this.container.invalidateSecretCaches();
      }
      const llm = await this.container.llm(provider);
      const models = await llm.listModels();
      return { provider, ok: true, message: `OK — ${models.length} models available` };
    } catch (err) {
      return { provider, ok: false, message: (err as Error).message };
    }
  }
}
