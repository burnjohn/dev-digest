# frontend-ui-architecture

Answers one question: **where does this piece of client code go?**

Not how to write the component. Not how to make it fast. Which file, which folder, which layer,
which imports are allowed, what to name it.

- `SKILL.md` — the rules (loaded when the skill triggers)
- `references/decision-checklist.md` — mechanical "I have a new file, where does it go?"
- `references/examples.md` — before/after trees for four common restructures
- `references/eslint-boundaries.md` — a verified ESLint flat config that enforces the boundaries

---

## Why this exists

Placement was the gap nothing else covered. The existing skills are all about *what happens inside
a file*:

| Skill | Covers | Doesn't cover |
|---|---|---|
| `react-best-practices` (project) | Behavior: hooks, derived state, keys, a11y | Code organization — five lines in total |
| `next-best-practices` (project) | Routing conventions, RSC directives | Where non-route code lives |
| `vercel-react-best-practices` (global) | Performance, bundle size | Structure as architecture |
| `typescript-expert`, `react-testing-library` | Types, tests | File placement |

The scope boundary is deliberately sharp, and there is a test for it: *could you violate this rule
without changing a single line inside a file, only by moving or renaming the file?* If not, the
rule belongs to another skill. That keeps the skill from turning into a second, worse copy of
`react-best-practices`.

## The position it takes

One prescribed structure rather than a survey, because Next.js is explicitly unopinionated here
and a team that picks any consistent structure beats a team that debates structure. Summarised:

- `app/` is routing only; pages are thin; `_folder` for colocated non-route code.
- Colocate by default. Promote to shared on the **second** consumer. Abstract on the **third**
  repetition. Never promote speculatively.
- `kebab-case` files, `PascalCase` component identifiers, `use-` only for real hooks.
- One import direction: `shared → features/routes → app`. No route imports another route.
- **No barrel files in application code** — take the public-API guarantee from the linter instead.
- Structure is a wish until CI enforces it.

## What it deliberately does not claim

The word `features` appears nowhere in the official Next.js documentation — it is a community
convention (bulletproof-react's, mainly), and this skill does not dress it up as framework
doctrine. Where the community genuinely disagrees, the disagreement is shown rather than hidden.

---

## Points of disagreement

**Barrel files** split the ecosystem three ways, and the skill's position (don't use them; get
encapsulation from `boundaries/dependencies` with a `fileInternalPath` selector) is a synthesis,
not a consensus:

- *Against:* TkDodo measured 11k modules → ~3.5k and 5–10s → ~3.5s dev startup after removing
  internal barrels; also circular imports and defeated `optimizePackageImports`.
- *Reversed:* bulletproof-react explicitly withdrew its own earlier advice to use them.
- *For:* Feature-Sliced Design treats `index.ts` as the load-bearing encapsulation mechanism — a
  contract that protects consumers from a slice's internal refactors.
- *Also for, in a specific case:* Josh Comeau's structure uses a per-component `index.ts` purely
  for import ergonomics, in a design-system-heavy codebase where the cost is bounded.

**File naming** — `kebab-case` (Wieruch, bulletproof-react) vs `PascalCase` (Comeau, much of the
React ecosystem). The skill picks kebab-case for the cross-OS case-sensitivity argument but says
plainly that consistency matters more than the choice, echoing the Next.js docs.

**Feature folders vs function folders** — bulletproof-react and Feature-Sliced Design organize by
feature; Comeau argues explicitly *against* it ("by function, not by feature") because product
boundaries shift. The skill's answer: domain at the top *once a layer gets big* (Fowler), function-
based layout kept as a named escape hatch for design-system-heavy code.

**How much structure up front** — FSD prescribes a full layer taxonomy; Fowler warns that
presentation-domain-data separation "should only be applied at a relatively small granularity".
The skill sides with Fowler and caps up-front structure planning at ~5 minutes.

---

## Sources

**About this list.** The plan this skill was built from referenced roughly 70 sources gathered in
an earlier research pass; that URL list was not preserved in the plan document and could not be
recovered. What follows is the set the rules actually rest on, re-verified on **2026-08-15** — 40
sources, every one of them returning HTTP 200 at that date. Nothing in `SKILL.md` rests on a
citation that is not in this list.

