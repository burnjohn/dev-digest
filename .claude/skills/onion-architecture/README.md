# Onion Architecture Skill

**Version 1.0.0**

## Skill focus

Which of the four rings a piece of `server/src/` backend code belongs in, and which
imports are banned from crossing which boundary — not how to write a Fastify route or a
Drizzle query correctly once you know where it lives.

## What it covers

- The dependency rule (Palermo): coupling always points toward the center.
- The four rings: `domain-model`, `domain-services`, `application-services`,
  `infrastructure`, and what each may/must-not import.
- A mapping from today's flat module files (`routes.ts`, `service.ts`, `repository.ts`,
  `helpers.ts`) onto those rings, so the skill applies without a repo-wide rename.
- Per-tool rules for the stack this repo actually uses: Fastify, Drizzle, Zod, the
  hand-rolled DI container, external SDKs (Octokit, simple-git, LLM SDKs), pino logging,
  Vitest/testcontainers.
- A strangler rule for the four modules that currently bypass layering
  (`pulls`, `polling`, `settings`, `workspace`).
- A review checklist of concrete anti-patterns.

## What it does NOT cover

| Concern | Owning skill |
|---|---|
| Fastify route/plugin/hook mechanics | `fastify-best-practices` |
| Drizzle query shape, schema design, migrations | `drizzle-orm-patterns` |
| Postgres table/index/constraint design | `postgresql-table-design` |
| Zod schema shape, parsing, error handling | `zod` |
| Frontend file placement | `ui-architecture` |
| `reviewer-core/` internals (prompt assembly, grounding gate) | not governed by this skill — referenced as prior art only |

## When to use

- Deciding which folder/layer a new backend file belongs in.
- Wiring a new route to a service and a repository for the first time.
- Reviewing a PR that touches `server/src/modules/` for a layering violation
  (raw Drizzle in a handler, a row type in a service signature, an ungoverned SDK import).
- Introducing a transaction across more than one repository call.

## Sources

Research conducted 2026-08-03.

**Onion / Clean / Hexagonal — primary**
- [The Onion Architecture: part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) — Jeffrey Palermo, 2008. The dependency rule.
- [The Onion Architecture: part 2](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/) — worked example (CodeCampServer).
- [The Onion Architecture: part 3](https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/) — contrast with traditional layered architecture.
- [Onion Architecture: Part 4 – After Four Years](https://jeffreypalermo.com/2013/08/onion-architecture-part-4-after-four-years/) — the four tenets restated after adoption.
- [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture) — Alistair Cockburn, ports & adapters, the sibling pattern this skill borrows vocabulary from.
- [DDD, Hexagonal, Onion, Clean, CQRS… How I put it all together](https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/) — Herberto Graça. Source of the application-services/domain-services split used here.
- [Ports & Adapters Architecture](https://medium.com/the-software-architecture-chronicles/ports-adapters-architecture-d19f2d476eca) — Herberto Graça.
- [Onion Architecture](https://medium.com/the-software-architecture-chronicles/onion-architecture-79529d127f85) — Herberto Graça.

**Practice & criticism**
- [Onion Architecture](https://blog.allegro.tech/2023/02/onion-architecture.html) — Allegro Tech, 2023. Convention-based vs. compiler-enforced modules; transactions belong in the application layer; when onion architecture doesn't fit (simple CRUD, high-throughput proxies with no real domain).
- [Anemic domain model](https://en.wikipedia.org/wiki/Anemic_domain_model) — the failure mode this skill's checklist flags directly.
- [The Functional Core, Imperative Shell Pattern](https://kennethlange.com/functional-core-imperative-shell/) — the same dependency rule stated for a mostly-functional codebase, which is closer to what `server/src` actually is than a classic OO onion.
- [Clean Architecture: UseCase tests](https://www.entropywins.wtf/blog/2018/08/01/clean-architecture-usecase-tests/) — in-memory fakes over use cases instead of a real database; backs the Vitest/testcontainers rule.

**Node / TypeScript reference implementations**
- [Implementing SOLID and the onion architecture in Node.js with TypeScript and InversifyJS](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad) — Remo Jansen.
- [onion-architecture-boilerplate](https://github.com/Melzar/onion-architecture-boilerplate) — reference folder layout for the four rings in Node/TS.
- [ts-functional-core-imperative-shell](https://github.com/kenneth-lange/ts-functional-core-imperative-shell) — a non-class-based TypeScript example of the same dependency rule.

**Tool-specific**
- [Fastify — Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/) and [Plugins Guide](https://fastify.dev/docs/latest/Guides/Plugins-Guide/) — why Fastify plugins are the natural composition mechanism for module boundaries.
- [`@fastify/awilix`](https://github.com/fastify/fastify-awilix) — the ecosystem DI approach this repo's hand-rolled `Container` stands in for; cited for the port-typed-constructor-injection rule, not proposed as a new dependency.
- [Atomic Repositories in Clean Architecture and TypeScript](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/) — Sentry. The optional-transaction-argument pattern behind the Drizzle transaction rule.
- [Repository Pattern in Nest.js with Drizzle ORM](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae).
- [Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) — Alexis King. The DTO-vs-domain-type / parse-at-the-edge rule.
- [Parse, Don't Validate — In a Language That Doesn't Want You To](https://cekrem.github.io/posts/parse-dont-validate-typescript/) — the TypeScript-specific translation of the same idea.

**Enforcement — considered, not adopted in v1.0.0**
- [`eslint-plugin-boundaries`](https://github.com/javierbrea/eslint-plugin-boundaries) — would require adding ESLint to the repo, which currently has none.
- [`dependency-cruiser`](https://github.com/sverweij/dependency-cruiser) — already a `server/` runtime dependency (used today only as a library by the repo indexer at `server/src/adapters/depgraph/index.ts`). Adding a `.dependency-cruiser.cjs` with `forbidden` rules for these rings would cost zero new packages. Left as the natural v1.1 follow-up once the strangler backlog is smaller.

## File structure

```
onion-architecture/
├── SKILL.md      # the rules: dependency rule, four rings, tool rules, strangler backlog, checklist
├── examples.md   # 5 Bad → why → Good cases, drawn from real server/src files
└── README.md     # this file
```

## Changelog

- **1.0.0** (2026-08-03) — initial skill. Scope: `server/` only. Doc-level enforcement
  (no lint tooling added yet). Four classic Palermo rings. Strangler rule for
  `pulls`/`polling`/`settings`/`workspace`.
