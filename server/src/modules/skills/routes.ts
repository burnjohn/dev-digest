import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SkillType, SkillSource } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';

/**
 * A1 — skills module (§12, owner A1).
 *   GET  /skills                     → list (workspace-scoped)
 *   GET  /skills/:id                 → one skill
 *   POST /skills                     → create (manual)
 *   PUT  /skills/:id                 → update / toggle enabled (versions body)
 *   POST /skills/import              → import from file body OR url (untrusted)
 *   GET  /skills/community?q=        → search curated community catalog
 *   POST /skills/:id/link-agent      → make an enabled skill available to an agent
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: SkillType.optional(),
  source: SkillSource.optional(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).nullish(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().optional(),
  enabled: z.boolean().optional(),
});

const ImportBody = z
  .object({
    body: z.string().optional(),
    url: z.string().optional(),
    name: z.string().optional(),
    source: SkillSource.optional(),
  })
  .refine((b) => !!b.body || !!b.url, {
    message: 'Provide either a file body or a url to import',
  });

const LinkAgentBody = z.object({
  agent_id: z.string().uuid(),
  order: z.number().int().optional(),
});

export default async function skillsRoutes(app: FastifyInstance) {
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  // NOTE: /skills/community must be registered before /skills/:id is matched —
  // Fastify's radix router prefers the static segment, so order is not an issue,
  // but we keep this explicit for clarity.
  app.get<{ Querystring: { q?: string } }>('/skills/community', async (req) => {
    await getContext(app.container, req);
    return service.searchCommunity(req.query.q);
  });

  app.get<{ Params: { id: string } }>('/skills/:id', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = CreateSkillBody.parse(req.body);
    const skill = await service.create(workspaceId, {
      name: body.name,
      description: body.description,
      type: body.type,
      source: body.source,
      body: body.body,
      enabled: body.enabled,
      evidenceFiles: body.evidence_files ?? null,
    });
    reply.status(201);
    return skill;
  });

  app.put<{ Params: { id: string } }>('/skills/:id', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const patch = UpdateSkillBody.parse(req.body);
    const skill = await service.update(workspaceId, req.params.id, patch);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills/import', async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = ImportBody.parse(req.body);
    const skill = await service.importSkill(workspaceId, {
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.post<{ Params: { id: string } }>('/skills/:id/link-agent', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = LinkAgentBody.parse(req.body);
    await service.linkToAgent(workspaceId, body.agent_id, req.params.id, body.order ?? 0);
    return { linked: true, agent_id: body.agent_id, skill_id: req.params.id };
  });
}
