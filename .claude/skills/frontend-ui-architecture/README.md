# frontend-ui-architecture

**Version 1.0.0** · Research date **2026-08-07**

UI and frontend code architecture for React 19 + Next.js 15 App Router +
TypeScript. Structural decisions only — where code belongs, how it is split, how
modules are bounded.

| File | Read when |
|---|---|
| [SKILL.md](SKILL.md) | Always — the rules, with evidence tags |
| [placement.md](placement.md) | Placing a file, naming a folder, auditing a grown directory |
| [boundaries.md](boundaries.md) | Drawing the `"use client"` line, wiring import rules, barrels |
| [dev-digest.md](dev-digest.md) | Applying the rules to this repo's `client/` |
| README.md (this file) | Checking a citation, or arguing about a rule |

**Scope boundaries.** Component and hook *writing* patterns →
`react-best-practices`. Next.js file conventions and data-fetching mechanics →
`next-best-practices`. Backend layering (`server/`, `reviewer-core/`) →
`onion-architecture`.

## Why this skill tags its evidence

Research found that much of the widely-repeated advice about frontend structure
has **no authoritative source** — most notably every numeric threshold for
component size. Rules therefore carry a tag: **[DOC]** (stated in a primary
source, quotable), **[CONV]** (team convention, negotiable), **[SPLIT]**
(credible sources disagree). The tag tells you how hard to push in a review.

This bibliography is what backs those tags.

---

# Sources

Every entry below was fetched and read during research, not just
search-result-listed. Round 1 claims went through 3-vote adversarial
verification; round 2 was a direct single-pass read and is marked as such. Where
a claim did not survive verification, that is noted. Next.js docs were fetched against **v16.3.0**

with `lastUpdated` stamps of 2026-06-17 → 2026-07-29; the organization and
colocation text is byte-identical back to v14, so it applies to Next.js 15
unchanged. The RSC and data-security material has actively expanded since v15 —
re-check before quoting it as v15 behaviour.

Status legend: **[P]** primary/first-party · **[S]** secondary · **[B]** named-author blog
· **⚠** partisan or otherwise qualified source.

---

## Feature-Sliced Design

Docs v2.1. FSD is the only fully-specified, tool-enforceable methodology in the
field — which is why it is over-represented here. It is also a *competitor* to
the other schemes it describes; see the partisanship note under Atomic Design.

| # | Source | URL | Contributes |
|---|--------|-----|-------------|
| 1 | **FSD — Overview** [P] | https://feature-sliced.design/docs/get-started/overview | Canonical definition of FSD as a *methodology* ("a compilation of rules and conventions on organizing code"), the 7 layers with one-line semantics, the "layers strictly below" import rule, the same-layer cross-slice ban, the five conventional segments. |
| 2 | **FSD — Layers reference** [P] | https://feature-sliced.design/docs/reference/layers | Normative layer reference. "7 layers… arranged from most responsibility to least"; adding layers "is not recommended because their semantics are standardized"; **Processes layer is deprecated**; App and Shared are layer-and-slice simultaneously; worked import example. |
| 3 | **FSD — Slices and segments** [P] | https://feature-sliced.design/docs/reference/slices-segments | The segment standard: `ui` / `api` / `model` / `lib` / `config`. Rule: segments "describe the **purpose** of the content, not its essence" — explicit warning against `components`/`hooks`/`types` segment names, and against `lib` degenerating into a utils dump. **This is the load-bearing source for the utils-vs-helpers-vs-lib question.** |
| 4 | **FSD — Alternatives** [P] ⚠ | https://feature-sliced.design/docs/about/alternatives | FSD's comparison against Atomic Design, DDD, Clean Architecture. Source of the "no clear level of responsibility for business logic" critique of Atomic Design. **Self-marked WIP and partisan** — a competing methodology criticizing a rival. |
| 5 | **Atomic Design is not an architecture** [P] ⚠ | https://feature-sliced.design/blog/atomic-design-architecture | Fuller treatment: "Atomic design is not a complete frontend architecture"; prescribes the hybrid — atomic design *inside* `shared/ui`, FSD for domain boundaries. Same partisanship caveat. |
| 6 | **FSD with Next.js** [P] | https://feature-sliced.design/docs/guides/tech/with-nextjs | Documents the FSD `app`/`pages` vs Next.js `app`/`pages` router **name collision** and the `_app`/`_pages` renaming remedy. Evidence that FSD *adapts to* Next.js rather than being endorsed by it. |
| 7 | **FSD with React Query** [P] | https://feature-sliced.design/docs/guides/tech/with-react-query | Where query hooks and keys sit in a slice. |

