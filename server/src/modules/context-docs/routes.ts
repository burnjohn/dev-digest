import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ContextDocument,
  ContextDocContent,
  ContextFolders,
  SaveContextDocBody,
  DeleteContextDocBody,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ContextDocsService } from './service.js';

const ContentQuery = z.object({ path: z.string().min(1) });

/**
 * context-docs module — repo-scoped browse/preview/edit/config endpoints (AC-8:
 * no attach/detach control lives here; agent/skill attachment routes live in
 * `agents/routes.ts` / `skills/routes.ts`, Step 5).
 *
 *   GET    /repos/:id/context-docs                → discovered + overlay documents
 *   GET    /repos/:id/context-docs/content?path=… → single doc's effective content
 *   PUT    /repos/:id/context-docs                 → create/edit an overlay (AC-24/27)
 *   DELETE /repos/:id/context-docs                 → delete an overlay (AC-34)
 *   GET    /repos/:id/context-folders             → effective root-folder config
 *   PUT    /repos/:id/context-folders              → set root-folder config
 */
export default async function contextDocsRoutes(appBase: FastifyInstance): Promise<void> {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ContextDocsService(container);

  app.get(
    '/repos/:id/context-docs',
    {
      schema: {
        params: IdParams,
        response: { 200: z.array(ContextDocument) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listDocuments(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/context-docs/content',
    {
      schema: {
        params: IdParams,
        querystring: ContentQuery,
        response: { 200: ContextDocContent },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.getDocumentContent(workspaceId, req.params.id, req.query.path);
      if (!result) throw new NotFoundError('Document not found');
      return result;
    },
  );

  app.put(
    '/repos/:id/context-docs',
    {
      schema: {
        params: IdParams,
        body: SaveContextDocBody,
        response: { 200: ContextDocument },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.saveDocument(workspaceId, req.params.id, req.body.path, req.body.body);
    },
  );

  app.delete(
    '/repos/:id/context-docs',
    {
      schema: {
        params: IdParams,
        body: DeleteContextDocBody,
        response: { 200: z.object({ reverted: z.boolean() }) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.deleteDocument(workspaceId, req.params.id, req.body.path);
    },
  );

  app.get(
    '/repos/:id/context-folders',
    {
      schema: {
        params: IdParams,
        response: { 200: ContextFolders },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const folders = await service.getContextFolders(workspaceId, req.params.id);
      return { folders };
    },
  );

  app.put(
    '/repos/:id/context-folders',
    {
      schema: {
        params: IdParams,
        body: ContextFolders,
        response: { 200: ContextFolders },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      await service.setContextFolders(workspaceId, req.params.id, req.body.folders);
      return { folders: req.body.folders };
    },
  );
}