Sources marked ✅ were read in full while writing the skill; the rest were verified live and are
listed as further reading for the rule they sit under.

### Official framework documentation

| Source | Supports |
|---|---|
| ✅ [Next.js — Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure) | The whole of §1. Private `_folder` semantics and the four stated reasons; "generalized placeholders… no special framework significance" for `components`/`lib`; "choose a strategy that works for you and your team and be consistent"; the three organization strategies; colocation safety |
| ✅ [Next.js — How to think about data security](https://nextjs.org/docs/app/guides/data-security) | `src/server/` as a DAL: server-only, authorization inside, DTOs out, only the DAL reads `process.env`; thin Server Actions delegating to it |
| [Next.js — Layouts and pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages) | Route file conventions referenced in §2 |
| [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | The environment-poisoning argument behind `import 'server-only'` |
| [Next.js — Route groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) | `(group)` folders group without affecting URLs |
| [Next.js — `src` folder](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder) | `src/` as the application-code root |
| [Next.js — `proxy.ts`](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) | The Next.js 16 rename of `middleware.ts` → `proxy.ts` |
| [Next.js 16 release notes](https://nextjs.org/blog/next-16) | Same rename, in context |
| [Next.js — `page.tsx`](https://nextjs.org/docs/app/api-reference/file-conventions/page) · [`route.ts`](https://nextjs.org/docs/app/api-reference/file-conventions/route) | Framework files that must never be renamed |
| [Next.js — Authentication](https://nextjs.org/docs/app/guides/authentication) | Where auth checks belong relative to pages and actions |
| [React — Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks) | Why `use-` must mean "calls a hook" |
| [React — Reusing logic with custom hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) | Hook vs plain function; when extraction is warranted |
| [React — Server Components](https://react.dev/reference/rsc/server-components) | The server/client module boundary that `src/server/` mirrors |
| [React — Thinking in React](https://react.dev/learn/thinking-in-react) | Component decomposition, upstream of placement |

### Colocation, promotion, and abstraction thresholds

| Source | Supports |
|---|---|
| ✅ [Robin Wieruch — React Folder Structure in 5 Steps](https://www.robinwieruch.de/react-folder-structure/) | Promotion on the second consumer; kebab-case; the component-folder shape (component + test + types + helpers) |
| ✅ [Kent C. Dodds — AHA Programming](https://kentcdodds.com/blog/aha-programming) (2020-06-22) | Abstraction on the third repetition, not the second; carries the Metz quote |
| ✅ [Sandi Metz — The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) | "prefer duplication over the wrong abstraction" — the reason not to promote speculatively |
| [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation) | "Place code as close to where it's relevant as possible" — the default in §3 |
| ✅ [Martin Fowler — PresentationDomainDataLayering](https://martinfowler.com/bliki/PresentationDomainDataLayering.html) | Layering "should only be applied at a relatively small granularity"; split the top level into domain modules that are internally layered — the anti-pattern in §8 |

### Competing structural conventions

| Source | Supports |
|---|---|
| ✅ [bulletproof-react — Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) | The `shared → features → app` direction; per-feature internal folders; the reversal on barrel files; `import/no-restricted-paths` as enforcement |
| [bulletproof-react — Project Standards](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md) | Naming and lint conventions alongside the structure |
| [bulletproof-react (repository)](https://github.com/alan2207/bulletproof-react) | The origin of the `features/` convention in the React ecosystem |
| ✅ [Josh W. Comeau — Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/) (2022-03-15, upd. 2025-12-03) | The function-based escape hatch in §7; the counter-argument to feature folders; per-component `index.ts` |
| ✅ [Feature-Sliced Design — Public API](https://feature-sliced.design/docs/reference/public-api) | The pro-barrel position: the slice contract, and the warning against `export *` |
| [Feature-Sliced Design — Layers](https://feature-sliced.design/docs/reference/layers) | A full layer taxonomy, as the maximalist end of the spectrum |
| [Feature-Sliced Design — Overview](https://feature-sliced.design/docs/get-started/overview) | Context for the methodology as a whole |
| [Redux Style Guide](https://redux.js.org/style-guide/) | "Structure files as feature folders with single-file logic" — an independent vote for the domain axis |
| [Alex Kondov — Tao of React](https://alexkondov.com/tao-of-react/) | Component/folder conventions. *Reachable with a browser user agent; the plan recorded it as 403 to automated fetchers, and it was not re-read while writing.* No rule depends on it |
| [Alex Kondov — Hexagonal Architecture in React](https://alexkondov.com/hexagonal-inspired-architecture-in-react/) | The maximalist layering position named in §8. Same 403 caveat; no rule depends on it |

### Barrel files and bundling

| Source | Supports |
|---|---|
| ✅ [TkDodo — Please stop using Barrel Files](https://tkdodo.eu/blog/please-stop-using-barrel-files) (2024-07-26) | 11k → ~3.5k modules, 5–10s → ~3.5s dev startup; circular imports; defeated `optimizePackageImports` |
| [Vercel — How we optimized package imports in Next.js](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js) | Why barrels hurt at the bundler level, and the limits of the automatic fix |

### Boundary enforcement

| Source | Supports |
|---|---|
| ✅ [eslint-plugin-boundaries (repository)](https://github.com/javierbrea/eslint-plugin-boundaries) | The plugin behind `references/eslint-boundaries.md` (verified against v7.2.0) |
| ✅ [JS Boundaries — Rules reference](https://www.jsboundaries.dev/docs/rules/) | Which rules are current and which are deprecated — `entry-point` and `element-types` are superseded by `dependencies` |
| ✅ [JS Boundaries — Selectors](https://www.jsboundaries.dev/docs/selectors/) | `element` / `file` / `module` selector vocabulary; `fileInternalPath` for entry points; `captured` templates for the same-route rule |
| ✅ [JS Boundaries — Policies](https://www.jsboundaries.dev/docs/policies/) | `default` + `policies`, last-match-wins evaluation, message templating |
| ✅ [JS Boundaries — v6 → v7 migration](https://www.jsboundaries.dev/docs/releases/migration-guides/v6-to-v7/) | The `mode` deprecation and `rules` → `policies` rename; why most tutorials are stale |
| [JS Boundaries — Quick start](https://www.jsboundaries.dev/docs/quick-start/) | Minimal setup, if the full config is too much |
| [eslint-plugin-import — `no-restricted-paths`](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-restricted-paths.md) | The lighter zone-based alternative |
| [eslint-plugin-import — `no-cycle`](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-cycle.md) | Cycle detection (verified: needs the `import/parsers` setting on TypeScript projects) |
| [Nx — Enforce Module Boundaries](https://nx.dev/features/enforce-module-boundaries) | The two-axis `scope:`/`type:` tag variant for monorepos |

### Not re-verifiable by automated fetch

- [`server-only` on npm](https://www.npmjs.com/package/server-only) — returns 403 to non-browser
  clients (registry bot protection). The package is documented inside the Next.js data-security
  guide above, which is the citation the skill actually uses.
- `profy.dev/article/react-folder-structure` — the domain did not resolve at all on 2026-08-15.
  It was dropped from the skill rather than cited as dead.

---

## Verification performed

- ESLint config in `references/eslint-boundaries.md` tested against a purpose-built fixture:
  five deliberate violations all reported, the legal tree exits 0. Details and the results table
  are in that file.
- All 40 sources above fetched on 2026-08-15; the two exceptions are listed as such.
- The Next.js claims (private folders, placeholders, consistency guidance, DAL) were read from the
  current docs (v16.3.1), not from memory or from community summaries.

---

## Changelog

### 1.0.0 — 2026-08-15

Initial release.

- `SKILL.md`: prescribed structure, what-goes-where table, colocation/promotion thresholds,
  naming, import boundaries, barrel-file position, escape hatches, anti-patterns, and an
  explicit "adjacent, not covered here" section pointing at the neighbouring skills.
- `references/decision-checklist.md`, `references/examples.md`, `references/eslint-boundaries.md`.
- Sourced against current Next.js 16 documentation, including the `middleware.ts` → `proxy.ts`
  rename that invalidates most community writing on the subject.
- ESLint config written against `eslint-plugin-boundaries` v7 (the rules most tutorials show are
  deprecated) and verified against a fixture in both directions.
