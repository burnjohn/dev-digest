import type { FastifyInstance } from 'fastify';
import { PluginExportRequest, PluginImportRequest } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { PluginsService } from './service.js';

/**
 * A6 — plugins module (§12, owner A6).
 *
 *   POST /plugins/export  → bundle agents + skills + eval cases + conventions
 *                           into a `.devdigest-plugin/v1` JSON document
 *   POST /plugins/import  → restore a bundle (merge mode) → recreate items,
 *                           persist an `installed_plugins` row
 *   GET  /plugins         → list installed plugins for the workspace
 *
 * Round-trip (export → import into a fresh workspace) restores agent config and
 * agent→skill links (linked by name within the bundle).
 */
export default async function pluginsRoutes(app: FastifyInstance) {
  const { container } = app;
  const service = new PluginsService(container);

  app.post('/plugins/export', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = PluginExportRequest.parse(req.body ?? {});
    return service.export(workspaceId, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.agent_ids !== undefined ? { agentIds: body.agent_ids } : {}),
    });
  });

  app.post('/plugins/import', async (req) => {
    const { workspaceId } = await getContext(container, req);
    const body = PluginImportRequest.parse(req.body);
    return service.import(workspaceId, body.bundle, body.mode ?? 'merge');
  });

  app.get('/plugins', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listInstalled(workspaceId);
  });
}
