import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { RepoInput, type Repo } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { NotFoundError, AppError } from '../../platform/errors.js';

function parseRepoUrl(url: string): { owner: string; name: string } {
  // https://github.com/owner/repo(.git)  |  git@github.com:owner/repo.git
  const httpMatch = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?\/?$/);
  if (!httpMatch?.[1] || !httpMatch[2]) {
    throw new AppError('invalid_repo_url', `Could not parse owner/repo from '${url}'`, 400);
  }
  return { owner: httpMatch[1], name: httpMatch[2] };
}

function toRepoDto(row: typeof t.repos.$inferSelect): Repo {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    owner: row.owner,
    name: row.name,
    full_name: row.fullName,
    default_branch: row.defaultBranch,
    clone_path: row.clonePath,
    last_polled_at: row.lastPolledAt?.toISOString() ?? null,
    created_by: row.createdBy,
  };
}

/**
 * F1 — repos module (§12).
 *   POST   /repos              → add repo (parse URL, persist, enqueue real clone)
 *   GET    /repos              → list repos (workspace-scoped)
 *   POST   /repos/:id/refresh  → re-fetch clone + bump last_polled_at
 *   DELETE /repos/:id          → remove repo
 *
 * The clone runs as a JobRunner job (kind 'clone') — real `git clone` via the
 * GitClient adapter into <cloneDir>/<owner>/<repo>.
 */
export default async function reposRoutes(app: FastifyInstance) {
  const { container } = app;

  // Register the clone job handler once.
  container.jobs.register('clone', async (payload) => {
    const { repoId, owner, name, url } = payload as {
      repoId: string;
      owner: string;
      name: string;
      url: string;
    };
    const { path } = await container.git.clone({ owner, name }, url, { depth: 1 });
    await container.db
      .update(t.repos)
      .set({ clonePath: path, lastPolledAt: new Date() })
      .where(eq(t.repos.id, repoId));
  });

  app.post('/repos', async (req, reply) => {
    const { workspaceId, userId } = await getContext(container, req);
    const { url } = RepoInput.parse(req.body);
    const { owner, name } = parseRepoUrl(url);
    const fullName = `${owner}/${name}`;

    const [existing] = await container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName)));
    if (existing) {
      reply.status(200);
      return toRepoDto(existing);
    }

    const [row] = await container.db
      .insert(t.repos)
      .values({ workspaceId, owner, name, fullName, createdBy: userId })
      .returning();

    // enqueue the real clone (non-blocking)
    await container.jobs.enqueue(workspaceId, 'clone', {
      repoId: row!.id,
      owner,
      name,
      url,
    });

    reply.status(201);
    return toRepoDto(row!);
  });

  app.get('/repos', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const rows = await container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId));
    return rows.map(toRepoDto);
  });

  app.post<{ Params: { id: string } }>('/repos/:id/refresh', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
    if (!repo) throw new NotFoundError('Repo not found');
    await container.jobs.enqueue(workspaceId, 'clone', {
      repoId: repo.id,
      owner: repo.owner,
      name: repo.name,
      url: `https://github.com/${repo.fullName}.git`,
    });
    return { status: 'refreshing' };
  });

  app.delete<{ Params: { id: string } }>('/repos/:id', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const deleted = await container.db
      .delete(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)))
      .returning({ id: t.repos.id });
    if (deleted.length === 0) throw new NotFoundError('Repo not found');
    return { deleted: deleted[0]!.id };
  });
}
