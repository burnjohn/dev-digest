import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Agent, AgentRestoreRequest, CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { AgentsService } from './service.js';

/** `/providers/:id` addresses a provider by name, not a uuid. */
const ProviderParams = z.object({ id: Provider });

/** `/agents/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/**
 * A2 — agents module (owner A2).
 *   GET    /agents                  → list (workspace-scoped)
 *   GET    /agents/:id              → one agent
 *   POST   /agents                  → create
 *   PUT    /agents/:id              → update / toggle enabled (versions config)
 *   GET    /agents/:id/versions     → config history (newest first)
 *   GET    /agents/:id/versions/:version → one config snapshot
 *   POST   /agents/:id/restore        → replay an old version as a new one
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
  strategy: ReviewStrategy.optional(),
  ci_fail_on: CiFailOn.optional(),
  repo_intel: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const UpdateAgentBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  provider: Provider.optional(),
  model: z.string().min(1).optional(),
  system_prompt: z.string().min(1).optional(),
  output_schema: z.unknown().optional(),
  strategy: ReviewStrategy.optional(),
  ci_fail_on: CiFailOn.optional(),
  repo_intel: z.boolean().optional(),
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

export default async function agentsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new AgentsService(app.container);

  app.get('/agents', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/agents/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agent = await service.get(workspaceId, req.params.id);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  });

  app.post('/agents', { schema: { body: CreateAgentBody } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const body = req.body;
    const agent = await service.create(
      workspaceId,
      {
        name: body.name,
        provider: body.provider,
        model: body.model,
        system_prompt: body.system_prompt,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.output_schema !== undefined ? { output_schema: body.output_schema } : {}),
        ...(body.strategy !== undefined ? { strategy: body.strategy } : {}),
        ...(body.ci_fail_on !== undefined ? { ci_fail_on: body.ci_fail_on } : {}),
        ...(body.repo_intel !== undefined ? { repo_intel: body.repo_intel } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      },
      userId,
    );
    reply.status(201);
    return agent;
  });

  app.put(
    '/agents/:id',
    { schema: { params: IdParams, body: UpdateAgentBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const agent = await service.update(workspaceId, req.params.id, req.body);
      if (!agent) throw new NotFoundError('Agent not found');
      return agent;
    },
  );

  app.delete('/agents/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const result = await service.delete(workspaceId, req.params.id);
    if (!result.deleted) throw new NotFoundError('Agent not found');
    // `count` is optional (REQ-41): no `schema.response` is declared on this
    // route, so nothing strips it, but nothing REQUIRES a caller to read it either.
    return { ok: true, count: result.deletedCases };
  });

  app.get('/agents/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Agent not found');
    return versions;
  });

  app.get(
    '/agents/:id/versions/:version',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
      if (!version) throw new NotFoundError('Agent version not found');
      return version;
    },
  );

  /**
   * Replay an old config version as a NEW version — the eval compare modal's
   * `Promote vN`. Server-owned for the same two reasons `POST /skills/:id/restore`
   * is: the config is read from `agent_versions` under the same row lock a save
   * takes, so a client cannot write forward a stale config it had cached; and the
   * version bump is computed server-side, so two concurrent promotes cannot land
   * on the same version number.
   *
   * The request carries a version NUMBER, never a config, and that is what makes
   * the endpoint safe without an `If-Match` or any other precondition:
   * `agent_versions` rows are append-only — nothing in the repository ever
   * UPDATEs one — so a version number is a permanently stable handle on immutable
   * config. A stale version list cannot cause a wrong write; the worst it can do
   * is fail to offer a newer version.
   *
   * Responds with the updated `Agent`, not the new `AgentVersion`: a restore IS a
   * save, so the client's cache write is identical to `PUT /agents/:id`'s.
   */
  app.post(
    '/agents/:id/restore',
    { schema: { params: IdParams, body: AgentRestoreRequest, response: { 200: Agent } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.restoreVersion(workspaceId, req.params.id, req.body.version);
      if (!result.ok) {
        // 404, not 422: the payload is well-formed, the resource is absent —
        // `platform/errors.ts` draws the line there. It also tells the client to
        // refetch the version list, which is the actual recovery.
        throw new NotFoundError(
          result.reason === 'version_not_found' ? 'Agent version not found' : 'Agent not found',
        );
      }
      return result.agent;
    },
  );

  app.get('/agents/:id/skills', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agent = await service.get(workspaceId, req.params.id);
    if (!agent) throw new NotFoundError('Agent not found');
    return service.skillLinks(req.params.id);
  });

  app.post(
    '/agents/:id/skills',
    { schema: { params: IdParams, body: SetSkillsBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const body = req.body;
      const links =
        body.skill_ids !== undefined
          ? await service.setSkills(workspaceId, req.params.id, body.skill_ids)
          : await service.linkSkill(workspaceId, req.params.id, body.skill_id!, body.order);
      if (!links) throw new NotFoundError('Agent not found');
      return links;
    },
  );

  app.get('/agents/:id/models', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agent = await service.get(workspaceId, req.params.id);
    if (!agent) throw new NotFoundError('Agent not found');
    return service.listModels(agent.provider);
  });

  app.get('/providers/:id/models', { schema: { params: ProviderParams } }, async (req) => {
    await getContext(app.container, req);
    return service.listModels(req.params.id);
  });
}
