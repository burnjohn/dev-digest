import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillSource, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import { MAX_VERSION_MESSAGE_CHARS } from './constants.js';

/**
 * A1 — skills module. A skill is reusable review guidance: text + config, never
 * code. Skills are workspace-scoped and shared across agents; the agent side of
 * the link (order + per-agent enable) lives in the agents module.
 *
 *   GET    /skills                     → list with used-by counts
 *   GET    /skills/:id                 → one skill
 *   POST   /skills                     → create
 *   PUT    /skills/:id                 → update (a content change bumps version)
 *   DELETE /skills/:id                 → delete (links cascade)
 *   GET    /skills/:id/versions        → body history, newest first
 *   GET    /skills/:id/versions/:version → one snapshot
 *   GET    /skills/:id/agents          → agents linking it (delete confirmation)
 *   POST   /skills/import              → parse an upload into a PREVIEW (no write)
 */

/** `/skills/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  type: SkillType,
  body: z.string().min(1),
  source: SkillSource.optional(),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  // Recorded on the version this save writes, when it writes one. Ignored on an
  // enabled-only toggle, which does not create a version.
  version_message: z.string().max(MAX_VERSION_MESSAGE_CHARS).optional(),
});

/**
 * Import upload. The file arrives base64-encoded in JSON rather than as
 * multipart: a skill is a small text document, so this avoids a multipart
 * plugin entirely and keeps the size cap at Fastify's body limit.
 */
const ImportSkillBody = z.object({
  filename: z.string().min(1),
  content_b64: z.string().min(1),
});

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
    const skill = await service.create(workspaceId, req.body);
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

  app.get('/skills/:id/versions/:version', { schema: { params: VersionParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
    if (!version) throw new NotFoundError('Skill version not found');
    return version;
  });

  app.get('/skills/:id/agents', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agents = await service.linkedAgents(workspaceId, req.params.id);
    if (!agents) throw new NotFoundError('Skill not found');
    return agents;
  });

  // Parses only — the preview is shown to the user, who then POSTs /skills.
  app.post('/skills/import', { schema: { body: ImportSkillBody } }, async (req) => {
    await getContext(app.container, req);
    return service.importPreview(req.body.filename, req.body.content_b64);
  });
}
