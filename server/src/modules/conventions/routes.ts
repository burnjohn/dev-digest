import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getContext } from "../_shared/context.js";
import { NotFoundError, ValidationError } from "../../platform/errors.js";
import { ConventionsService } from "./service.js";

const RepoParams = z.object({ repoId: z.string().uuid() });
const ConventionParams = z.object({
  repoId: z.string().uuid(),
  id: z.string().uuid(),
});

const PatchBody = z.object({
  accepted: z.boolean().optional(),
  rule: z.string().min(1).optional(),
});

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  /** POST /repos/:repoId/conventions/extract — запустити екстракцію */
  app.post(
    "/repos/:repoId/conventions/extract",
    { schema: { params: RepoParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new ConventionsService(app.container);
      const candidates = await service.extract(workspaceId, req.params.repoId);
      reply.status(201);
      return candidates;
    },
  );

  /** GET /repos/:repoId/conventions — список конвенцій */
  app.get(
    "/repos/:repoId/conventions",
    { schema: { params: RepoParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new ConventionsService(app.container);
      return service.list(workspaceId, req.params.repoId);
    },
  );

  /**
   * PATCH /repos/:repoId/conventions/:id
   * { accepted: true }  → прийняти
   * { accepted: false } → відхилити (видалити)
   * { rule: "..." }     → оновити текст правила (inline edit)
   */
  app.patch(
    "/repos/:repoId/conventions/:id",
    { schema: { params: ConventionParams, body: PatchBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new ConventionsService(app.container);
      const { id } = req.params;
      const { accepted, rule } = req.body;

      if (rule !== undefined) {
        const result = await service.updateRule(workspaceId, id, rule);
        if (!result) throw new NotFoundError("Convention not found");
        return result;
      }

      if (accepted === true) {
        const result = await service.accept(workspaceId, id);
        if (!result) throw new NotFoundError("Convention not found");
        return result;
      }

      if (accepted === false) {
        const ok = await service.reject(workspaceId, id);
        if (!ok) throw new NotFoundError("Convention not found");
        return { ok: true };
      }

      throw new ValidationError("Nothing to update: provide accepted or rule");
    },
  );

  /** POST /repos/:repoId/conventions/skill — створити скіл з accepted */
  app.post(
    "/repos/:repoId/conventions/skill",
    { schema: { params: RepoParams, body: CreateSkillBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new ConventionsService(app.container);
      const skill = await service.createSkillFromAccepted(
        workspaceId,
        req.params.repoId,
        req.body.name,
        req.body.description,
      );
      reply.status(201);
      return skill;
    },
  );
}
