# server/ module pattern: routes → service → repository

This is the concrete Onion Architecture shape already used by `server/src/modules/
{repos,agents,repo-intel}/` and documented (as a convention, not enforced) in
`server/README.md`'s request/DI-flow diagram and `server/CLAUDE.md`.

## The three files

**`routes.ts` — infrastructure/transport ring.** Declares a Zod schema for
params/body/response, resolves request context, calls the service, maps the result
to an HTTP status. No business logic, no Drizzle imports.

```ts
// server/src/modules/repos/routes.ts (shape)
export default async function reposRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new RepoService(app.container);

  app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const { repo, created } = await service.add(workspaceId, userId, req.body.url);
    reply.status(created ? 201 : 200);
    return repo;
  });
}
```

The doc-comment on this file states the rule directly: *"Transport layer only:
parses requests, maps status codes, and delegates all business logic to
RepoService."*

**`service.ts` — application ring.** Constructed with `app.container` (the DI
composition root), holds the business rules and orchestration, calls repositories
and adapters through the container rather than constructing them itself.

**`repository.ts` (or `repository/*.repo.ts`) — infrastructure ring, DB side.** The
*only* place in the module that imports `db/schema.ts` and issues Drizzle queries.

```ts
// server/src/modules/repos/repository.ts (shape)
export class RepoRepository {
  constructor(private db: Db) {}
  async findByFullName(workspaceId: string, fullName: string) { /* Drizzle query */ }
}
```

## Cross-module access goes through the container

`platform/container.ts` exposes shared repositories as lazy getters
(`container.agentsRepo`, `container.reviewRepo`, …) specifically so that one module
never reaches into another module's folder to run its own queries. If `reviews/`
needs review data owned by `agents/`, it calls `container.agentsRepo`, not
`import { AgentRepository } from '../agents/repository'` plus a new instance.

## `repo-intel/` — the facade pattern, one level up

`repo-intel/` is the largest module and shows a second, complementary pattern: its
`service.ts` (`RepoIntelService`) is the **only** sanctioned entry point for every
downstream consumer — `getRepoMap()`, `getBlastRadius()`, `getFileRank()`,
`getCallerSignatures()`, `getUnresolvedReferences()`, `getConventionSamples()`. No
other module reaches into `repo-intel/pipeline/*` directly. Its own README states
this explicitly: *"Everything downstream reads through one facade... so consumers
never touch the pipeline internals."* It also degrades gracefully (returns
empty/partial data) rather than throwing when a repo isn't indexed yet — a useful
pattern for any service sitting at a module boundary that other modules depend on.

## Splitting a repository into sub-repositories

`reviews/` splits its data access into `repository/{pull,review,run}.repo.ts` files,
with `repository.ts` acting as a facade over them. This is fine — and often better
than one huge repository file — **as long as the facade delegates**. The known
counter-example already flagged in `server/INSIGHTS.md` (2026-08-04): `reviews/
repository.ts` re-declares each function's param types inline instead of importing
them from the `.repo.ts` file that owns them, which lets the two drift out of sync.
When you split a repository this way, the facade methods should be thin
pass-throughs (`return pullRepo.findById(id)`), not re-implementations.

## Reading

- [Modular Fastify, Part 1](https://www.james-gardner.dev/posts/modular-fastify-part-1/) and [fastify-example-todo services/README.md](https://github.com/fastify/fastify-example-todo/blob/main/services/README.md) — Fastify's own encapsulated-plugin-as-module convention, the same shape as `server/src/modules/<name>/`
- [Atomic Repositories in Clean Architecture and TypeScript](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/) — repositories defined as domain-facing interfaces, implemented in infrastructure
- [Drizzle ORM Best Practices: Principles, Patterns, and Real-World Case Studies](https://www.paulserban.eu/blog/post/drizzle-orm-best-practices-principles-patterns-and-real-world-case-studies/) — isolating Drizzle behind a repository layer
