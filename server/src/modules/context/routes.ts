import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ContextAttachRequest,
  ContextAttachResponse,
  ContextDocument,
  ContextDocumentList,
  ContextPreviewResponse,
  ContextUploadRequest,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { ContextService } from './service.js';

/**
 * `context` module — SPEC-01 (Project Context). Shaped after
 * `modules/blast/routes.ts` (the newest route shape): `withTypeProvider`,
 * an explicit `Deps`, one service call per handler, declared
 * `schema.response` so a Drizzle row can never reach the wire.
 *
 * Endpoint set fixed by T6's already-shipped client data layer (this
 * plan's T7 integrator notes) — do not diverge from these paths:
 *
 *   GET  /repos/:repoId/context               → ContextDocumentList
 *   GET  /repos/:repoId/context/preview       → ContextPreviewResponse
 *   POST /repos/:repoId/context/upload        → ContextDocument (201)
 *   GET  /agents/:id/context?repo_id=…        → ContextAttachResponse
 *   POST /agents/:id/context                  → ContextAttachResponse (replace-set)
 *   GET  /skills/:id/context?repo_id=…        → ContextAttachResponse
 *   POST /skills/:id/context                  → ContextAttachResponse (replace-set)
 *
 * `repo_id` is validated `.uuid()` throughout (params, querystring, and
 * `ContextAttachRequest.repo_id` from T1) — `repos.id` really is a Postgres
 * `uuid` column, and every other `/:id`-style route in this codebase already
 * validates that shape at the edge (`_shared/schemas.ts::IdParams`), so this
 * keeps the convention rather than relaxing it (T7 integrator note #4).
 */

const RepoContextParams = z.object({ repoId: z.string().uuid() });
const PreviewQuerystring = z.object({ path: z.string().min(1) });
const OwnerContextQuerystring = z.object({ repo_id: z.string().uuid() });

export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ContextService({
    db: app.container.db,
    config: app.container.config,
    git: app.container.git,
  });

  // ---- Repo-scoped discovery, preview, upload ----------------------------

  app.get(
    '/repos/:repoId/context',
    { schema: { params: RepoContextParams, response: { 200: ContextDocumentList } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.listForRepo(workspaceId, req.params.repoId);
      if (!result) throw new NotFoundError('Repository not found');
      return result;
    },
  );

  app.get(
    '/repos/:repoId/context/preview',
    {
      schema: {
        params: RepoContextParams,
        querystring: PreviewQuerystring,
        response: { 200: ContextPreviewResponse },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const outcome = await service.previewDocument(workspaceId, req.params.repoId, req.query.path);
      if (outcome.ok) return outcome.doc;
      if (outcome.reason === 'repo_not_found') throw new NotFoundError('Repository not found');
      if (outcome.reason === 'escaped') {
        throw new ValidationError('Path is outside the allowed directories', { path: req.query.path });
      }
      throw new NotFoundError('Document not found');
    },
  );

  app.post(
    '/repos/:repoId/context/upload',
    {
      schema: {
        params: RepoContextParams,
        body: ContextUploadRequest,
        response: { 201: ContextDocument },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const doc = await service.uploadDocument(
        workspaceId,
        req.params.repoId,
        req.body.filename,
        req.body.content,
      );
      reply.status(201);
      return doc;
    },
  );

  // ---- Owner attachments (agent / skill) — the replace-set write --------

  app.get(
    '/agents/:id/context',
    {
      schema: {
        params: IdParams,
        querystring: OwnerContextQuerystring,
        response: { 200: ContextAttachResponse },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.getAttachments(
        { kind: 'agent', id: req.params.id },
        workspaceId,
        req.query.repo_id,
      );
      if (!result) throw new NotFoundError('Agent not found');
      return result;
    },
  );

  app.post(
    '/agents/:id/context',
    { schema: { params: IdParams, body: ContextAttachRequest, response: { 200: ContextAttachResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setAttachments(
        { kind: 'agent', id: req.params.id },
        workspaceId,
        req.body.repo_id,
        req.body.paths,
      );
    },
  );

  app.get(
    '/skills/:id/context',
    {
      schema: {
        params: IdParams,
        querystring: OwnerContextQuerystring,
        response: { 200: ContextAttachResponse },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.getAttachments(
        { kind: 'skill', id: req.params.id },
        workspaceId,
        req.query.repo_id,
      );
      if (!result) throw new NotFoundError('Skill not found');
      return result;
    },
  );

  app.post(
    '/skills/:id/context',
    { schema: { params: IdParams, body: ContextAttachRequest, response: { 200: ContextAttachResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setAttachments(
        { kind: 'skill', id: req.params.id },
        workspaceId,
        req.body.repo_id,
        req.body.paths,
      );
    },
  );
}