## Enforcement tooling

| # | Source | URL | Contributes |
|---|--------|-----|-------------|
| 8 | **Steiger** [P] | https://github.com/feature-sliced/steiger | FSD's own architecture linter. Splits the import rule into `no-higher-level-imports` and `no-cross-imports`. Rule detail: https://github.com/feature-sliced/steiger/blob/master/packages/steiger-plugin-fsd/src/forbidden-imports/README.md |
| 9 | **@feature-sliced/eslint-config** [P] | https://github.com/feature-sliced/eslint-config | Official FSD ESLint config. |
| 10 | **eslint-plugin-boundaries** [P] | https://github.com/javierbrea/eslint-plugin-boundaries | General-purpose element/layer boundary linter — the **non-FSD option** for enforcing layer dependency rules. |

## Bulletproof React

| # | Source | URL | Contributes |
|---|--------|-----|-------------|
| 11 | **bulletproof-react — project structure** [P] | https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md | Feature-folder layout plus a concrete unidirectional rule: "the code should flow in one direction, from shared parts of the code to the application (`shared → features → app`)", implemented with ESLint `import/no-restricted-paths`. **3 layers, not FSD's 6 — do not conflate the two.** ⚠ In round 1 this surfaced only second-hand inside a verifier's evidence; treat as needing a direct read before quoting. |

## Next.js / Vercel (first-party)

| # | Source | URL | Contributes |
|---|--------|-----|-------------|
| 12 | **Project structure** [P] | https://nextjs.org/docs/app/getting-started/project-structure | **The single most load-bearing source for "where do components live".** "Next.js is unopinionated about how you organize"; three *unranked* strategies (outside `app` / top-level folders inside `app` / split by feature or route); colocation-safe-by-default; private `_folder` rules; explicit disclaimer that names like `components` and `lib` have **no framework significance**. |
| 13 | **Colocation (v14 archive)** [P] | https://nextjs.org/docs/14/app/building-your-application/routing/colocation | The blunter v14 phrasing: "There is no 'right' or 'wrong' way." Proves the position is stable 2024 → 2026. |
| 14 | **Server and Client Components** [P] | https://nextjs.org/docs/app/getting-started/server-and-client-components | Server Components by default; the state/effects/browser-API criterion for going client; `"use client"` as a **module-graph** boundary; push the boundary down to specific interactive components; children-as-slot interleaving. |
| 15 | **Data security guide** [P] | https://nextjs.org/docs/app/guides/data-security | Current successor to the 2023 security post. Three data approaches by project size; **Data Access Layer** definition (server-only, authorize, return DTOs); DAL-for-mutations; `process.env` confinement; Server Actions reachable by direct POST; the audit checklist. |
| 16 | **Forms guide** [P] | https://nextjs.org/docs/app/guides/forms | Canonical Zod-in-`app/actions.ts` snippet; "turn the component that defines the `<form>` into a Client Component and use `useActionState`". ⚠ **Zod 3-era API** — see #24. |
| 17 | **Security in Server Components and Actions** [P] — Sebastian Markbåge (React core), 2023-10-23 | https://nextjs.org/blog/security-nextjs-server-components-actions | Origin of the DAL recommendation, the "arguments must be treated as hostile" principle, and `import 'server-only'` as a **build-time** boundary. |
| 18 | **Next.js 14.2** [P] — Delba de Oliveira, Tim Neutkens, 2024-04-11 | https://nextjs.org/blog/next-14-2 | Cross-boundary tree-shaking (−51.3% on `react-aria-components`) **and the explicit note that it "does not currently work with barrel files"**; `optimizePackageImports` as mitigation. **Primary citation for the perf case against barrels.** |
| 19 | **Building APIs with Next.js** [P] — Lee Robinson, 2025-02-28 | https://nextjs.org/blog/building-apis-with-nextjs | "When to skip creating an API endpoint"; share core logic via a DAL between Server Actions and API routes. |
| 20 | **Common App Router mistakes** [P] — Lee Robinson, 2024-01-08 | https://vercel.com/blog/common-mistakes-with-the-next-js-app-router-and-how-to-fix-them | "Both Route Handlers and Server Components run securely on the server. You don't need the additional network hop." |
| 21 | **Optimizing package imports** [P] | https://vercel.com/blog/how-we-optimized-package-imports-in-next-js | Mechanics of barrel-file cost and the `optimizePackageImports` mitigation. |
| 22 | **Barrel exports mess with `use client`** [S] | https://github.com/vercel/next.js/discussions/65979 | Concrete **build-time failure** from a barrel that `export *`s client hooks. |
| 23 | **vercel-labs/agent-skills — bundle/barrel imports rule** [S] | https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/rules/bundle-barrel-imports.md | Vercel's own agent-facing phrasing of the barrel rule. Useful as a format precedent for this skill. |

