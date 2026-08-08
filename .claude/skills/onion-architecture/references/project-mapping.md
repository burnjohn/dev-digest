# DevDigest project mapping

Use this as the default feature-local shape, and omit every directory that has no real responsibility:

```text
server/src/modules/<feature>/
  domain/
  application/
    ports/
    use-cases/
  adapters/
    http/
    persistence/
    external/
    jobs/
  index.ts
```

Each non-trivial feature owns its own small onion. The source direction inside it remains `adapters → application → domain`; the usefulness of that boundary matters more than a symmetrical folder tree.

## Repository locations

| Location | Architectural role and boundary |
|---|---|
| `server/src/app.ts` | Primary composition root. Construct concrete adapters, create use cases, and register driving adapters here; do not place request-specific orchestration or business decisions here. |
| `server/src/platform/**` | Process-level outer infrastructure and temporary `Container` support during migration. Application and domain code must not import it or receive the whole container. |
| `server/src/modules/**` | Feature ownership. Give each non-trivial feature its own domain, application, ports, use cases, and adapters as responsibilities emerge. |
| `server/src/vendor/shared/**` | Canonical cross-package Zod wire contracts exposed as `@devdigest/shared`. Parse and map these DTOs at adapter boundaries; do not use them as domain entities. Follow the repository's coordinated shared-contract workflow when adding a contract. |
| `reviewer-core` | Inner review engine. Its injected `LLMProvider` is the model secondary port. Keep Fastify, databases, GitHub, filesystems, and concrete vendor SDKs out; server-side adapters implement or wrap the required ports. |

## Adapter placement

Driving adapters invoke application use cases:

- Fastify HTTP routes and plugins;
- SSE formatting and connection lifecycle;
- schedulers and pollers;
- queue consumers, event subscribers, and background-job entrypoints.

Driven adapters implement capabilities requested by inner ports:

- Drizzle and PostgreSQL persistence;
- Octokit and other GitHub integrations;
- OpenAI and Anthropic clients;
- `simple-git`;
- ast-grep;
- ripgrep and the code index;
- filesystem access;
- clocks, queues, and publishers.

External and persistence implementation details stay in their respective adapter directories. Jobs own retry and process lifecycle mechanics, not business policy. HTTP owns transport validation and serialization, not domain transitions.

## Public and cross-feature boundaries

Treat `server/src/modules/<feature>/index.ts` as an intentional public surface. Export deliberate feature contracts and callable use cases only; do not turn it into a barrel that exposes private HTTP, persistence, external, or job adapters.

Cross-feature collaboration uses another feature's public use case or a deliberate public application/domain contract. One feature must not import another feature's persistence, HTTP, external, or job adapter. If two features need the same outer technology, each depends on an inner capability and composition supplies the appropriate implementation; neither reaches through the other's adapter.

The same rule applies across package boundaries: drive `reviewer-core` through its public engine contracts and supply its ports from server-side composition. Do not move Fastify, database access, GitHub clients, filesystem tools, or concrete LLM SDKs into the core for convenience.
