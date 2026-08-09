# Architecture source catalog

Source IDs match the canonical full ledger in [React and Next.js frontend architecture practices](../../../../docs/research/react-frontend-best-practices-sources.md). That document retains all 80 source entries, 87 URLs, archived performance material, evidence levels, GitHub blob/commit verification, and the future README transfer manifest.

Use this file as the active architecture index. Prefer official A-level sources for framework/language claims; label C-level structures as optional choices.

## React

| ID | Source |
|---|---|
| R01 | [Thinking in React](https://react.dev/learn/thinking-in-react) |
| R02 | [Keeping Components Pure](https://react.dev/learn/keeping-components-pure) |
| R03 | [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) |
| R04 | [Managing State](https://react.dev/learn/managing-state) |
| R05 | [Extracting State Logic into a Reducer](https://react.dev/learn/extracting-state-logic-into-a-reducer) |
| R06 | [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) |
| R07 | [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) |
| R08 | [Separating Events from Effects](https://react.dev/learn/separating-events-from-effects) |
| R09 | [Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context) |
| R10 | [Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state) |
| R14 | [Common React DOM components](https://react.dev/reference/react-dom/components/common) |
| R15 | [`'use client'` and serializable types](https://react.dev/reference/rsc/use-client#serializable-types) |

## Next.js App Router

| ID | Source |
|---|---|
| N01 | [Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure) |
| N02 | [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) |
| N03 | [Fetching data](https://nextjs.org/docs/app/getting-started/fetching-data) |
| N04 | [Authentication](https://nextjs.org/docs/app/guides/authentication) |
| N05 | [Layouts and pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages), [`useSearchParams`](https://nextjs.org/docs/app/api-reference/functions/use-search-params) |
| N06 | [Error handling](https://nextjs.org/docs/app/getting-started/error-handling) |
| N08 | [CSS](https://nextjs.org/docs/app/getting-started/css) |
| N12 | [Metadata and OG images](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) |
| N13 | [Backend for Frontend](https://nextjs.org/docs/app/guides/backend-for-frontend) |
| N14 | [Next.js 15 Data Security](https://nextjs.org/docs/15/app/guides/data-security) |
| N15 | [Server Actions](https://nextjs.org/docs/app/guides/server-actions) |
| N16 | [Upgrade guide: Next.js 15](https://nextjs.org/docs/app/guides/upgrading/version-15) |
| N17 | [Next.js 15 Route Handlers and Middleware](https://nextjs.org/docs/15/app/getting-started/route-handlers-and-middleware) |
| N18 | [Next.js 15 `layout`](https://nextjs.org/docs/15/app/api-reference/file-conventions/layout) |
| N19 | [`template` file convention](https://nextjs.org/docs/app/api-reference/file-conventions/template) |
| N20 | [Parallel Routes](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes) |
| N21 | [Intercepting Routes](https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes) |
| N22 | [Next.js 15 Caching](https://nextjs.org/docs/15/app/guides/caching) |

## Organization and dependency boundaries

| ID | Source | Authority |
|---|---|---|
| A01 | [Redux Style Guide](https://redux.js.org/style-guide/) | B |
| A02 | [Deriving Data with Selectors](https://redux.js.org/usage/deriving-data-selectors) | B |
| A03 | [Nx: Enforce Module Boundaries](https://nx.dev/docs/features/enforce-module-boundaries) | B |
| A04 | [ESLint `no-restricted-imports`](https://eslint.org/docs/latest/rules/no-restricted-imports) | B |
| A05 | [Feature-Sliced Design: Layers](https://github.com/feature-sliced/documentation/blob/main/src/content/docs/docs/reference/layers.mdx) | C |
| A06 | [Feature-Sliced Design: Public API](https://github.com/feature-sliced/documentation/blob/main/src/content/docs/docs/reference/public-api.mdx) | C |
| A07 | [Bulletproof React: Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) | C |
| A08 | [Bulletproof React: Components and Styling](https://github.com/alan2207/bulletproof-react/blob/master/docs/components-and-styling.md) | C |
| A09 | [Colocation](https://kentcdodds.com/blog/colocation) | C |
| A10 | [AHA Programming](https://kentcdodds.com/blog/aha-progra) | C |
| A11 | [The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) | C |
| A12 | [Atomic Design](https://atomicdesign.bradfrost.com/) | C |

## Server state and runtime contracts

| ID | Source |
|---|---|
| D01 | [TanStack Query: Does this replace client state?](https://tanstack.com/query/latest/docs/framework/react/guides/does-this-replace-client-state) |
| D02 | [TanStack Query: Query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys) |
| D03 | [TanStack Query: Important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults) |
| T01 | [TypeScript Modules](https://www.typescriptlang.org/docs/handbook/2/modules.html), [Modules Reference](https://www.typescriptlang.org/docs/handbook/modules/reference) |
| T02 | [`strict`](https://www.typescriptlang.org/tsconfig/strict), [`noUncheckedIndexedAccess`](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html) |
| T03 | [`satisfies`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html), [`const` assertions](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html) |
| T04 | [`consistent-type-imports`](https://typescript-eslint.io/rules/consistent-type-imports/) |
| T05 | [Zod basics](https://zod.dev/basics) |

## Boundary testing and security

| ID | Source |
|---|---|
| Q01 | [Testing Library guiding principles](https://testing-library.com/docs/guiding-principles/) |
| Q02 | [Testing Library query priority](https://testing-library.com/docs/queries/about/) |
| Q04 | [Playwright best practices](https://playwright.dev/docs/best-practices) |
| Q07 | [Vitest: Testing in practice](https://vitest.dev/guide/learn/testing-in-practice) |
| S01 | [OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html) |
| S02 | [OWASP Content Security Policy](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html) |
| S03 | [OWASP Third Party JavaScript Management](https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.html) |

## Maintenance

- Preserve IDs when transferring sources to a README.
- Revalidate current Next.js docs and the installed version before changing version-sensitive rules.
- Keep A-level facts distinct from C-level architecture options.
- Add every researched source to the canonical full ledger, even when it remains outside active skill scope.
