import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Provider } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { AgentsService } from './service.js';

/**
 * A2 — agents module (§12, owner A2).
 *   GET    /agents                  → list (workspace-scoped)
 *   GET    /agents/:id              → one agent
 *   POST   /agents                  → create
 *   PUT    /agents/:id              → update / toggle enabled (versions config)
 *   GET    /agents/:id/skills       → linked skills (ordered)
 *   POST   /agents/:id/skills       → set/reorder linked skills OR link one
 *   GET    /agents/:id/models       → dynamic model list for the agent's provider
 *   GET    /providers/:id/models    → dynamic model list for a provider (editor)
 */

const CreateAgentBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  provider: Provider,
  model: z.string().min(1),
  system_prompt: z.string().min(1),
  output_schema: z.unknown().optional(),
  enabled: z.boolean().optional(),
});

const UpdateAgentBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  provider: Provider.optional(),
  model: z.string().min(1).optional(),
  system_prompt: z.string().min(1).optional(),
  output_schema: z.unknown().optional(),
  enabled: z.boolean().optional(),
});

/** Either set the whole ordered set (`skill_ids`) or link one (`skill_id`). */
const SetSkillsBody = z
  .object({
    skill_ids: z.array(z.string().uuid()).optional(),
    skill_id: z.string().uuid().optional(),
    order: z.number().int().optional(),
  })
  .refine((b) => b.skill_ids !== undefined || b.skill_id !== undefined, {
    message: 'Provide skill_ids (set/reorder) or skill_id (link one)',
  });

export default async function agentsRoutes(app: FastifyInstance) {
  const service = new AgentsService(app.container);

  app.get('/agents', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get<{ Params: { id: string } }>('/agents/:id', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agent = await service.get(workspaceId, req.params.id);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  });

  app.post('/agents', async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const body = CreateAgentBody.parse(req.body);
    const agent = await service.create(
      workspaceId,
      {
        name: body.name,
        provider: body.provider,
        model: body.model,
        system_prompt: body.system_prompt,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.output_schema !== undefined ? { output_schema: body.output_schema } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      },
      userId,
    );
    reply.status(201);
    return agent;
  });

  app.put<{ Params: { id: string } }>('/agents/:id', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const patch = UpdateAgentBody.parse(req.body);
    const agent = await service.update(workspaceId, req.params.id, patch);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  });

  app.get<{ Params: { id: string } }>('/agents/:id/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agent = await service.get(workspaceId, req.params.id);
    if (!agent) throw new NotFoundError('Agent not found');
    return service.skillLinks(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/agents/:id/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = SetSkillsBody.parse(req.body);
    const links =
      body.skill_ids !== undefined
        ? await service.setSkills(workspaceId, req.params.id, body.skill_ids)
        : await service.linkSkill(workspaceId, req.params.id, body.skill_id!, body.order);
    if (!links) throw new NotFoundError('Agent not found');
    return links;
  });

  app.get<{ Params: { id: string } }>('/agents/:id/models', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agent = await service.get(workspaceId, req.params.id);
    if (!agent) throw new NotFoundError('Agent not found');
    return service.listModels(agent.provider);
  });

  app.get<{ Params: { id: string } }>('/providers/:id/models', async (req) => {
    await getContext(app.container, req);
    const provider = Provider.parse(req.params.id);
    return service.listModels(provider);
  });
}
