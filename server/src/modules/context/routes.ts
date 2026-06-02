import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SpecFile, IndexStatus } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { ValidationError } from '../../platform/errors.js';
import { ContextService } from './service.js';

/**
 * Project Context module (F1 scaffolding → DEEPENED by A3, §7.8/§12).
 *
 *   GET  /repos/:id/context           → list spec files (path + size + mtime)
 *   GET  /repos/:id/context/status    → live IndexStatus (% progress, coverage)
 *   POST /repos/:id/context/reindex   → enqueue spec indexing → IndexStatus
 *   GET  /context/:path?repoId&mode   → read one spec (preview/edit)
 *   PUT  /context/:path  {repoId,content} → write one spec → SpecFile
 *
 * Specs indexed into code_chunks(source='spec') automatically flow into the
 * reviewer/brief prompts (both `collectSpecs` over source='spec').
 */
const PutBody = z.object({ repoId: z.string().min(1), content: z.string() });

export default async function contextRoutes(app: FastifyInstance) {
  const { container } = app;
  const service = new ContextService(container);
  ContextService.registerJob(container);

  app.get<{ Params: { id: string } }>('/repos/:id/context', async (req): Promise<SpecFile[]> => {
    const { workspaceId } = await getContext(container, req);
    const repo = await service.loadRepo(workspaceId, req.params.id);
    return service.listSpecs(repo.clonePath);
  });

  app.get<{ Params: { id: string } }>(
    '/repos/:id/context/status',
    async (req): Promise<IndexStatus> => {
      const { workspaceId } = await getContext(container, req);
      return service.status(workspaceId, req.params.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/repos/:id/context/reindex',
    async (req): Promise<IndexStatus> => {
      const { workspaceId } = await getContext(container, req);
      return service.reindex(workspaceId, req.params.id);
    },
  );

  // Single-spec read/write. `:path` is a wildcard so it can contain slashes
  // (e.g. .devdigest/specs/architecture.md). repoId comes from query/body since
  // the spec path alone does not identify the repo.
  app.get<{ Params: { '*': string }; Querystring: { repoId?: string } }>(
    '/context/*',
    async (req): Promise<SpecFile> => {
      const { workspaceId } = await getContext(container, req);
      const specPath = req.params['*'];
      const repoId = req.query.repoId;
      if (!repoId) throw new ValidationError('`repoId` query param is required');
      return service.readSpec(workspaceId, repoId, specPath);
    },
  );

  app.put<{ Params: { '*': string } }>('/context/*', async (req): Promise<SpecFile> => {
    const { workspaceId } = await getContext(container, req);
    const specPath = req.params['*'];
    const parsed = PutBody.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid body', parsed.error.format());
    return service.writeSpec(workspaceId, parsed.data.repoId, specPath, parsed.data.content);
  });
}
