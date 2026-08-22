# React / Frontend Best Practices — Sources & Practices

> Research dump for building a future "React/frontend best practices" skill.
> Organized by topic. Every claim keeps its source link. Curated 2026-06-17.

## How to use this file
Each section lists: **the practice** (the consensus takeaway) + **the sources** (links).
When we build the skill, lift the practices into rules and cite these links as the evidence base.

Already-installed related skills worth reconciling with (don't duplicate):
- `react-best-practices` — anti-pattern catalog (2025–26)
- `vercel-react-best-practices` — performance-focused (Vercel Engineering)
- `next-best-practices` — Next.js file conventions / RSC boundaries

---

## 1. Folder / project structure (where components live)

**Key practices**
- No single correct structure — React officially has no opinion; scale structure to project size: flat → type-based → feature-based.
- **Flat** for <15–20 components; it breaks down past that.
- **Type-based** (`components/`, `hooks/`, `pages/`, `services/`, `utils/`, `contexts/`, `styles/`) — simple, good for small/medium, but features get scattered as it grows.
- **Feature-based** is the gold standard for large/team apps: each feature is a self-contained folder (its own `components/`, `hooks/`, `api/`, `types/`, `utils/`), with a `shared/` (or `components/ui`) for truly generic code. Type-based organization can still live *inside* each feature. Expose a public API via `index.ts`.
- **Feature-Sliced Design** for very large apps: `entities/`, `features/`, `widgets/`, `pages/`, `processes/`, `shared/`.
- "Screaming Architecture" — folder names should reflect business domains, not frameworks.
- **Limit nesting** to 3–4 levels max (deep nesting wrecks relative imports & moves).
- **Subdivide `components/`** when it grows: `components/ui/` (buttons, modals) vs `components/form/`.
- Start small: `components/`, `hooks/`, and one of `utils/`/`lib/`; add more as the codebase demands.
- Don't spend >5 min choosing structure when starting — you'll rethink it after real code.

**Sources**
- [Recommended Folder Structure for React 2025 — DEV (Pramod Boda)](https://dev.to/pramod_boda/recommended-folder-structure-for-react-2025-48mc)
- [React Folder Structure Best Practices [2026] — Robin Wieruch](https://www.robinwieruch.de/react-folder-structure/)
- [How to structure a React App in 2025 (SPA/SSR/Native) — Ramon Prata](https://ramonprata.medium.com/how-to-structure-a-react-app-in-2025-spa-ssr-or-native-10d8de7a245a)
- [How to Build a Professional React Project Structure in 2025 — Netguru](https://www.netguru.com/blog/react-project-structure)
- [Guidelines to improve your React folder structure — Max Rozen](https://maxrozen.com/guidelines-improve-react-app-folder-structure)
- [File Structure — React (legacy docs)](https://legacy.reactjs.org/docs/faq-structure.html)
- [How to Structure a React Project in 2025: Clean, Scalable, Practical — DEV](https://dev.to/algo_sync/how-to-structure-a-react-project-in-2025-clean-scalable-and-practical-15j6)
- [Production-Grade React Project Structure — DZone](https://dzone.com/articles/production-grade-react-project-structure)
- [Popular React Folder Structures and Screaming Architecture — profy.dev](https://profy.dev/article/react-folder-structure)
- [How To Structure React Projects Beginner→Advanced — Web Dev Simplified](https://blog.webdevsimplified.com/2022-07/react-folder-structure/)
- [4 folder structures to organize your React project — reboot.studio](https://reboot.studio/blog/folder-structures-to-organize-react-project)
- [Screaming Architecture — Evolution of a React folder structure — DEV (profydev)](https://dev.to/profydev/screaming-architecture-evolution-of-a-react-folder-structure-4g25)
- [Bulletproof React (canonical feature-based example) — GitHub](https://github.com/alan2207/bulletproof-react)

---

## 2. Feature-based vs type-based (the trade-off)

**Key practices**
- Type-based = "organize kitchen by item type" — all plates in one cabinet; simple to start, bad to scale, naming collisions, feature dispersal.
- Feature-based = high cohesion, delete-a-feature = delete-a-folder, scales with teams; cost = "what is shared vs feature-specific?" boundary is fuzzy.
- **Hybrid** is common for midsize (5–20 devs, 5k–50k LOC): features + shared type-based folders.
- Colocation is the deciding benefit at scale: files used together stored together.

**Sources**
- [3 Folder Structures in React… Why Feature-Based — Asrul Kadir](https://asrulkadir.medium.com/3-folder-structures-in-react-ive-used-and-why-feature-based-is-my-favorite-e1af7c8e91ec)
- [Mastering React Folder Structures — Deltaromeoyanki](https://medium.com/@deltaromeoyanki/mastering-react-folder-structures-your-ultimate-guide-to-scalable-and-maintainable-projects-5e200d630025)
- [react-folder-structures — GitHub (balajidharma)](https://github.com/balajidharma/react-folder-structures)
- (see also profy.dev, Robin Wieruch, Web Dev Simplified above)

---

## 3. Where business logic goes (separation of concerns)

**Key practices** — the layered rule of thumb:
- **Pure UI rendering → component**
- **React state / effects / data fetching → custom hooks**
- **Pure, framework-agnostic business rules/calculations → plain functions** (a "use-case"/application layer) — portable, trivially testable without React.
- **API/backend communication → services**
- Predecessor pattern: container/presentational (smart/dumb) components.
- Avoid the "god component" (fetches + transforms + state + renders all at once).
- **Caveat:** separation only pays off if you *have* real logic — don't over-engineer a simple API request. No universal consensus exists; judgment required.

**Sources**
- [Separation of concerns with React hooks — Felix Gerschau](https://felixgerschau.com/react-hooks-separation-of-concerns/)
- [Separating responsibilities using Hooks — Sairys (Medium)](https://sairys.medium.com/react-separating-responsibilities-using-hooks-b9c90dbb3ab9)
- [Path To A Clean(er) React Architecture pt.6 — Business Logic Separation — profy.dev](https://profy.dev/article/react-architecture-business-logic-and-dependency-injection)
- [Separating Business Logic from UI Components in React 18 — Israel (Bootcamp)](https://medium.com/design-bootcamp/separating-%EF%B8%8F-business-logic-from-ui-components-in-react-18-aa1775b3caba)
- [React Separation of Concern — Mehul Thakkar](https://mehulcse.com/blogs/react-separation-of-concern)
- [Why Separating Business Logic From Components Matters — Asrul Kadir](https://asrulkadir.medium.com/why-separating-business-logic-from-components-matters-in-react-applications-5dbe2c71a2ba)
- [Where to Write Business Logic in React — Filippo Rivolta (Stackademic)](https://medium.com/@rivoltafilippo/where-to-write-business-logic-in-react-separation-of-concers-for-frontend-interviews-59283b5d4b27)
- [Best Practices for Keeping React UI and Logic Separate — DhiWise](https://www.dhiwise.com/post/mastering-the-art-of-separating-ui-and-logic-in-react)

---

## 4. Splitting components (SRP & composition)

**Key practices**
- One component = one responsibility / one reason to change. The "and" test: if you describe it with "and," split it.
- Signal to split: changing component A forces you to modify component B.
- Techniques: (1) extract UI sub-components into real components (not sub-render methods); (2) separate data fetching from presentation; (3) composition via `children` and element props (slot pattern); (4) HOCs for cross-cutting generic concerns.
- **Don't over-split** into trivial components; name by what they do; group related components in one directory; stay DRY.

**Sources**
- [Single Responsibility in ReactJS — Roni Shabo](https://medium.com/@roni.shabo/single-responsibility-in-reactjs-9c60e4163862)
- [Splitting a UI into Components: Six Pillars of Component Architecture — Abbas Roholamin](https://medium.com/@abbas-roholamin/splitting-a-ui-into-components-in-react-six-pillars-of-component-architecture-04538e542ce5)
- [Single Responsibility Principle in React — cekrem.github.io](https://cekrem.github.io/posts/single-responsibility-principle-in-react/)
- [7 Architectural Attributes of a Reliable React Component — Dmitri Pavlutin](https://dmitripavlutin.com/7-architectural-attributes-of-a-reliable-react-component/)
- [Single Responsibility Principle in React — DEV (mikhaelesa)](https://dev.to/mikhaelesa/single-responsibility-principle-in-react-10oc)
- [Splitting Components in React — Thiraphat Phutson](https://thiraphat-ps-dev.medium.com/splitting-components-in-react-a-path-to-cleaner-and-more-maintainable-code-f0828eca627c)
- [Techniques for decomposing React components — David Tang (DailyJS)](https://medium.com/dailyjs/techniques-for-decomposing-react-components-e8a1081ef5da)
- [Mastering S.O.L.I.D Principles in React — DEV (drruvari)](https://dev.to/drruvari/mastering-solid-principles-in-react-easy-examples-and-best-practices-142b)

---

## 5. Constants, utils & helpers (extracting non-UI code)

**Key practices**
- Extract magic numbers/strings into constants → single source of truth, clearer intent, i18n-ready, feature flags.
- **Two strategies:** (a) co-locate per component — `Component.constants.ts`, `Component.utils.ts` siblings (keep files <~200 lines); (b) top-level `constants/`, `utils/`, `helpers/` folders. Bundle files are plural (`utils.ts`, `constants.ts`) because they hold many definitions.
- **helpers vs utils distinction (Josh Comeau):** a *helper* is project-specific; a *utility* is a generic abstract function (lodash-style). Utils should be **pure functions** — side effects mean it isn't a util.
- Don't promote code upward unless it's actually shared across multiple components.
- Constants → `UPPER_SNAKE_CASE`; add TS types for safety; isolate UI strings/content.

**Sources**
- [Delightful React File/Directory Structure — Josh W. Comeau](https://www.joshwcomeau.com/react/file-structure/)
- [How to Improve Your ReactJS Code with Constants — Bomberbot](https://www.bomberbot.com/reactjs/how-to-improve-your-reactjs-code-with-constants-an-expert-guide/)
- [React Folder Structure Best Practices [2026] — Robin Wieruch](https://www.robinwieruch.de/react-folder-structure/) (horizontal scaling within component folder)
- [5 React Component Best Practices — Caelin Sutch (Better Programming)](https://betterprogramming.pub/best-practices-i-wish-all-react-developers-knew-part-1-ff6cdee0666a)
- [How to structure files in a large React application — damusnet](https://medium.com/@damusnet/how-to-structure-your-files-in-a-large-react-application-the-solution-99389c64985e)
- [32 React Best Practices — LoginRadius](https://www.loginradius.com/blog/engineering/guest-post/react-best-coding-practices)
- [How to Improve Your ReactJS Code (readability & performance) — freeCodeCamp](https://www.freecodecamp.org/news/improve-reactjs-code/)

---

## 6. Custom hooks (when & how to extract reusable logic)

**Key practices**
- Custom hooks share **stateful logic, not state**. Extract logic by moving it to a third function (hooks are functions).
- **Don't over-abstract early** — long function components are fine; extract when duplication/complexity appears.
- Signal: repeated `useState`/`useEffect` clusters; especially Effects syncing with external systems (wrap to make data flow explicit + prevent dependency creep).
- **"Name test":** if you can't name the hook clearly, it's too coupled to extract yet. A non-coder should guess what it does/takes/returns.
- Rules: `use` + Capital prefix (enables hook rules); single purpose (no `useMount`); keep code pure (re-runs each render); proper cleanup (avoid leaks); careful deps array; minimal internal state; test + document.

**Sources**
- [Reusing Logic with Custom Hooks — react.dev (official)](https://react.dev/learn/reusing-logic-with-custom-hooks)
- [Building Your Own Hooks — legacy React docs](https://legacy.reactjs.org/docs/hooks-custom.html)
- [Refactoring components in React with custom hooks — CodeScene](https://codescene.com/blog/refactoring-components-in-react-with-custom-hooks)
- [Best Practices for Creating Reusable Custom Hooks — DEV (hasancse)](https://dev.to/hasancse/best-practices-for-creating-reusable-custom-hooks-in-react-37nj)
- [Writing Your Own React Hooks: Advanced Patterns — Vinay Billa](https://medium.com/@vinaybilla2021/writing-your-own-react-hooks-advanced-patterns-and-practices-a3ad8768a1a4)
- [Implementing a Custom React Hook: Best Practices — PullRequest/HackerOne](https://www.pullrequest.com/blog/implementing-a-custom-react-hook-best-practices-and-a-practical-example/)
- [React Custom Hooks: Crafting Reusable & Clean Code — DEV (gboladetrue)](https://dev.to/gboladetrue/react-custom-hooks-crafting-reusable-and-clean-code-like-a-pro-3kol)

---

## 7. Naming conventions

**Key practices**
- Components → `PascalCase` (`UserProfile`).
- Functions/variables/event handlers → `camelCase` (`handleClick`, by action not feature).
- Custom hooks → `camelCase` + `use` prefix (`useAuth`).
- Constants → `UPPER_SNAKE_CASE` (`API_URL`); runtime-populated "constants" stay camelCase.
- Types/Interfaces → `PascalCase`. HOCs → `with` prefix. Booleans → `is`/`has`/`should` prefix. CSS classes → `kebab-case`.
- **File naming (contentious):** either match content (`ProductCard.tsx`, `useTheme.ts`) **or** kebab-case everything (`product-card.tsx`) — kebab-case avoids case-insensitive FS conflicts. Pick one, enforce with a linter.
- Supporting files: `.test`/`.spec`, `.module.css`, `.stories`.

**Sources**
- [Naming Conventions in React for Clean & Scalable Code — Sufle.io](https://www.sufle.io/blog/naming-conventions-in-react)
- [React Naming Conventions Simplified — GitHub Gist (kamauwashington)](https://gist.github.com/kamauwashington/4396ea26537e0abd94ac7409998870e9)
- [Naming Conventions Best Practices in React — Rajitha Sanjayamal](https://rajithasanjayamal.medium.com/naming-conventions-best-practices-in-react-37624d020288)
- [Personal React Naming Conventions Guide — 90Pixel](https://blog.90pixel.com/a-personal-guide-to-cleaner-and-consistent-naming-0db39092b2e9)
- [How Should React Files Be Named — Devin Rosario (JS in Plain English)](https://javascript.plainenglish.io/best-practices-how-should-react-files-be-named-682eadc53a0e)
- [Five best practices for React developers in 2026 — Educative](https://www.educative.io/blog/best-practices-react-developer)

---

## 8. Colocation (the cross-cutting principle)

**Key practices**
- Kent C. Dodds: "Place code as close to where it's relevant as possible." Applies to tests, styles, views, and **state**.
- State colocation → fewer top-level re-renders → faster app; keep state as close to use as possible.
- Don't mirror `src/` with a separate `test/` tree — colocate tests next to code.
- Favor longer component names over deep folder nesting; use absolute imports so moving files doesn't break paths.

**Sources**
- [Colocation — Kent C. Dodds](https://kentcdodds.com/blog/colocation)
- [State Colocation will make your React app faster — Kent C. Dodds](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster)
- [File Structure — Epic React (Kent C. Dodds)](https://www.epicreact.dev/modules/welcome-to-epic-react-v1/file-structure)
- [Kent C. Dodds — blog index](https://kentcdodds.com/blog/list)

---

## 9. Next.js (App Router) — architecture & file/folder organization

> Focus: organization/architecture (where to keep things), not runtime performance.

**Key practices**
- Next.js is **unopinionated** about non-route organization — pick a strategy, stay consistent.
- **Colocation is safe by default:** a folder under `app/` only becomes a public route when it has `page.tsx`/`route.ts`. So you can drop `_components`, helpers, styles next to a route without exposing them.
- **Private folders `_folder`:** opt a folder out of routing (e.g. `_components`, `_lib`). Useful to separate UI from routing logic, group internal files, avoid future naming conflicts. Not *required* for colocation, but the popular `_components` convention relies on it.
- **Route groups `(folder)`:** organize routes / apply different layouts without affecting the URL (e.g. `(marketing)`, `(shop)`, `(auth)`). Pitfalls: multiple root layouts cause full page reload on cross-navigation; two groups must not resolve to the same URL.
- **`src/` folder:** separates app code from root config files. Shared `hooks/`, `lib/`, `constants/` live at top level inside `src/`, decoupled from routes.
- **Three official organization strategies:** (1) all app code in root shared folders, `app/` is routing-only; (2) all app code in shared folders inside `app/`; (3) global code at `app/` root + route-specific code colocated in segments. Example folder names (`components`, `lib`) have **no framework significance**.
- **Heuristic:** when in doubt, colocate with the route; globalize only when reused.
- **Feature-Driven Architecture (FDA)** for large apps: `src/features/<name>/` owns `actions/`, `api/`, `components/`, `hooks/`, `lib/`, `queries/`, `services/`, `schemas/`, `stores/`, `types/`, `index.ts` (public exports).
- **Components placement:** route-specific → `_components/`; domain → `features/<name>/components/`; shared primitives → `components/ui/`.
- **`lib/` = pure core**, one-way dependency graph `app → components → lib`; `lib/` must not import from `components`/`app`. Keep client-only `hooks/`/`stores/` separate so the client/server boundary is visible in the filesystem.
- **Server Actions:** colocate with their route/feature (central `lib/actions/` becomes unmanageable past ~50); keep them **thin** (validate → call service → respond); push business logic into a testable `services/` layer. Use API routes for external consumers (webhooks, mobile), Server Actions for UI-triggered writes. Pattern: Server Components read, Server Actions write, Client Components are the interactive surface.
- **Use module path aliases** (`@/components/button`) instead of `../../../`.
- **Anti-patterns:** overloading `app/`; 200+ files in one `components/`; the `utils.ts` "junk drawer"/2000-line black hole; excessive nesting (7 levels deep); `'use client'` at the top of `page.tsx` (push it down to the interactive leaf); premature extraction into packages; circular deps between features.

**Sources**
- [Getting Started: Project Structure — Next.js (official)](https://nextjs.org/docs/app/getting-started/project-structure)
- [Project Organization and File Colocation — Next.js docs](https://nextjs.org/docs/13/app/building-your-application/routing/colocation)
- [File-system conventions: Route Groups — Next.js docs](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)
- [Inside the App Router: Best Practices for File & Directory Structure (2025) — Melvin Prince](https://medium.com/better-dev-nextjs-react/inside-the-app-router-best-practices-for-next-js-file-and-directory-structure-2025-edition-ed6bc14a8da3)
- [Best Practices for Organizing Your Next.js 15 (2025) — DEV (bajrayejoon)](https://dev.to/bajrayejoon/best-practices-for-organizing-your-nextjs-15-2025-53ji)
- [App Router Directory Design: Project Structure Patterns — DEV (pipipi-dev)](https://dev.to/pipipi-dev/app-router-directory-design-nextjs-project-structure-patterns-31eo)
- [How to Organize Your Next.js App with the App Router — Aritra Paul](https://medium.com/@aritrapaulpc/how-to-organize-your-next-js-app-with-the-app-router-best-practices-folder-structures-4bba816df061)
- [Project Structure, Routing, Layouts & File Conventions — Dr. Shahin Siami](https://shahin.page/article/nextjs-project-structure-routing-layouts-file-conventions)
- [Organizing Routes: Private Folders & Project Structure — Shahin Siami](https://shahin.page/article/nextjs-routing-private-folders-and-project-structure)
- [Understanding Route Visibility and Colocation — DEV (Bridget Amana)](https://dev.to/bridget_amana/understanding-route-visibility-and-colocation-in-nextjs-app-router-2bni)
- [Next.js Colocation Template (live demo)](https://next-colocation-template.vercel.app/) · [GitHub (arhamkhnz)](https://github.com/arhamkhnz/next-colocation-template)
- [How to Build Reusable Architecture for Large Next.js Applications — freeCodeCamp](https://www.freecodecamp.org/news/reusable-architecture-for-large-nextjs-applications/)
- [The Next.js Directory Structure That Scales: Technical Layer First — Bitsmiths](https://bitsmiths.studio/blogs/nextjs-directory-structure)
- [Architecting Large-Scale Next.js Applications — DEV (addwebsolution)](https://dev.to/addwebsolutionpvtltd/architecting-large-scale-nextjs-applications-folder-structure-patterns-best-practices-2dpj)
- [Feature Driven Architecture (FDA) for Next.js — Julien Mauclair](https://medium.com/@JMauclair/feature-driven-architecture-fda-a-scalable-way-to-structure-your-next-js-applications-b8c1703a29c0)
- [Next.js 16 App Router Project Structure: Definitive Guide — Makerkit](https://makerkit.dev/blog/tutorials/nextjs-app-router-project-structure)
- [Next.js Project Structure 2026: Scalable Full-Stack Template — GroovyWeb](https://www.groovyweb.co/blog/nextjs-project-structure-full-stack)

---

## Top references to anchor the skill on
1. [react.dev — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) (official)
2. [Robin Wieruch — React Folder Structure [2026]](https://www.robinwieruch.de/react-folder-structure/)
3. [Bulletproof React — GitHub](https://github.com/alan2207/bulletproof-react)
4. [Josh W. Comeau — Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/)
5. [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation)
6. [profy.dev — React Folder Structures & Screaming Architecture](https://profy.dev/article/react-folder-structure)
7. [Next.js — Project Structure (official)](https://nextjs.org/docs/app/getting-started/project-structure)
8. [Makerkit — Next.js App Router Project Structure](https://makerkit.dev/blog/tutorials/nextjs-app-router-project-structure)
