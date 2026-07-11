---
name: backend-testing
description: >-
  Backend testing craft for DevDigest's Vitest suites — server/ (Fastify + Drizzle/
  Postgres) and reviewer-core/ (pure engine). Use when writing or reviewing backend tests:
  hermetic unit tests with the repo mocks, Fastify route tests via app.inject(), Postgres
  integration tests with the .it.test.ts suffix + testcontainers, and the test-quality rules.
  This is the backend counterpart to react-testing-library and the single source of truth for
  backend test rules — referenced by name, not inlined in agents. Complements root TESTING.md.
---

# backend-testing — Vitest for server/ and reviewer-core/

Philosophy (see root `TESTING.md`): **typological, not exhaustive** — cover the *kinds* of
things that break at each seam (routes, adapters, contracts, the review pipeline), one happy
path plus the edge that matters, and skip the rest. If a test wouldn't catch a regression we
care about, don't write it.

## Suite shape

- **server unit** (hermetic, no Docker) — adapters, prompt assembly, grounding, repo-intel
  ranking/indexing, pricing, route smoke. Runner: `pnpm test` (or
  `pnpm exec vitest run --exclude '**/*.it.test.ts'` for the unit lane only).
- **server integration** — files end in **`.it.test.ts`**; each starts a real Postgres
  (pgvector) via testcontainers, builds the Fastify app, migrates + seeds, and drives routes
  end-to-end. They **self-skip when Docker is absent** — note the skip, don't treat it as a
  failure. A DB-backed test that imports `test/helpers/pg.ts` **must** use the `.it.test.ts`
  suffix (the unit lane excludes that glob).
- **reviewer-core** (pure engine, no Docker, `npm test`) — `toReview` selection, prompt
  construction, and a `run` with a stubbed model → grounded findings. No DB / GitHub / FS.

## Boundaries & mocks

- **Mock only the outside world at the adapter boundary** — LLMs, GitHub, git. Reach for
  `server/src/adapters/mocks.ts` (`MockLLMProvider`, `MockGitClient`) so unit tests are
  hermetic and key-free. **Never mock our own** use-cases, repositories, or utilities.
- **Fastify routes** are exercised with **`app.inject()`**, not a live socket/port.
- **One real integration per data-backed workflow** against real Postgres — because the bugs
  there live in SQL, migrations, and wiring, which a mock DB would hide.

## Test-quality rules (apply always)

1. **At least one real assertion per test.** `console.log` is never a substitute for `expect`.
2. **Assert observable behavior at seams, not internals** — not private state or mock
   call-counts, unless the call *is* the behavior (e.g. "the LLM provider was invoked once").
3. **Would this pass against a plausibly buggy implementation?** If yes, strengthen it.
4. **Vitest APIs only** — `vi.fn()`, `vi.mock()`, `vi.spyOn()`; never `jest.*`. Restore mocks
   between tests.
5. **Structure:** Arrange → Act → Assert; one concept per test; name by behavior ("returns 404
   when the review id is unknown"), not "should work". Cover happy path, boundaries, empty/null,
   and error paths.
6. **Never edit source to make a test pass.** A test that can only pass by changing source is a
   surfaced bug — report it (expected vs actual, `path:line`), don't paper over it.

## Package managers

`server/` uses **pnpm**; `reviewer-core/` uses **npm**. Run from the module directory.
