# frontend-architecture

**Version:** 1.0.0 · **Scope:** Frontend (React / Next.js) · **Last updated:** 2026-06-18

Human-facing documentation for the `frontend-architecture` skill: what it is for, what it covers,
how it differs from neighboring skills, and the sources behind every rule. The agent-facing
instructions live in [SKILL.md](SKILL.md) and the reference files.

> Note on conventions: the skill-creator guide normally discourages a per-skill README. This one is
> kept intentionally, by request, to hold the version, scope, the cross-skill boundary, and the full
> source bibliography in one place. All *agent-consumed* guidance still lives in `SKILL.md` + reference files.

## Focus

Decide **where frontend code lives** and **how it is structured** — the "which file/folder does this
belong in, and how do I split it?" question. It is deliberately about architecture and organization,
**not** runtime performance, not a React anti-pattern catalog, and not Next.js rendering mechanics.

## What it covers

| Area | File |
|------|------|
| Core principles + decision framework + cross-skill routing | [SKILL.md](SKILL.md) |
| Folder structure strategies (flat / type / feature / FSD), colocation, naming, constants/utils/helpers placement | [folder-structure.md](folder-structure.md) |
| Splitting components (SRP/composition), business-logic layering, extracting custom hooks (organizational angle) | [component-organization.md](component-organization.md) |
| Next.js App Router organization (route groups, private folders, `src/`, feature-driven, where `lib`/server actions live) | [nextjs-organization.md](nextjs-organization.md) |

## Intended use cases (triggers)

- "Where should I put this component / hook / constant / util / type?"
- "How do I split this large component / file?"
- "Which folder structure should this project use?" / restructuring an existing one.
- "Where does business logic go?" (component vs hook vs pure function vs service)
- File and component naming decisions.
- Organizing a Next.js App Router app: route groups, private `_folders`, where server actions and `lib` belong.

## Relationship to other skills (how to tell them apart)

| Skill | Owns | This skill defers to it when… |
|-------|------|-------------------------------|
| **react-best-practices** | React anti-patterns, hooks rules, state-management correctness | the question is "is this usage correct/idiomatic?" rather than "where does it go?" |
| **vercel-react-best-practices** | Runtime performance, re-renders, bundle size | the goal is making code faster, not organizing it |
| **next-best-practices** | RSC boundaries, data fetching, metadata, async APIs, route-handler mechanics | the question is "server vs client / how to fetch" rather than "which folder/file" |
| **typescript-expert** | Type-level programming, tooling, migrations | the question is about types themselves, not module placement |
| **react-testing-library** | How to write component/hook tests | writing the tests, not deciding where test files live |

Boundary in one line: **this skill places code; the others implement it.** They compose — use together on mixed tasks.

## Sources

All practices are grounded in the following research (collected 2026-06-17). Full annotated notes:
[`docs/react-frontend-best-practices-sources.md`](../../../docs/react-frontend-best-practices-sources.md).