### Next.js — the architectural rules, extracted verbatim

Re-read 2026-08-07 against **v16.3.0** (`project-structure` lastUpdated
2026-07-21, `server-and-client-components` 2026-07-29) with a deliberately
**architecture-only** lens — the bundle-size framing of round 1 buried most of
this. Quotes are verbatim; emphasis is the docs' own.

**Organization — the framework declines to choose.**
- "Next.js is **unopinionated** about how you organize and colocate your project files."
- Three named strategies, presented without ranking: *Store project files outside of `app`* (all app code at project root, `app` kept "purely for routing purposes") · *Store project files in top-level folders inside of `app`* · *Split project files by feature or route* (globally shared code at the `app` root, specific code pushed into the route segments that use it).
- The stated criterion, verbatim: "**choose a strategy that works for you and your team and be consistent across the project.**"
- "we're using `components` and `lib` folders as generalized placeholders, **their naming has no special framework significance** and your projects might use other folders like `ui`, `utils`, `hooks`, `styles`, etc."

**Colocation — why it is safe.**
- "a route is **not publicly accessible** until a `page.js` or `route.js` file is added to a route segment."
- "even when a route is made publicly accessible, only the **content returned** by `page.js` or `route.js` is sent to the client."
- ⇒ "**project files** can be **safely colocated** inside route segments in the `app` directory without accidentally being routable."
- Explicitly optional: "While you **can** colocate your project files in `app` you don't **have** to."

**Private folders (`_folder`) — four stated reasons, none of them "required".**
"Since files in the `app` directory can be safely colocated by default, **private folders are not required for colocation**. However, they can be useful for:"
1. "Separating UI logic from routing logic."
2. "Consistently organizing internal files across a project and the Next.js ecosystem."
3. "Sorting and grouping files in code editors."
4. "Avoiding potential naming conflicts with future Next.js file conventions."

Escape hatch: a literal underscore URL segment is `%5FfolderName`.

**Route groups (`(group)`) — the architectural tool round 1 missed entirely.**
Not a URL feature; an *organization* feature. Stated uses:
- "Organizing routes by site section, intent, or **team**. e.g. marketing pages, admin pages, etc."
- Enabling nested layouts at the same segment level — including **multiple root layouts**, "useful for partitioning an application into sections that have a completely different UI or experience" (each root layout must carry its own `<html>`/`<body>`).
- Opting a *subset* of routes in a shared segment into a layout, leaving siblings out.
- Scoping a `loading.tsx` to one route without changing the URL.

**`"use client"` — a boundary in the module graph, with structural consequences.**
- "`\"use client\"` is used to declare a **boundary** between the Server and Client module graphs (trees)."
- "Once a file is marked with `\"use client\"`, **all of its imports and the components it directly renders are included in the client bundle**. This means you don't need to add the directive to every component that is intended for the client." — i.e. it marks an **entry point**, not every file.
- The exception that makes composition work: "It **does not apply to Server Components passed as children or other props**. Those components are not imported into the Client Component's module graph. They are rendered on the server and passed to the Client Component as rendered output."
- Boundary placement: "add `'use client'` to **specific interactive components** instead of marking large parts of your UI as Client Components" — the `<Layout>` stays a Server Component while `<Search />` alone goes client.
- The `children`-as-slot pattern: a server-rendered `<Cart />` visually nested inside a client-stateful `<Modal>`.
- Must-be-client criteria, verbatim list: state and event handlers · lifecycle logic (`useEffect`) · browser-only APIs · **custom hooks**.

**Provider placement — an explicit architectural rule.**
- "You should render providers **as deep as possible in the tree** – notice how `ThemeProvider` only wraps `{children}` instead of the entire `<html>` document. This makes it easier for Next.js to optimize the static parts of your Server Components."
- React context "is not supported in Server Components" — a provider is necessarily a `"use client"` component accepting `children`.
- ⚠ Mild tension with TanStack's guidance (#42) to put `QueryClientProvider` in a root providers file. Reconcilable — root *providers file*, but wrapping `{children}`, not the document.

