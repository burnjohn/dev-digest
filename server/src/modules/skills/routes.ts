import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Skill, SkillSource, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import { DEFAULT_SKILL_SOURCE, DEFAULT_SKILL_TYPE, MAX_SKILL_BODY_CHARS } from './constants.js';

/**
 * A1 — skills module.
 *   GET    /skills               → list envelope (workspace-scoped) + agent_count
 *   GET    /skills/:id           → one skill
 *   POST   /skills               → create (v1 snapshot written with it)
 *   PUT    /skills/:id           → update; a body change bumps the version
 *   DELETE /skills/:id           → delete (cascades to versions + agent links)
 *   GET    /skills/:id/history   → body history, newest first
 */

const CreateSkillBody = z.object({
  // A skill without a name is not useful in the picker — require it up front.
  name: z.string().min(1),
  description: z.string().min(1),
  type: SkillType.default(DEFAULT_SKILL_TYPE),
  source: SkillSource.default(DEFAULT_SKILL_SOURCE),
  body: z.string().min(1).max(MAX_SKILL_BODY_CHARS),
  enabled: z.boolean().default(true),
  evidence_files: z.array(z.string()).optional(),
});

/** Same shape, every field optional — a metadata-only patch must not touch the body. */
const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).max(MAX_SKILL_BODY_CHARS).optional(),
  enabled: z.boolean().optional(),
  evidence_files: z.array(z.string()).optional(),
});

const OkResponse = z.object({ ok: z.boolean() });

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  // Built once in the plugin body, not per handler. `Container` structurally
  // satisfies `SkillsServiceDeps` (it exposes `db`), so no container change.
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const items = await service.list(workspaceId);
    // Envelope so we can hang pagination off it later without another reshape.
    return { items, total: items.length };
  });

  app.get(
    '/skills/:id',
    { schema: { params: IdParams, response: { 200: Skill } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.get(workspaceId, req.params.id);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.post(
    '/skills',
    { schema: { body: CreateSkillBody, response: { 200: Skill } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const body = req.body;
      const skill = await service.create(workspaceId, {
        name: body.name,
        description: body.description,
        type: body.type,
        source: body.source,
        body: body.body,
        enabled: body.enabled,
        ...(body.evidence_files !== undefined ? { evidence_files: body.evidence_files } : {}),
      });
      return skill;
    },
  );

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody, response: { 200: Skill } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, req.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete(
    '/skills/:id',
    { schema: { params: IdParams, response: { 200: OkResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const ok = await service.delete(workspaceId, req.params.id);
      if (!ok) throw new NotFoundError('Skill not found');
      return { ok: true };
    },
  );

  app.get('/skills/:id/history', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });
}
