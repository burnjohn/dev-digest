import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import {
  SettingsUpdate,
  ConnTestRequest,
  type ConnTestResult,
  type SecretsStatus,
} from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { GITHUB_PROVIDER, SECRET_KEY_BY_PROVIDER } from './constants.js';
import { rowsToSettings } from './helpers.js';

/**
 * F1 — settings module.
 *   GET  /settings                 → current non-secret prefs
 *   PUT  /settings                 → upsert prefs (key/value rows)
 *   POST /settings/test-connection → test a provider key (OpenAI/Anthropic/GitHub)
 *
 * Secrets are NOT stored here — only non-secret prefs. test-connection reads
 * the key via SecretsProvider and does a cheap live call (listModels / GET user).
 */
export default async function settingsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/settings', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const rows = await container.db
      .select()
      .from(t.settings)
      .where(eq(t.settings.workspaceId, workspaceId));
    return rowsToSettings(rows);
  });

  // Which provider keys are configured (booleans only — the values are NEVER
  // returned). Drives the "Configured / Not set" badges in the API Keys panel.
  app.get('/settings/secrets-status', async (req): Promise<SecretsStatus> => {
    await getContext(container, req);
    const entries = await Promise.all(
      (Object.entries(SECRET_KEY_BY_PROVIDER) as [keyof SecretsStatus, string][]).map(
        async ([provider, key]) => [provider, Boolean(await container.secrets.get(key))] as const,
      ),
    );
    return Object.fromEntries(entries) as SecretsStatus;
  });

  app.put('/settings', { schema: { body: SettingsUpdate } }, async (req) => {
    const { workspaceId, userId } = await getContext(container, req);
    const body = req.body;
    for (const [key, value] of Object.entries(body)) {
      await container.db
        .insert(t.settings)
        .values({ workspaceId, userId, key, value })
        .onConflictDoUpdate({
          target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
          set: { value },
        });
    }
    const rows = await container.db
      .select()
      .from(t.settings)
      .where(eq(t.settings.workspaceId, workspaceId));
    return rowsToSettings(rows);
  });

  app.post(
    '/settings/test-connection',
    {
      schema: { body: ConnTestRequest },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req): Promise<ConnTestResult> => {
    const { provider, key } = req.body;
    try {
      // If the UI supplied a key, persist it (BYO key) before testing so the
      // test reflects — and the rest of the app can use — the new value.
      if (key) {
        if (!container.secrets.set) {
          return { provider, ok: false, message: 'Secrets backend is read-only' };
        }
        await container.secrets.set(SECRET_KEY_BY_PROVIDER[provider], key);
        container.invalidateSecretCaches();
      }
      if (provider === GITHUB_PROVIDER) {
        const gh = await container.github();
        const login = await gh.currentLogin();
        return { provider, ok: true, message: `Connected as @${login}` };
      }
      const llm = await container.llm(provider);
      const models = await llm.listModels();
      return { provider, ok: true, message: `OK — ${models.length} models available` };
    } catch (err) {
      return { provider, ok: false, message: (err as Error).message };
    }
  });
}
