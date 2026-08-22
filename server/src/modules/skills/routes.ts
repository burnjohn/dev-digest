import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillType, SkillSource } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';

/** `/skills/:id/restore` — id is a uuid, version a positive integer. */
const RestoreBody = z.object({
  version: z.number().int().positive(),
});

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: SkillType.optional(),
  source: SkillSource.optional(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  source: SkillSource.optional(),
  body: z.string().optional(),
  enabled: z.boolean().optional(),
  version_message: z.string().optional(),
});

const ImportBody = z.object({
  filename: z.string().min(1),
  content_base64: z.string().min(1),
});

/**
 * A1 — skills module (owner A1).
 *   GET    /skills                  → list (workspace-scoped)
 *   GET    /skills/:id              → one skill
 *   POST   /skills                  → create
 *   PUT    /skills/:id              → update (body change → new version)
 *   DELETE /skills/:id              → delete
 *   GET    /skills/:id/versions     → version history (newest first)
 *   POST   /skills/:id/restore      → { version } → restore to that body version
 *   GET    /skills/:id/stats        → usage & finding stats
 *   POST   /skills/import           → { filename, content_base64 } → preview (no persist)
 */
export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  // POST /skills/import must be registered BEFORE /skills/:id to avoid
  // "import" being treated as a uuid param.
  app.post('/skills/import', { schema: { body: ImportBody } }, async (req) => {
    await getContext(app.container, req);
    return service.importPreview(req.body.filename, req.body.content_base64);
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
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      body: body.body,
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, req.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

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

  app.post(
    '/skills/:id/restore',
    { schema: { params: IdParams, body: RestoreBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restore(workspaceId, req.params.id, req.body.version);
      if (!skill) throw new NotFoundError('Skill or version not found');
      return skill;
    },
  );

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skillStats = await service.stats(workspaceId, req.params.id);
    if (!skillStats) throw new NotFoundError('Skill not found');
    return skillStats;
  });
}
