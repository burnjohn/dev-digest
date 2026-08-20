# frontend-ui-architecture — sources

All sources behind [SKILL.md](SKILL.md). Compiled 2026-08-04 from five deep-research
passes: folder structure · component splitting · business-logic placement ·
constants/utils/types/config · Next.js App Router architecture. URLs were verified
to resolve at research time; where a canonical site was unreachable from the research
environment (profy.dev), the author's own mirror is listed alongside.

**Version 1.0.0** (2026-08-04) — initial release.

## Official React documentation

- [Thinking in React](https://react.dev/learn/thinking-in-react) — splitting criterion is responsibility, not size; component boundaries mirror the data model; the state-placement algorithm.
- [Keeping Components Pure](https://react.dev/learn/keeping-components-pure) — purity is what makes moving component boundaries safe.
- [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) — the canonical statement that business logic does not belong in `useEffect`.
- [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) — the `use`-prefix rule; hooks for concrete use cases; "some duplication is fine."
- [File Structure — React FAQ (legacy)](https://legacy.reactjs.org/docs/faq-structure.html) — the only official structure guidance: feature vs type grouping, ≤3–4 nesting levels, "don't overthink it."

## Official Next.js / Vercel documentation

- [Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure) — three canonical strategies; private folders `_folder`; route groups `(group)`; colocation safe by design.
- [Data Security guide](https://nextjs.org/docs/app/guides/data-security) — the DAL doctrine: three data-access models (pick one), `server-only`, authz inside every function, minimal DTOs, env access confined to the DAL.
- [How to Think About Security in Next.js — Sebastian Markbåge](https://nextjs.org/blog/security-nextjs-server-components-actions) — origin post of the DAL; Server Action args are hostile; `server-only` as the enforcement mechanism.
- [Backend for Frontend guide](https://nextjs.org/docs/app/guides/backend-for-frontend) — Next as BFF, "not a full backend replacement"; never fetch your own route handlers from RSCs.
- [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — moving client components down the tree; environment poisoning and `server-only`/`client-only`.
- [Vercel Academy — Client-Server Component Boundaries](https://vercel.com/academy/nextjs-foundations/client-server-boundaries) — `'use client'` as a one-way module-graph door.
- [How we optimized package imports in Next.js — Vercel blog](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js) — measured cost of barrel files; `optimizePackageImports` mechanics.

## Reference architectures & templates

- [Bulletproof React — project structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) — unidirectional `shared → features → app`; no cross-feature imports; ESLint enforcement; reversed its own barrel-file advice.
- [Bulletproof React — API layer](https://github.com/alan2207/bulletproof-react/blob/master/docs/api-layer.md) — single client instance; per-endpoint schema + fetcher + query hook.
- [Feature-Sliced Design — overview](https://feature-sliced.design/docs/get-started/overview) — layers/slices/segments; strictly-downward imports.
- [Feature-Sliced Design — layers reference](https://feature-sliced.design/docs/reference/layers) — `shared/lib` as domain-grouped internal libraries, not a grab-bag.
- [Feature-Sliced Design — Next.js App Router guide](https://feature-sliced.design/blog/nextjs-app-router-guide) — `app/` for routing only; leaf-like client components; actions colocated in feature slices.
  - Criticism: [The Drawbacks of Feature-Sliced Design](https://medium.com/@lightxdesign55/the-drawbacks-of-feature-sliced-design-b19206b96cb7) · [FSD review](https://dev.to/algoorgoal/feature-sliced-design-review-22k0)
- [next-forge — structure](https://www.next-forge.com/docs/structure) ([repo](https://github.com/vercel/next-forge)) — apps vs packages; isolated `database` package; per-app typed `env.ts`; Turborepo `boundaries`.
- [create-t3-app — folder structure (App Router)](https://create.t3.gg/en/folder-structure-app) — `src/server` for server-only code; `src/env.js` as the env choke point.
- [shadcn/ui — manual installation](https://ui.shadcn.com/docs/installation/manual) — the `lib/utils` (`cn`) convention.

## Folder structure & colocation

- [React Folder Structure Best Practices — Robin Wieruch](https://www.robinwieruch.de/react-folder-structure/) — 5-step size-matched progression; the one-consumer/two-consumer promotion rule.
- [Delightful React File/Directory Structure — Josh Comeau](https://www.joshwcomeau.com/react/file-structure/) — the documented dissenter: function folders over feature folders; helpers vs utils; single-component `index.ts` forwarders.
- [Screaming Architecture — Johannes Kettmann](https://dev.to/profydev/screaming-architecture-evolution-of-a-react-folder-structure-4g25) (canonical: https://profy.dev/article/react-folder-structure) — evolution to feature folders; thin pages; aliases; kebab-case.
- [How to structure your React projects — Sandro Roth](https://sandroroth.com/blog/project-structure/) — Bulletproof React vs FSD comparison; sides with stricter import rules at scale.
- [Colocation — Kent C. Dodds](https://kentcdodds.com/blog/colocation) — "place code as close to where it's relevant as possible"; premature extraction creates orphaned tribal knowledge.
- [State Colocation — Kent C. Dodds](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster) — the same principle applied to state.
- [Please Stop Using Barrel Files — TkDodo](https://tkdodo.eu/blog/please-stop-using-barrel-files) — −68% modules after removing internal barrels; circular-import source; library entry points only.
- [Lee Robinson — how I structure Next/React apps](https://x.com/leerob/status/1827522336007799123) — route colocation stance; fetch in Server Components.

## Component splitting & composition

- [Presentational and Container Components — Dan Abramov](https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0) — with the 2019 note retiring the pattern in favor of hooks.
- [Before You memo() — Dan Abramov](https://overreacted.io/before-you-memo/) — move state down, lift content up; composition before memoization.
- [When to break up a component — Kent C. Dodds](https://kentcdodds.com/blog/when-to-break-up-a-component-into-multiple-components) — split on pain signals, not preemptively.
- [AHA Programming — Kent C. Dodds](https://kentcdodds.com/blog/aha-programming) — avoid hasty abstractions.
- [The Wrong Abstraction — Sandi Metz](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) — "duplication is far cheaper than the wrong abstraction"; the re-inline remedy.
  - Pushback (minority): [Why I don't buy "duplication is cheaper" — Code with Jason](https://www.codewithjason.com/duplication-cheaper-wrong-abstraction/)
- [Component Composition is great btw — TkDodo](https://tkdodo.eu/blog/component-composition-is-great-btw) — mutually exclusive UI states as early-return branches with a shared Layout.
- [Compound Pattern — patterns.dev](https://www.patterns.dev/react/compound-pattern/) — context-based compound components as the alternative to boolean props.
- [React component code smells — Anton Gunnarsson](https://antongunnarsson.com/react-component-code-smells/) — incompatible props as a split signal; no hard prop-count number.
- [Modularizing React Applications — Juntao Qiu, martinfowler.com](https://www.martinfowler.com/articles/modularizing-react-apps.html) — presentation/domain/data layering; React is the view, not the architecture.
- [Headless Component — Juntao Qiu, martinfowler.com](https://www.martinfowler.com/articles/headless-component.html) — logic-only components (hooks); warning against over-application.
- [TanStack Table — introduction](https://tanstack.com/table/v8/docs/introduction) — the headless-UI philosophy and its trade-offs.

## Business-logic placement

- [Separate API Layers in React Apps — Johannes Kettmann](https://dev.to/jkettmann/separate-api-layers-in-react-apps-6-steps-towards-maintainable-code-4n2) (canonical: https://profy.dev/article/react-architecture-api-layer; series continues with api-client / data-transformations / domain-logic parts) — six steps to an API layer; DTO transformations stay behind it.
- [Does TanStack Query replace client state?](https://tanstack.com/query/v5/docs/framework/react/guides/does-this-replace-client-state) — server state ≠ client state; global stores shrink.
- [React Query as a State Manager — TkDodo](https://tkdodo.eu/blog/react-query-as-a-state-manager) — never copy query data into stores; one custom hook per resource.
- [Redux Style Guide](https://redux.js.org/style-guide/) — logic in reducers; actions as events; selectors for derivation.
- [XState docs — Stately](https://stately.ai/docs/xstate) — state machines as framework-agnostic logic; when they're warranted.
- [React form validation with Zod + RHF — freeCodeCamp](https://www.freecodecamp.org/news/react-form-validation-zod-react-hook-form/) — schema in its own file; `z.infer` as the single source of rules and types.
- [Business vs application logic — Antony Leme](https://antonyleme.medium.com/business-vs-application-logic-how-to-separate-and-test-your-reactjs-code-4291d0c983b1) — pure functions vs hooks; testability as the dividing line.
  - Corroborating: [thoughtbot on custom hooks](https://thoughtbot.com/blog/custom-react-hooks) · [Saeloun on when to use custom hooks](https://blog.saeloun.com/2023/02/23/when-to-use-react-custom-hooks/)
- [Functional Core, Imperative Shell — Kenneth Lange](https://kennethlange.com/functional-core-imperative-shell/) ([demo repo](https://github.com/kenneth-lange/ts-functional-core-imperative-shell)) — origin: [Gary Bernhardt's screencast](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell).
- [Next.js Server Actions security — Makerkit](https://makerkit.dev/blog/tutorials/secure-nextjs-server-actions) — every `'use server'` function is a public endpoint; validation ≠ authorization.
- [Production-Ready Next.js App Router Architecture — Yuki Onishi](https://dev.to/yukionishi1129/building-a-production-ready-nextjs-app-router-architecture-a-complete-playbook-3f3h) — community maximal-layering example (handler/service/repository) with lint enforcement.

## Constants, utils, types & config

- [Objects vs Enums — TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/enums.html#objects-vs-enums) — official: `as const` objects may suffice over enums.
- [Unions vs Enums vs Objects — Cam McHenry](https://camchenry.com/blog/typescript-union-vs-enum-vs-object) — the decision rule; enums "probably never."
  - Minority defense of enums: [TypeScript enums are more than OK](https://dev.to/boscodomingo/typescript-enums-are-more-than-ok-ed6)
- [The utils Black Hole — Ricardo Lüders](https://medium.com/@rluders/the-utils-black-hole-how-to-keep-your-go-code-from-spiraling-into-chaos-4d1151f60ffc) — the junk-drawer criticism and remedies (Go-focused, language-agnostic).
- [The anatomy of React component files — Andrei Pfeiffer](https://andreipfeiffer.dev/blog/2021/react-components-anatomy) — pure functions outside the component body; testability as the driver.
- [Consistent type imports and exports — typescript-eslint](https://typescript-eslint.io/blog/consistent-type-imports-and-exports-why-and-how/) — `import type` hygiene and its lint rules; [`verbatimModuleSyntax`](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html) as the compiler backstop.
- [T3 Env — introduction](https://env.t3.gg/docs/introduction) · [core](https://env.t3.gg/docs/core) — one typed, validated env module; server/client split by prefix.
  - DIY equivalents: [Validating env vars with Zod — Francisco Sousa](https://jfranciscosousa.com/blog/validating-environment-variables-with-zod) · [Env type safety and validation — creatures.sh](https://www.creatures.sh/blog/env-type-safety-and-validation/)

## Changelog

- **1.0.0** (2026-08-04) — initial release: distilled from the five research passes above; scoped to complement `react-best-practices` and `next-best-practices`.
