import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import {
  Settings,
  SettingsUpdate,
  ConnTestRequest,
  ConnTestResult,
  SecretsStatus,
} from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { ValidationError } from '../../platform/errors.js';
import { GITHUB_PROVIDER, SECRET_KEY_BY_PROVIDER } from './constants.js';
import { rowsToSettings } from './helpers.js';
import { upsertSettings } from './store.js';
import { GitHubTokenService } from '../github-tokens/service.js';

/**
 * F1 — settings module.
 *   GET  /settings                 → current non-secret prefs
 *   PUT  /settings                 → upsert prefs (key/value rows)
 *   POST /settings/test-connection → test an LLM provider key (OpenAI/Anthropic/OpenRouter);
 *                                     GitHub is rejected here — see POST /github-tokens/test
 *
 * Secrets are NOT stored here — only non-secret prefs. test-connection reads
 * the key via SecretsProvider and does a cheap live call (listModels).
 */
export default async function settingsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const githubTokens = new GitHubTokenService(app.container);

  app.get('/settings', { schema: { response: { 200: Settings } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const rows = await container.db
      .select()
      .from(t.settings)
      .where(eq(t.settings.workspaceId, workspaceId));
    return rowsToSettings(rows);
  });

  // Which provider keys are configured (booleans only — the values are NEVER
  // returned). Drives the "Configured / Not set" badges in the API Keys panel.
  app.get(
    '/settings/secrets-status',
    { schema: { response: { 200: SecretsStatus } } },
    async (req): Promise<SecretsStatus> => {
      const { workspaceId } = await getContext(container, req);
      const entries = await Promise.all(
        (Object.entries(SECRET_KEY_BY_PROVIDER) as [keyof SecretsStatus, string][]).map(
          async ([provider, key]) => [provider, Boolean(await container.secrets.get(key))] as const,
        ),
      );
      // GitHub PATs are per-repo tokens (github-tokens module), so the
      // contract's required `github` boolean now reports whether ANY stored
      // token value resolves — the honest reading of "true ⇒ a key/PAT is
      // stored". The response schema above guarantees the field is present.
      const tokens = await githubTokens.list(workspaceId);
      return {
        ...(Object.fromEntries(entries) as Omit<SecretsStatus, 'github'>),
        github: tokens.some((token) => token.configured),
      };
    },
  );

  app.put('/settings', { schema: { body: SettingsUpdate, response: { 200: Settings } } }, async (req) => {
    const { workspaceId, userId } = await getContext(container, req);
    // ONE transaction (upsertSettings): a partial payload must land whole or
    // not at all — no half-applied preference bags on a mid-loop failure.
    const rows = await upsertSettings(container.db, workspaceId, userId, req.body);
    return rowsToSettings(rows);
  });

  app.post(
    '/settings/test-connection',
    {
      schema: { body: ConnTestRequest, response: { 200: ConnTestResult } },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req): Promise<ConnTestResult> => {
    const { provider, key } = req.body;
    // GitHub PATs are per-repo tokens managed by the github-tokens module —
    // there is no global GitHub secret left to test here.
    if (provider === GITHUB_PROVIDER) {
      throw new ValidationError('Use POST /github-tokens/test to validate a GitHub token');
    }
    try {
      const secretKey = SECRET_KEY_BY_PROVIDER[provider];
      if (!secretKey) return { provider, ok: false, message: 'Unsupported provider' };
      // If the UI supplied a key, persist it (BYO key) before testing so the
      // test reflects — and the rest of the app can use — the new value.
      if (key) {
        if (!container.secrets.set) {
          return { provider, ok: false, message: 'Secrets backend is read-only' };
        }
        await container.secrets.set(secretKey, key);
        container.invalidateSecretCaches();
      }
      const llm = await container.llm(provider);
      const models = await llm.listModels();
      return { provider, ok: true, message: `OK — ${models.length} models available` };
    } catch (err) {
      return { provider, ok: false, message: (err as Error).message };
    }
  });
}