### Folder / project structure
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
- [3 Folder Structures in React… Why Feature-Based — Asrul Kadir](https://asrulkadir.medium.com/3-folder-structures-in-react-ive-used-and-why-feature-based-is-my-favorite-e1af7c8e91ec)
- [Mastering React Folder Structures — Deltaromeoyanki](https://medium.com/@deltaromeoyanki/mastering-react-folder-structures-your-ultimate-guide-to-scalable-and-maintainable-projects-5e200d630025)
- [react-folder-structures — GitHub (balajidharma)](https://github.com/balajidharma/react-folder-structures)

### Business logic & separation of concerns
- [Separation of concerns with React hooks — Felix Gerschau](https://felixgerschau.com/react-hooks-separation-of-concerns/)
- [Separating responsibilities using Hooks — Sairys](https://sairys.medium.com/react-separating-responsibilities-using-hooks-b9c90dbb3ab9)
- [Path To A Clean(er) React Architecture pt.6 — Business Logic Separation — profy.dev](https://profy.dev/article/react-architecture-business-logic-and-dependency-injection)
- [Separating Business Logic from UI Components in React 18 — Israel (Bootcamp)](https://medium.com/design-bootcamp/separating-%EF%B8%8F-business-logic-from-ui-components-in-react-18-aa1775b3caba)
- [React Separation of Concern — Mehul Thakkar](https://mehulcse.com/blogs/react-separation-of-concern)
- [Why Separating Business Logic From Components Matters — Asrul Kadir](https://asrulkadir.medium.com/why-separating-business-logic-from-components-matters-in-react-applications-5dbe2c71a2ba)
- [Where to Write Business Logic in React — Filippo Rivolta (Stackademic)](https://medium.com/@rivoltafilippo/where-to-write-business-logic-in-react-separation-of-concers-for-frontend-interviews-59283b5d4b27)
- [Best Practices for Keeping React UI and Logic Separate — DhiWise](https://www.dhiwise.com/post/mastering-the-art-of-separating-ui-and-logic-in-react)

### Splitting components (SRP & composition)
- [Single Responsibility in ReactJS — Roni Shabo](https://medium.com/@roni.shabo/single-responsibility-in-reactjs-9c60e4163862)
- [Splitting a UI into Components: Six Pillars of Component Architecture — Abbas Roholamin](https://medium.com/@abbas-roholamin/splitting-a-ui-into-components-in-react-six-pillars-of-component-architecture-04538e542ce5)
- [Single Responsibility Principle in React — cekrem.github.io](https://cekrem.github.io/posts/single-responsibility-principle-in-react/)
- [7 Architectural Attributes of a Reliable React Component — Dmitri Pavlutin](https://dmitripavlutin.com/7-architectural-attributes-of-a-reliable-react-component/)
- [Single Responsibility Principle in React — DEV (mikhaelesa)](https://dev.to/mikhaelesa/single-responsibility-principle-in-react-10oc)
- [Splitting Components in React — Thiraphat Phutson](https://thiraphat-ps-dev.medium.com/splitting-components-in-react-a-path-to-cleaner-and-more-maintainable-code-f0828eca627c)
- [Techniques for decomposing React components — David Tang (DailyJS)](https://medium.com/dailyjs/techniques-for-decomposing-react-components-e8a1081ef5da)
- [Mastering S.O.L.I.D Principles in React — DEV (drruvari)](https://dev.to/drruvari/mastering-solid-principles-in-react-easy-examples-and-best-practices-142b)

### Constants, utils & helpers
- [Delightful React File/Directory Structure — Josh W. Comeau](https://www.joshwcomeau.com/react/file-structure/)
- [How to Improve Your ReactJS Code with Constants — Bomberbot](https://www.bomberbot.com/reactjs/how-to-improve-your-reactjs-code-with-constants-an-expert-guide/)
- [5 React Component Best Practices — Caelin Sutch (Better Programming)](https://betterprogramming.pub/best-practices-i-wish-all-react-developers-knew-part-1-ff6cdee0666a)
- [How to structure files in a large React application — damusnet](https://medium.com/@damusnet/how-to-structure-your-files-in-a-large-react-application-the-solution-99389c64985e)
- [32 React Best Practices — LoginRadius](https://www.loginradius.com/blog/engineering/guest-post/react-best-coding-practices)
- [How to Improve Your ReactJS Code (readability & performance) — freeCodeCamp](https://www.freecodecamp.org/news/improve-reactjs-code/)

### Custom hooks (extraction)
- [Reusing Logic with Custom Hooks — react.dev (official)](https://react.dev/learn/reusing-logic-with-custom-hooks)
- [Building Your Own Hooks — legacy React docs](https://legacy.reactjs.org/docs/hooks-custom.html)
- [Refactoring components in React with custom hooks — CodeScene](https://codescene.com/blog/refactoring-components-in-react-with-custom-hooks)
- [Best Practices for Creating Reusable Custom Hooks — DEV (hasancse)](https://dev.to/hasancse/best-practices-for-creating-reusable-custom-hooks-in-react-37nj)
- [Writing Your Own React Hooks: Advanced Patterns — Vinay Billa](https://medium.com/@vinaybilla2021/writing-your-own-react-hooks-advanced-patterns-and-practices-a3ad8768a1a4)
- [Implementing a Custom React Hook: Best Practices — PullRequest/HackerOne](https://www.pullrequest.com/blog/implementing-a-custom-react-hook-best-practices-and-a-practical-example/)
- [React Custom Hooks: Crafting Reusable & Clean Code — DEV (gboladetrue)](https://dev.to/gboladetrue/react-custom-hooks-crafting-reusable-and-clean-code-like-a-pro-3kol)

### Naming conventions
- [Naming Conventions in React for Clean & Scalable Code — Sufle.io](https://www.sufle.io/blog/naming-conventions-in-react)
- [React Naming Conventions Simplified — GitHub Gist (kamauwashington)](https://gist.github.com/kamauwashington/4396ea26537e0abd94ac7409998870e9)
- [Naming Conventions Best Practices in React — Rajitha Sanjayamal](https://rajithasanjayamal.medium.com/naming-conventions-best-practices-in-react-37624d020288)
- [Personal React Naming Conventions Guide — 90Pixel](https://blog.90pixel.com/a-personal-guide-to-cleaner-and-consistent-naming-0db39092b2e9)
- [How Should React Files Be Named — Devin Rosario (JS in Plain English)](https://javascript.plainenglish.io/best-practices-how-should-react-files-be-named-682eadc53a0e)
- [Five best practices for React developers in 2026 — Educative](https://www.educative.io/blog/best-practices-react-developer)

### Colocation
- [Colocation — Kent C. Dodds](https://kentcdodds.com/blog/colocation)
- [State Colocation will make your React app faster — Kent C. Dodds](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster)
- [File Structure — Epic React (Kent C. Dodds)](https://www.epicreact.dev/modules/welcome-to-epic-react-v1/file-structure)
- [Kent C. Dodds — blog index](https://kentcdodds.com/blog/list)

### Next.js (App Router) organization
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

## Changelog

- **1.0.0** (2026-06-18) — Initial release: core principles + decision framework, folder structure, component organization, Next.js App Router organization.
