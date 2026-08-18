import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  Skill,
  SkillListItem,
  SkillRestoreRequest,
  SkillSource,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import {
  DEFAULT_SKILL_SOURCE,
  DEFAULT_SKILL_TYPE,
  MAX_SKILL_BODY_CHARS,
  MAX_VERSION_MESSAGE_CHARS,
} from './constants.js';

/**
 * A1 — skills module.
 *   GET    /skills               → list (workspace-scoped) + used_by counts
 *   GET    /skills/:id           → one skill
 *   POST   /skills               → create (v1 snapshot written with it)
 *   PUT    /skills/:id           → update; a body change bumps the version
 *   DELETE /skills/:id           → delete (cascades to versions + agent links)
 *   GET    /skills/:id/versions  → body history, newest first
 *   POST   /skills/:id/restore   → write an old version's body forward as a new one
 *
 * Every route declares `schema.response`. Nothing else in the repo does yet, and
 * it is not ceremony: the DTO gate is what keeps `workspace_id` off the wire even
 * if a helper starts spreading a raw row. New module, existing contract — the
 * precedent is cheapest to set here.
 */

const CreateSkillBody = z.object({
  // Optional: derived from the body's first `# H1` when absent (see the service).
  name: z.string().min(1).optional(),
  description: z.string().default(''),
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
  // Route-local, not a shared contract: this is one field on an existing body,
  // and promoting `UpdateSkillBody` would drag `MAX_SKILL_BODY_CHARS` — a server
  // module constant with a cost-control docblock — across the ring boundary.
  // Named `version_message` because a bare `message` would read as a field of
  // the skill rather than of the snapshot this save writes.
  version_message: z.string().max(MAX_VERSION_MESSAGE_CHARS).optional(),
});

const OkResponse = z.object({ ok: z.boolean() });

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  // Built once in the plugin body, not per handler. `Container` structurally
  // satisfies `SkillsServiceDeps` (it exposes `db`), so no container change.
  const service = new SkillsService(app.container);

  app.get(
    '/skills',
    { schema: { response: { 200: z.array(SkillListItem) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId);
    },
  );

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
    { schema: { body: CreateSkillBody, response: { 201: Skill } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const body = req.body;
      const skill = await service.create(workspaceId, {
        description: body.description,
        type: body.type,
        source: body.source,
        body: body.body,
        enabled: body.enabled,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.evidence_files !== undefined ? { evidence_files: body.evidence_files } : {}),
      });
      reply.status(201);
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

  app.get(
    '/skills/:id/versions',
    { schema: { params: IdParams, response: { 200: z.array(SkillVersion) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const versions = await service.listVersions(workspaceId, req.params.id);
      if (!versions) throw new NotFoundError('Skill not found');
      return versions;
    },
  );

  /**
   * Restore an old body as a NEW version. Server-owned on purpose, on two counts:
   *
   *  - the audit note is composed from a server constant, so version history
   *    cannot change language with the reader's UI locale;
   *  - the body is read from `skill_versions` under the same `FOR UPDATE` lock a
   *    save takes, so a client cannot write forward a stale body it had cached.
   *
   * The request carries a version NUMBER, never a body, and that is what makes
   * the endpoint safe without an `If-Match` or any other precondition:
   * `skill_versions` rows are append-only — nothing in the repository ever
   * UPDATEs one — so a version number is a permanently stable handle on
   * immutable text. A stale version list cannot cause a wrong write; the worst
   * it can do is fail to offer a newer version.
   *
   * Responds with the updated `Skill`, not the new `SkillVersion`: a restore IS
   * a save, so the client's cache write is identical to `PUT /skills/:id`'s.
   */
  app.post(
    '/skills/:id/restore',
    { schema: { params: IdParams, body: SkillRestoreRequest, response: { 200: Skill } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.restoreVersion(workspaceId, req.params.id, req.body.version);
      if (!result.ok) {
        // 404, not 422: the payload is well-formed, the resource is absent —
        // `platform/errors.ts` draws the line there. It also tells the client to
        // refetch the version list, which is the actual recovery.
        throw new NotFoundError(
          result.reason === 'version_not_found' ? 'Skill version not found' : 'Skill not found',
        );
      }
      return result.skill;
    },
  );
}
