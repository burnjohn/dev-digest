import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  GitHubToken,
  GitHubTokenInput,
  GitHubTokenPatch,
  GitHubTokenTestInput,
  GitHubTokenTestResult,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { GitHubTokenService } from './service.js';

/**
 * GitHub tokens — the user's labelled PATs. Token VALUES never appear in a
 * response; `configured` reports whether one resolves.
 *   GET    /github-tokens       → list with repo_count
 *   POST   /github-tokens       → validate then store
 *   PATCH  /github-tokens/:id   → rename and/or replace the value
 *   DELETE /github-tokens/:id   → delete; affected repos go to the broken state
 *   POST   /github-tokens/test  → ephemeral validation, nothing persisted
 */
export default async function githubTokensRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new GitHubTokenService(app.container);

  app.get(
    '/github-tokens',
    { schema: { response: { 200: z.array(GitHubToken) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId);
    },
  );

  app.post(
    '/github-tokens',
    { schema: { body: GitHubTokenInput, response: { 201: GitHubToken } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const token = await service.create(workspaceId, req.body);
      reply.status(201);
      return token;
    },
  );

  app.patch(
    '/github-tokens/:id',
    { schema: { params: IdParams, body: GitHubTokenPatch, response: { 200: GitHubToken } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.patch(workspaceId, req.params.id, req.body);
    },
  );

  app.delete('/github-tokens/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const { deleted, orphaned } = await service.remove(workspaceId, req.params.id);
    return { deleted, orphaned_repos: orphaned };
  });

  app.post(
    '/github-tokens/test',
    {
      schema: { body: GitHubTokenTestInput, response: { 200: GitHubTokenTestResult } },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => service.test(req.body),
  );
}
