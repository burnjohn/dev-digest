import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillName, SkillSource, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { MAX_BODY_BYTES, MAX_UPLOAD_BYTES } from './constants.js';
import { SkillsService } from './service.js';

/**
 * Skills module — the workspace's reusable blocks of reviewer instructions.
 *
 *   GET    /skills                        → list + rail stats (SkillWithStats[])
 *   GET    /skills/:id                    → one skill
 *   POST   /skills                        → create                       → 201
 *   PUT    /skills/:id                    → update (body change → version bump)
 *   DELETE /skills/:id                    → delete (agent_skills / run_skills cascade)
 *   GET    /skills/:id/versions           → archived bodies, newest first
 *   GET    /skills/:id/versions/:version  → one archived body
 *   POST   /skills/:id/restore            → { version } — archive the current body, make that one current
 *   GET    /skills/:id/preview            → the block as injected + token count
 *   GET    /skills/:id/stats              → Stats tab payload
 *   POST   /skills/tokens                 → live editor token counter
 *   POST   /skills/import                 → parse a .md/.zip upload; NOT saved
 *   POST   /skills/import-url             → fetch + parse a URL; NOT saved
 *
 * Static segments (`/skills/tokens`, `/skills/import`, `/skills/import-url`)
 * win over the parametric `/skills/:id` in Fastify's router, so no ordering
 * trick is needed here.
 */

/** `/skills/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/** Bodies are prompt text, not files — the byte cap is re-checked in the
 *  service (this one counts characters, which is close enough at the edge). */
const SkillBody = z.string().min(1).max(MAX_BODY_BYTES);

const CreateSkillBody = z.object({
  name: SkillName,
  description: z.string().default(''),
  type: SkillType,
  source: SkillSource.optional(),
  body: SkillBody,
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: SkillName.optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: SkillBody.optional(),
  enabled: z.boolean().optional(),
});

const TokensBody = z.object({ body: SkillBody });

const RestoreBody = z.object({ version: z.number().int().positive() });

/**
 * Import takes a JSON body with base64, NOT multipart. Every route in this
 * server declares zod `params`/`body`; a multipart stream cannot be validated
 * the same way, so `@fastify/multipart` would carve an exception into the one
 * convention every other route follows. Base64 costs ~33% on a payload capped
 * at 1 MB and buys back a fully typed route.
 */
const ImportBody = z.object({
  filename: z.string().min(1).max(512),
  // base64 of at most MAX_UPLOAD_BYTES raw bytes; the decoded size is the real
  // guard (see SkillsService.parseImport), this just bounds the string early.
  content_b64: z.string().min(1).max(Math.ceil(MAX_UPLOAD_BYTES * 1.4)),
});

const ImportUrlBody = z.object({ url: z.string().min(1).max(2048) });

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(
    app.container.skillsRepo,
    app.container.tokenizer,
    app.container.projectContextService,
    app.container.evalRepo,
  );

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.create(workspaceId, {
      name: body.name,
      description: body.description,
      type: body.type,
      body: body.body,
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    });
    reply.status(201);
    return skill;
  });

  /** Live counter for the body editor — the SAME tokenizer as the run executor. */
  app.post('/skills/tokens', { schema: { body: TokensBody } }, async (req) => {
    await getContext(app.container, req);
    return service.countTokens(req.body.body);
  });

  /** Parse-only. Returns a preview; the client confirms via POST /skills. */
  app.post('/skills/import', { schema: { body: ImportBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.parseImport(workspaceId, req.body.filename, req.body.content_b64);
  });

  /** Parse-only, same contract as /skills/import: fetch a URL server-side,
   *  parse it, return a preview. The client confirms via POST /skills. */
  app.post('/skills/import-url', { schema: { body: ImportUrlBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.parseImportFromUrl(workspaceId, req.body.url);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
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

  /** Restore an archived body: same version-bump/archive rule as PUT with a
   *  body change, just sourced from history instead of the editor. 404s both
   *  for an unknown skill and for an unknown/current (never-archived) version —
   *  `service.restoreVersion` can't tell those apart, and callers don't need it to. */
  app.post(
    '/skills/:id/restore',
    { schema: { params: IdParams, body: RestoreBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restoreVersion(workspaceId, req.params.id, req.body.version);
      if (!skill) throw new NotFoundError('Skill version not found');
      return skill;
    },
  );

  app.get('/skills/:id/preview', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const preview = await service.preview(workspaceId, req.params.id);
    if (!preview) throw new NotFoundError('Skill not found');
    return preview;
  });

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const stats = await service.stats(workspaceId, req.params.id);
    if (!stats) throw new NotFoundError('Skill not found');
    return stats;
  });
}