**Environment separation — the constants/config answer, and it is enforced.**
- "only environment variables prefixed with `NEXT_PUBLIC_` are included in the client bundle. If variables are not prefixed, Next.js replaces them with **an empty string**." — a non-prefixed secret does not error, it silently becomes `""`.
- `import 'server-only'` ⇒ "if you try to import the module into a Client Component, there will be a **build-time error**". `client-only` is the mirror.
- Installing either package is "**optional**" in Next.js — the handling is internal.

**Third-party boundary ownership.**
- Wrap a client-only third-party component in your own `"use client"` re-export module so Server Components can render it.
- "If you're building a component library, add the `\"use client\"` directive to entry points that rely on client-only features."

**Scope boundary with the existing `next-best-practices` skill.** That skill
covers Next.js *mechanics* — which files are special, what is valid/invalid, the
data-fetching decision tree — and its Private Folders section says only "Prefix
with `_` to exclude from routing". None of the organizational material above is
in it. The two are complementary; `frontend-architecture` should link to it
rather than restate file conventions.

## React (first-party)

| # | Source | URL | Contributes |
|---|--------|-----|-------------|
| 24 | **`"use client"` reference** [P] | https://react.dev/reference/rsc/use-client | The **module-dependency-tree** framing; transitive dependencies become client modules; "not limited to components"; the `Counter`/`CounterContainer` leaf example. |
| 25 | **Server Components reference** [P] | https://react.dev/reference/rsc/server-components | RSC defaults. |
| 26 | **Server Functions reference** [P] | https://react.dev/reference/rsc/server-functions | ⚠ Round 1 produced **three** claims from this page about mandated Server Function placement — all were **refuted** (0-3, 0-3, 1-2). The page documents mechanics, not a file-structure rule. Do not cite it as prescribing an `actions.ts` convention. |
| 27 | **`useActionState`** [P] | https://react.dev/reference/react/useActionState | Hook constraint that forces the client boundary for rendering action results. |

## Adjacent / supporting

| # | Source | URL | Contributes |
|---|--------|-----|-------------|
| 28 | **Colocation** [B] — Kent C. Dodds | https://kentcdodds.com/blog/colocation | "Place code as close to where it's relevant as possible." The general principle under `_components/` and colocated tests. |
| 29 | **React folder structure** [B] — Robin Wieruch | https://www.robinwieruch.de/react-folder-structure/ | The incremental progression: single file → folders → feature folders. |
| 30 | **React Query as a state manager** [B] — TkDodo (Dominik Dorfmeister, TanStack maintainer) | https://tkdodo.eu/blog/react-query-as-a-state-manager | Server state vs client state as **distinct categories** — the basis for "do not mirror server state into `useState`". |
| 31 | **Why I don't like TypeScript enums** [B] — Matt Pocock, Total TypeScript | https://www.totaltypescript.com/why-i-dont-like-typescript-enums | The `enum` vs `as const` object argument. |
| 32 | **Google TypeScript Style Guide** [P] | https://google.github.io/styleguide/tsguide.html | A large-org position on constants, naming, and enums. |
| 33 | **Speeding up the JS ecosystem, part 7** [B] — Marvin Hagemeister | https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/ | Independent (non-Vercel) measurement of barrel-file cost. |
| 34 | **Zod v4 changelog** [P] | https://zod.dev/v4/changelog | Needed because the Next.js forms guide (#16) still uses the Zod 3 API: `invalid_type_error` removed, `flatten()` deprecated in favour of `z.flattenError()`. |

---

## Round 2 — gap fill

Round 1 clustered almost entirely on FSD + Next.js first-party material and left
six areas with **zero surviving verified claims**. Round 2 was a direct manual
read of named sources rather than a verified fan-out — **these entries did not
go through adversarial verification**, so treat them as well-sourced but
single-pass. Quotes below were read directly off the page.

