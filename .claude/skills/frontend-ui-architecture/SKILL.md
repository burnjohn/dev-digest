---
name: frontend-ui-architecture
description: "UI and frontend code architecture for React 19 + Next.js 15 App Router + TypeScript — where code belongs, not how to write it. Use whenever placing a new file, naming a folder, deciding whether to extract a component/hook/util, choosing between a colocated `_components/` folder and a shared one, placing constants/types/tests, drawing the `use client` boundary, or reviewing a change that adds directories. Trigger on questions like 'where should this live', 'should I split this component', 'where do constants/utils/helpers/business logic go', 'is this folder structure right', 'feature folder or shared', 'barrel files', 'should this be a hook or a plain function', 'how do I organize this page'. Structural decisions only — for component and hook writing patterns use react-best-practices; for Next.js file conventions and data-fetching mechanics use next-best-practices."
version: 1.0.0
---

# Frontend UI Architecture

Where frontend code belongs and how modules are bounded. Structural decisions
only — placement, splitting, and dependency direction.

**This skill deliberately does not cover** how to write a component or hook
(→ `react-best-practices`), or which Next.js file does what (→
`next-best-practices`). If a question is "is this code correct", it is not this
skill. If it is "does this code live in the right place", it is.

**Frontend only.** For layering on the server — `server/`, `reviewer-core/`,
domain vs application vs infrastructure, the inward dependency rule — use
`onion-architecture`. The two meet at the API contract and nowhere else: this
skill stops at the client's data-access module, that one starts at the route.

## Evidence tags — read these before quoting a rule

Research for this skill found that a large share of widely-repeated frontend
structure advice has **no authoritative source**. Rules are therefore tagged, so
you can tell a documented constraint from a house style and argue accordingly:

- **[DOC]** — stated in a primary source (react.dev, nextjs.org, TanStack, FSD).
  Quotable. Push back hard if violated.
- **[CONV]** — team convention. Defensible and consistent, but negotiable. Never
  present it as an industry rule.
- **[SPLIT]** — credible sources disagree. State the trade-off; do not pick a
  side on the author's behalf.

Full citations for every **[DOC]** claim are in [README.md](README.md).

---

## 1. Where code lives

The framework refuses to decide this for you. Next.js is **unopinionated** about
organization and offers three unranked strategies; the stated criterion is
"choose a strategy that works for you and your team and be **consistent** across
the project" **[DOC]**. Folder names like `components` and `lib` have "**no
special framework significance**" **[DOC]** — so no layout can claim framework
backing, and consistency matters more than which scheme you picked.

The single decision that actually drives placement:

