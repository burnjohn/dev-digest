import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ConventionCandidate,
  ConventionListResult,
  ConventionPatch,
  ConventionSkillDraft,
  ConventionSkillLink,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { resolveFeatureModel } from '../_shared/feature-models.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * L02 — conventions module.
 *   GET   /repos/:id/conventions              → candidates + last scan stats
 *   POST  /repos/:id/conventions/extract      → run a scan, then the same payload
 *   PATCH /conventions/:id                    → accept / reject / edit one rule
 *   GET   /repos/:id/conventions/skill-draft  → the merged, unsaved skill body
 *   POST  /repos/:id/conventions/skill-link   → stamp skill_id on the shipped rules
 *
 * Every route declares `schema.response`, following the `skills` module: the DTO
 * gate is what keeps `workspace_id` off the wire even if a helper later starts
 * spreading a raw row.
 *
 * Extraction is a SYNCHRONOUS POST. It is one cheap file-selection call plus one
 * per category, and the page's i18n copy only models a `scanning` spinner — no
 * progress stream to feed. Moving it onto `JobRunner` + the SSE `runBus` (the
 * shape reviews use) is the follow-up if real repos prove slow.
 */

const OkResponse = z.object({ ok: z.boolean() });

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  // `Container` structurally satisfies `ConventionsServiceDeps` — it exposes `db`,
  // `repoIntel`, `git` and `llm(id)` — so no container change is needed.
  const service = new ConventionsService(app.container);

  app.get(
    '/repos/:id/conventions',
    { schema: { params: IdParams, response: { 200: ConventionListResult } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.list(workspaceId, req.params.id);
      if (!result) throw new NotFoundError('Repo not found');
      return result;
    },
  );

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams, response: { 200: ConventionListResult } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      // The model is resolved HERE, not in the service: the service takes a
      // concrete {provider, model} so it never has to know about Settings, and a
      // test can drive a scan without seeding a workspace preference.
      const choice = await resolveFeatureModel(app.container, workspaceId, 'conventions');
      const result = await service.extract(workspaceId, req.params.id, choice);
      if (!result) throw new NotFoundError('Repo not found');
      return result;
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: ConventionPatch, response: { 200: ConventionCandidate } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.patch(workspaceId, req.params.id, {
        ...(req.body.rule !== undefined ? { rule: req.body.rule } : {}),
        ...(req.body.evidence_snippet !== undefined
          ? { evidenceSnippet: req.body.evidence_snippet }
          : {}),
        ...(req.body.status !== undefined ? { status: req.body.status } : {}),
      });
      if (!updated) throw new NotFoundError('Convention not found');
      return updated;
    },
  );

  app.get(
    '/repos/:id/conventions/skill-draft',
    { schema: { params: IdParams, response: { 200: ConventionSkillDraft } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const draft = await service.draftSkill(workspaceId, req.params.id);
      if (!draft) throw new NotFoundError('Repo not found');
      return draft;
    },
  );

  app.post(
    '/repos/:id/conventions/skill-link',
    {
      schema: { params: IdParams, body: ConventionSkillLink, response: { 200: OkResponse } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.linkSkill(workspaceId, req.body.ids, req.body.skill_id);
      return { ok: true };
    },
  );
}