| # | Source | URL | Contributes |
|---|--------|-----|-------------|
| 35 | **Thinking in React** [P] | https://react.dev/learn/thinking-in-react | **The official component-split criterion, and it is not numeric:** "a component should ideally only be concerned with one thing. If it ends up growing, it should be decomposed into smaller subcomponents." Also the CSS / design / data-structure lenses, and the table-header example (split driven by *complexity*, not size). |
| 36 | **Reusing Logic with Custom Hooks** [P] | https://react.dev/learn/reusing-logic-with-custom-hooks | **The load-bearing source for "what goes in a hook vs a plain function".** "If your function doesn't call any Hooks, avoid the `use` prefix" — `useSorted` → `getSorted`, so it "can be called anywhere, including conditions". "Keep custom Hooks focused on concrete high-level use cases", with 🔴 `useMount` / `useEffectOnce` / `useUpdateEffect` named as anti-patterns. "You don't need to extract a custom Hook for every little duplicated bit of code. Some duplication is fine." Custom Hooks share *stateful logic*, **not state**. |
| 37 | **AHA Programming** [B] — Kent C. Dodds, 2020-06-22 | https://kentcdodds.com/blog/aha-programming | "**Avoid Hasty Abstractions**". Quotes Sandi Metz: "prefer duplication over the wrong abstraction". The **only numeric extraction threshold found anywhere**, via Conlin Durbin: "You can ask yourself 'Haven't I written this before?' two times, but never three." Plus "optimize for change first". |
| 38 | **Colocation** [B] — Kent C. Dodds, 2019-06-17 | https://kentcdodds.com/blog/colocation | (Also #28.) "Place code as close to where it's relevant as possible"; Dan Abramov's "things that change together should be located as close as reasonable". **Recommends colocating tests** over a mirrored `test/` tree, with four rationales: visibility to newcomers, tests-as-documentation, reminder to update, and no orphaned test files after deletion. ⚠ **Says nothing about where types go** — do not cite it for that. |
| 39 | **React folder structure** [B] — Robin Wieruch, updated 2026-05-05 | https://www.robinwieruch.de/react-folder-structure/ | The 8-stage progression: single file → multiple files → folder-per-component → technical folders → feature folders → domain folders → packages → apps. **The promotion rule, verbatim:** "if exactly one feature uses a util, it lives inside that feature; once two or more features need it, it moves up to the shared layer." Also `constants.ts` / `types.ts` as folder-level concern files. **Defends barrels** — see disagreement #4. |
| 40 | **Why I don't like TypeScript enums** [B] — Matt Pocock | https://www.totaltypescript.com/why-i-dont-like-typescript-enums | (Also #31.) Numeric enums emit a **bidirectional** map and accept raw numbers where the enum type is expected, while string enums correctly reject raw strings; enums are **nominally** typed, so a structurally identical enum is rejected — contradicting "JavaScript with types"; "71 issues marked as bugs" in the TS repo, many "uncloseable due to the way enums are implemented". Verdict: would not "add an enum to a fresh codebase"; if you must, string enums only. Recommends `as const` objects. |
| 41 | **React Query as a state manager** [B] — TkDodo (TanStack maintainer), 2021-08-20 | https://tkdodo.eu/blog/react-query-as-a-state-manager | (Also #30.) "React Query manages async state… it assumes that the frontend application doesn't **own** the data" — the app holds a *snapshot*. Names "fetch once, distribute globally, rarely update" as the sub-optimal pattern. **Custom hook per feature** (`useTodos()`) so the fetching function isn't reached for twice. Explicitly **rejects** restricting `useQuery` to container components ("smart vs dumb" is outdated). ⚠ Does **not** contain a verbatim "never mirror server state into `useState`" prohibition — that is an inference. |
| 42 | **TanStack Query — Advanced SSR** [P] | https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr | The App Router placement answer: `QueryClientProvider` lives in a **`"use client"` providers file** at the root ("Since QueryClientProvider relies on useContext under the hood, we have to put 'use client' on top"); `prefetchQuery` is called in a **Server Component**; `HydrationBoundary` wraps the Client Components that consume it. Warning: "Avoid `useState` when initializing the query client if you don't have a suspense boundary between this and the code that may suspend". ⚠ No guidance on colocating `queryOptions`. |
| 43 | **The utility module antipattern** [B] — Yang Lin Zhao | https://www.yanglinzhao.com/posts/utils-antipattern/ | Named-author statement of the `utils` critique. |
| 44 | **Stop naming your modules "utils"** [B] — Sebastian Buczyński | https://breadcrumbscollector.tech/stop-naming-your-python-modules-utils/ | The clearest phrasing of the naming rule: `helper`, `util`, `misc`, `common`, `data`, `processor`, `manager`, `parser`, `handler` are meaningless names; name modules by **theme** instead. Python-framed but language-neutral, and it independently corroborates FSD's "purpose, not essence" (#3). |
| 45 | **Dunghill anti-pattern** [B] — Matti Lehtinen | https://mattilehtinen.com/articles/dunghill-anti-pattern-why-utility-classes-and-modules-smell/ | The *deterioration* mechanism: a utils module decays because "each person that adds something that doesn't fit anywhere will happily add it" — incohesion grows monotonically. This is the argument that matters; the objection is to the **name and grouping**, not the functions. |