> **How many features use this?** One → it lives with that feature. Two or more
> → it moves up to shared. **[DOC** — Wieruch's promotion rule**]**

This scales down to a rule you can apply without a meeting: **start colocated,
promote on the second consumer.** Moving a file up when a second caller appears
is a cheap, mechanical refactor. Guessing that something will be shared and
parking it in `shared/` on day one is the expensive mistake — it invites
unrelated code to accumulate around it.

### Colocation is safe by default in `app/`

A route is "**not publicly accessible** until a `page.js` or `route.js` file is
added", and even then "only the **content returned** by `page.js` or `route.js`
is sent to the client" **[DOC]**. So project files can sit inside route segments
without becoming routes. Private `_folder` prefixes are explicitly "**not
required** for colocation" **[DOC]** — they buy four separate things:

1. separating UI logic from routing logic,
2. consistent internal organization across the project and the ecosystem,
3. grouping in editors,
4. **avoiding naming conflicts with future Next.js file conventions.**

Reason 4 is the one worth caring about: an unprefixed `components/` folder is a
bet that Next.js never adds that name to its conventions. `_components/` is not.

### Route groups are an architecture tool, not a URL trick

`(group)` folders organize "routes by site section, intent, or **team**" and
enable nested layouts at the same segment level — including **multiple root
layouts**, for "partitioning an application into sections that have a completely
different UI or experience" **[DOC]**. Reach for a route group when:

- a subset of sibling routes should share a layout and the others should not,
- a `loading.tsx` should apply to one route rather than all its siblings,
- a section of the app is owned by a different team or has different chrome.

If you are adding an empty passthrough `layout.tsx` just to scope something, a
route group is probably the construct you actually wanted.

See [placement.md](placement.md) for the full decision table and folder anatomy.

---

## 2. How components split

There is **no authoritative numeric threshold** for component size. React's
official criterion is behavioural: "a component should ideally only be concerned
with one thing. If it ends up growing, it should be decomposed into smaller
subcomponents" **[DOC]**. The docs' own example splits a table header only "if
this header grows to be complex (e.g., if you add sorting)" — **complexity, not
length**.

So lead with responsibility. Ask what the component is *about*; if you need
"and" to answer, that is the split line.

**Numeric triggers are a smell test, not a rule [CONV]:** past ~200 lines or
~5–7 props, look for a second responsibility. Frequently there is one. But a
250-line component doing exactly one thing is fine, and a 40-line component
doing three things should still be split. Never open a review comment with the
line count — open it with the second responsibility, and cite the count only as
corroboration.

The one numeric rule that *is* sourced governs **abstraction, not file length**:
duplication becomes abstraction on the third occurrence — "you can ask yourself
'Haven't I written this before?' two times, but never three" **[DOC]**, under
"**A**void **H**asty **A**bstractions" and Sandi Metz's "prefer duplication over
the wrong abstraction" **[DOC]**. Two copies of similar JSX is not a problem to
solve. Extracting a shared component from two callers with diverging needs is.

---

## 3. Constants, config, and environment

These are three different categories and conflating them is the actual mistake:

| Category | Changes when | Where |
|---|---|---|
| **Constants** — magic numbers, labels, key lists | code changes | with the code that uses them; promote on the second consumer |
| **Config** — feature flags, tunables | deployment changes | a config module, not scattered |
| **Environment** — URLs, secrets, keys | environment changes | `.env` + a single typed accessor |

Name constants after the concept, not the type: a `constants.ts` inside a
component folder is fine because the folder already names the concept; a global
`src/constants/` is not, because nothing names what is inside it.

**Environment separation is enforced, and the failure is silent [DOC]:** only
`NEXT_PUBLIC_`-prefixed variables reach the client — unprefixed ones are
"replaced with **an empty string**". A leaked secret does not throw; it becomes
`""` and the bug surfaces far from the cause. Guard server-side modules with
`import 'server-only'`, which produces a **build-time error** if a Client
Component imports them **[DOC]**.

**Prefer `as const` objects over TypeScript `enum` [DOC]:** numeric enums emit a
bidirectional map and accept arbitrary numbers where the enum type is expected;
enums are **nominally** typed, so a structurally identical enum is rejected —
against TypeScript's "JavaScript with types" premise. Matt Pocock: would not
"add an enum to a fresh codebase"; string enums only if you must.

---

## 4. utils vs helpers vs lib

Name modules by **purpose, not essence** **[DOC]**. FSD names this explicitly
and warns against segments called `components`, `hooks`, or `types` — and
against `lib` degenerating into a utils dump.

The objection is to the **name and the grouping**, never the functions. A
module called `utils` decays for a structural reason: "each person that adds
something that doesn't fit anywhere will happily add it" **[DOC]**. Incohesion
only ever grows, because nothing can be *out of scope* for a folder that has no
scope. `helper`, `util`, `misc`, `common`, `data`, `manager`, `handler` all fail
the same way. Name the theme instead — `format`, `github-urls`, `diff-parse`.

**[SPLIT]** — bulletproof-react, the most-cited React reference layout, ships
both `src/utils/` and a per-feature `utils/`. So this is contested, not settled.
The workable synthesis: placement follows the promotion rule (§1), and the
folder needs a real name once it holds anything beyond trivia. A three-function
`utils.ts` inside one feature folder is not worth a fight; a growing
`src/utils/` is.

---

## 5. Where business logic lives

React answers the most useful version of this question directly: **if a function
does not call hooks, it is not a hook** — `useSorted` should be `getSorted`,
because a plain function "can be called anywhere, including conditions"
**[DOC]**. That one test resolves most placement disputes. Pure domain logic —
computation, derivation, formatting, validation rules — is plain functions,
which are also the cheapest thing to test.

Reserve hooks for logic that genuinely needs React: state, effects, context,
subscriptions. Even then, "keep custom Hooks focused on concrete high-level use
cases" — `useMount`, `useEffectOnce`, `useUpdateEffect` are named
anti-patterns **[DOC]** — and "you don't need to extract a custom Hook for every
little duplicated bit of code. Some duplication is fine" **[DOC]**.

**Data access and authorization belong in a server-only Data Access Layer**
**[DOC]** — a module that consolidates access, authorizes, and returns minimal
DTOs, rather than logic sitting in components. Every exported `"use server"`
function is a public HTTP endpoint reachable by direct POST, so **validation and
authorization go inside the action or the DAL**, never in the calling component
**[DOC]**. Zod validation runs server-side in the action **[DOC]**.

Do not route Server Component reads through your own `/api` handler — both run
on the server and the HTTP call is a wasted hop **[DOC]**. Put the logic in a
module and call it from both the Server Component and any public route.

**Not covered here, on purpose:** whether hooks may hold "business logic" at
all, and clean/hexagonal architecture on the frontend, are blog-tier debates
with no primary source on either side. Left out rather than dressed up as
guidance — see README.md § "Round 2 — what was NOT found".

---

## 6. Types and tests

**Colocate tests** next to the code they test rather than mirroring `src/` into
a `__tests__/` tree **[DOC]**. Four reasons: newcomers see them, they read as
documentation, they prompt updates when the code changes, and they do not
survive as orphans when the component is deleted. That last one is the
strongest — a mirrored tree accumulates tests for code that no longer exists.

**Types follow the promotion rule like anything else [CONV]** — Kent C. Dodds'
colocation post is frequently cited for type placement but says nothing about
it, so do not claim a source. Types describing one module live with it; types
describing a contract between packages live in the shared contract package and
are never redeclared downstream.

---

## 7. State placement

Server state and client state are different categories. React Query "assumes
that the frontend application doesn't **own** the data" — the app holds a
snapshot **[DOC]**. The failure mode it names is "fetch once, distribute
globally, rarely update". Copying server state into `useState` recreates exactly
that, and the copy has no invalidation story.

Structural placement for App Router **[DOC]**:

- `QueryClientProvider` in a `"use client"` providers module — it relies on
  context, which Server Components do not support.
- `prefetchQuery` in the Server Component.
- `HydrationBoundary` wrapping the client consumers.
- Query hooks per feature (`useTodos()`), so the fetching function is not
  reached for twice. Do **not** restrict `useQuery` to container components —
  "smart vs dumb" is explicitly outdated **[DOC]**.

Render providers "**as deep as possible in the tree**" — wrap `{children}`, not
`<html>` **[DOC]**, so the static parts of Server Components stay optimizable.

---

## 8. Module boundaries

**`"use client"` marks an entry point, not a component.** It "declares a
**boundary** between the Server and Client module graphs", and "once a file is
marked, **all of its imports and the components it directly renders** are
included in the client bundle" — so "you don't need to add the directive to
every component" **[DOC]**. Structure, not semantics, decides what ships.

The exception that makes composition possible: the rule "**does not apply to
Server Components passed as children or other props**" — those are rendered on
the server and passed as output **[DOC]**. This is why a server-rendered
`<Cart />` can sit inside a client-stateful `<Modal>`. When a client wrapper
threatens to pull a subtree client-side, pass the subtree as `children`.

Push the boundary **down** to specific interactive components rather than
marking large parts of the UI client **[DOC]** — the `<Layout>` stays server
while `<Search />` alone goes client.

**Dependency direction should be one-way** and is worth enforcing mechanically
rather than in review. bulletproof-react: "code should flow in one direction,
from shared parts of the code to the application (`shared → features → app`)",
via ESLint `import/no-restricted-paths` **[DOC]**. Cross-feature imports are
where feature folders rot — compose features at the app level instead **[DOC]**.

**Barrel files — split the case in two [SPLIT]:**

- A narrow, hand-written `index.ts` re-exporting a folder's public API is
  defensible: it hides internals and gives the folder a contract.
- `export *` chains are not. Cross-boundary tree-shaking "does not currently
  work with barrel files" **[DOC]**, and a barrel that `export *`s client hooks
  into a Server Component can **fail the build outright** **[DOC]**.

So the rule is about *what* the barrel exports, not whether barrels exist.
Never `export *`; never re-export client hooks through a barrel a Server
Component imports.

See [boundaries.md](boundaries.md) for enforcement config and the RSC boundary
decision tree.

---

## Reviewing structure

When reviewing a change that adds files, in order:

1. **Does anything sit above its only consumer?** Premature sharing is the most
   common and most expensive structural defect.
2. **Does a folder name state a purpose?** `utils`, `helpers`, `common`, `misc`
   describe essence, not purpose.
3. **Did the client boundary move up?** A `"use client"` added to a layout or
   page usually means a leaf should have taken it instead.
4. **Does an import cross sideways** between features, or upward from shared?
5. **Do new barrels `export *`,** or re-export client hooks?
6. **Are constants, config, and env conflated** in one module?
7. **Are tests colocated** with what they test?

Lead findings with the structural consequence, not the rule name — "this is
imported by one page, so it can live beside it" travels further than "violates
the promotion rule". Cite **[DOC]** rules by source when someone disagrees, and
say plainly when a rule is **[CONV]**.

---

## Files

- [placement.md](placement.md) — placement decision table, folder anatomy, worked layouts
- [boundaries.md](boundaries.md) — RSC boundary decision tree, ESLint enforcement, barrels
- [dev-digest.md](dev-digest.md) — how these rules map onto this repo's `client/`
- [README.md](README.md) — full annotated bibliography, source disagreements, what research did *not* find
