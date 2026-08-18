import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CreateSkillBody, SkillImportPreviewBody, UpdateSkillBody } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import { MAX_IMPORT_BYTES } from './import.js';
import { DEFAULT_STATS_WINDOW_DAYS } from './constants.js';

/**
 * Skills module.
 *   GET    /skills               → list (workspace-scoped)
 *   GET    /skills/:id           → one skill
 *   POST   /skills               → create
 *   PUT    /skills/:id           → update (body change bumps version)
 *   DELETE /skills/:id           → delete (agent links cascade)
 *   GET    /skills/:id/versions  → body history (newest first)
 *   GET    /skills/:id/agents    → agent ids currently linking this skill
 *   GET    /skills/:id/stats     → usage aggregates (Stats tab), ?days=
 *   POST   /skills/import/preview → extract from an upload; persists NOTHING
 *
 * Import is two calls on purpose. `preview` reads bytes and returns the
 * extracted core; the client shows it, and only a subsequent `POST /skills`
 * writes anything. Nothing is held server-side between the two, so "saved only
 * after confirmation" cannot be bypassed by a client that forgets to ask.
 */

/** `?days=` on the stats route — coerced so `?days=30` (a string) validates. */
const StatsQuery = z.object({
  days: z.coerce.number().int().positive().max(365).default(DEFAULT_STATS_WINDOW_DAYS),
});

/**
 * Base64 inflates by 4/3, and the route has to reject an over-sized upload
 * BEFORE it buffers it. Add a little slack for padding and any whitespace a
 * client's encoder leaves in.
 */
const IMPORT_BODY_LIMIT = Math.ceil(MAX_IMPORT_BYTES * (4 / 3)) + 8192;

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.create(workspaceId, {
      name: body.name,
      description: body.description,
      type: body.type,
      source: body.source,
      body: body.body,
      enabled: body.enabled,
    });
    reply.status(201);
    return skill;
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get('/skills/:id/agents', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agentIds = await service.agentsUsing(workspaceId, req.params.id);
    if (!agentIds) throw new NotFoundError('Skill not found');
    return { agent_ids: agentIds };
  });

  app.get(
    '/skills/:id/stats',
    { schema: { params: IdParams, querystring: StatsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const stats = await service.stats(workspaceId, req.params.id, req.query.days);
      if (!stats) throw new NotFoundError('Skill not found');
      return stats;
    },
  );

  app.post(
    '/skills/import/preview',
    { bodyLimit: IMPORT_BODY_LIMIT, schema: { body: SkillImportPreviewBody } },
    async (req) => {
      await getContext(app.container, req);
      const { filename, content_base64: contentBase64 } = req.body;

      // Buffer.from never throws on bad base64 — it silently drops characters
      // it can't read, so total garbage decodes to an empty buffer rather than
      // an error. Catch that here, where the message can name the real problem;
      // partially-valid input falls through to the extractor's UTF-8 check.
      const bytes = Buffer.from(contentBase64, 'base64');
      if (bytes.length === 0) throw new ValidationError('content_base64 is not valid base64');

      return service.preview({ filename, bytes: new Uint8Array(bytes) });
    },
  );
}