### Round 2 — what was NOT found

Recorded so nobody re-runs this search expecting a different answer:

- **No authoritative numeric threshold for component size exists.** Not in
  react.dev, not in Next.js docs, not from Dodds/Wieruch. Every "max 200 lines /
  max 5 props" rule — including the one in this repo's own
  `react-best-practices` skill — is **team convention, not documented practice**.
  The only numeric rule with a named source is the **rule of three for
  duplication** (#37), and it governs *abstraction*, not file length.
- **The "custom hooks are not for business logic" debate has no authoritative
  source.** react.dev (#36) answers the adjacent and more useful question — a
  function that calls no Hooks must be a plain function — but takes no position
  on domain logic in hooks.
- **Clean / hexagonal architecture on the frontend is blog-tier on both sides.**
  Advocates (Alex Bespoyasov, Alex Kondov) and critics (over-abstraction,
  hiring cost, "early abstractions aren't future-proof") are all
  self-published; no primary source adjudicates. Left out of the skill's rules
  deliberately.
- **`profy.dev`'s business-logic article was unreachable** (`ECONNREFUSED`) at
  research time. Not cited.

---

## Where the sources disagree

Recorded deliberately — the skill must not average these away.

1. **FSD vs simple feature folders.** FSD prescribes 6–7 layers with a strict
   layer-and-slice import lattice. bulletproof-react prescribes 3
   (`shared → features → app`) with the same *directional* principle. Next.js
   declines to rank any of them. **No authority adjudicates between these.**
   Team size — the most-requested dimension — is asserted by critics ("FSD is
   overkill for small projects", "steep learning curve") but was **not
   verified** against any primary or empirical source.
2. **Barrel files.** Vercel documents both the hazard *and* an official
   mitigation (`optimizePackageImports`), so the case against barrels is
   **qualified, not absolute** — it bites hardest on internal `export *`
   barrels, especially ones re-exporting client hooks.
3. **Internal API layers.** First-party Next.js guidance argues against an
   internal `/api` hop; community practice widely favours one. The disagreement
   is partly definitional — a *public* API for external clients is a different
   thing from *internal* indirection.
4. **Barrel files — a three-way split.** Vercel documents the tree-shaking
   hazard *and* ships a mitigation (#18, #21). **bulletproof-react argues
   against them outright** — "it can cause issues for Vite to do tree shaking
   and can lead to performance issues. Therefore, it is recommended to import
   the files directly" (#11). **Robin Wieruch defends them** as a public-API
   mechanism — "if you only re-export the public API… it can be a good practice,
   because you don't leak implementation details" (#39). The positions are
   reconcilable: the cost is real and lands on `export *` re-export chains; the
   encapsulation benefit is real and lands on a narrow, hand-written `index.ts`.
   **This is directly load-bearing for dev-digest, which has 47 `index.ts`
   files.** The skill must state the distinction, not pick a side.
5. **Whether a shared `utils/` folder may exist at all.** FSD forbids naming a
   segment by essence and warns against `lib` becoming a utils dump (#3); the
   anti-pattern corpus (#43–45) argues the name itself guarantees decay.
   **bulletproof-react — the most-cited React reference layout — ships both
   `src/utils/` and a per-feature `utils/`** (#11). Unreconciled. The defensible
   synthesis is Wieruch's promotion rule (#39): placement follows *how many
   features use it*, and the folder needs a real name once it holds more than
   trivia.

## Citation hygiene — do not re-introduce these errors

Found during verification and corrected:

- The FSD **overview** page does **not** mention `eslint-plugin-boundaries` or
  `import/no-restricted-paths`; it points to **Steiger**.
- The Next.js **server/client components** page does **not** mention barrel
  files; that belongs to the **14.2 blog** (#18) and **Discussion #65979** (#22).
- "Children-as-slot is the RSC-era successor to container/presentational" is an
  **editorial inference**, not a statement by any cited source.
- No **adoption-share** data was verified for any methodology. An SEO claim that
  FSD is "the most widely adopted React architecture standard in 2026" was
  explicitly flagged as unsupported — **do not propagate it**.
- `server-only` is **compiler-enforced**; the `process.env`-in-DAL rule is an
  **audit item**, not a compiler check. Do not describe both as "mechanically
  enforced".
- FSD's **Processes** layer is deprecated — do not include it in new structures.
