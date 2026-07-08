import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillType, SkillSource, ContextDocAttachment, SkillEvalCaseCreateInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SkillsService } from './service.js';
import { SkillEvalService } from './eval-service.js';

const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

const EvalCaseParams = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
});

const CreateSkillBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().default(''),
  type: SkillType,
  source: SkillSource.default('manual'),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().optional(),
  enabled: z.boolean().optional(),
});

const ImportBody = z.object({
  name: z.string().default(''),
  filename: z.string().min(1),
  content_base64: z.string().min(1).max(700_000),
});

const ConfirmImportBody = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  type: SkillType,
  body: z.string().min(1),
  source: SkillSource,
  enabled: z.boolean().optional(),
});

/**
 * A1 — skills module.
 *   GET    /skills                       → list (workspace-scoped)
 *   POST   /skills                       → create
 *   GET    /skills/:id                   → get
 *   PATCH  /skills/:id                   → update / toggle
 *   DELETE /skills/:id                   → delete
 *   POST   /skills/import                → parse file → ImportPreview (no DB write)
 *   POST   /skills/import/confirm        → save confirmed import to DB
 *   GET    /skills/:id/versions          → version history
 *   POST   /skills/:id/versions/:version/restore → restore body from past version
 *   GET    /skills/:id/stats             → usage stats
 *   GET    /skills/:id/evals             → enriched eval-case list (SkillEvalCaseListResponse, via SkillEvalService.listCases)
 *   POST   /skills/:id/evals             → create eval case
 *   DELETE /skills/:id/evals/:caseId     → delete eval case
 *   GET    /skills/:id/context-docs      → attached context documents (ordered)
 *   POST   /skills/:id/context-docs      → set/reorder attached context documents (full replace)
 */
export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);
  const evalService = new SkillEvalService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.create(workspaceId, {
      name: req.body.name,
      description: req.body.description,
      type: req.body.type,
      source: req.body.source,
      body: req.body.body,
      enabled: req.body.enabled,
    });
    reply.status(201);
    return skill;
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.get(workspaceId, req.params.id);
  });

  app.patch(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.update(workspaceId, req.params.id, req.body);
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.delete(workspaceId, req.params.id);
    return { ok: true };
  });

  // ---- Import (parse only — no DB write yet) --------------------------------

  app.post(
    '/skills/import',
    { config: { rawBody: false }, schema: { body: ImportBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      void workspaceId;
      return service.importPreview(req.body.name, req.body.filename, req.body.content_base64);
    },
  );

  // ---- Import confirm (save preview to DB) ---------------------------------

  app.post(
    '/skills/import/confirm',
    { schema: { body: ConfirmImportBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.create(workspaceId, {
        name: req.body.name,
        description: req.body.description,
        type: req.body.type,
        source: req.body.source,
        body: req.body.body,
        enabled: req.body.enabled ?? false,
      });
      reply.status(201);
      return skill;
    },
  );

  // ---- Versions -----------------------------------------------------------

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.versions(workspaceId, req.params.id);
  });

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.restoreVersion(workspaceId, req.params.id, req.params.version);
    },
  );

  // ---- Stats --------------------------------------------------------------

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.stats(workspaceId, req.params.id);
  });

  // ---- Eval cases (existing eval_cases table, owner_kind='skill') ----------

  // Enriched list (SkillEvalCaseListResponse): delegates to SkillEvalService,
  // which joins each case with its most recent skill-eval run outcome
  // (flat last_run_status/last_run_summary/last_host_agent_id) — the shape
  // the client's rewritten EvalsTab (Steps 7/8) needs. Only SkillsService's
  // basic POST/DELETE stay on the plain SkillsService path; this GET no
  // longer calls service.listEvalCases.
  app.get('/skills/:id/evals', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const cases = await evalService.listCases(workspaceId, req.params.id);
    return { cases };
  });

  // Create routes through SkillEvalService.createCaseManual so the manual
  // create path gets the SAME AC-2 (practices OR grounding non-empty) / AC-3
  // (non-empty fixture) validation + input_meta.source:'manual' default that
  // the PATCH edit path already enforces. The body is the shared
  // SkillEvalCaseCreateInput; the skill id comes from the :id path param (the
  // body's redundant skill_id is ignored by the service).
  app.post(
    '/skills/:id/evals',
    { schema: { params: IdParams, body: SkillEvalCaseCreateInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const evalCase = await evalService.createCaseManual(workspaceId, req.params.id, req.body);
      reply.status(201);
      return evalCase;
    },
  );

  app.delete(
    '/skills/:id/evals/:caseId',
    { schema: { params: EvalCaseParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      void workspaceId;
      await service.deleteEvalCase(workspaceId, req.params.caseId);
      return { ok: true };
    },
  );

  // ---- Context document attachments ----------------------------------------

  app.get('/skills/:id/context-docs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.contextDocLinks(workspaceId, req.params.id);
  });

  app.post(
    '/skills/:id/context-docs',
    { schema: { params: IdParams, body: ContextDocAttachment } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setContextDocs(workspaceId, req.params.id, req.body.document_paths);
    },
  );
}
