# Placement

Read when deciding where a new file goes, or auditing a folder that has grown
awkward. Evidence tags (**[DOC]** / **[CONV]** / **[SPLIT]**) are defined in
[SKILL.md](SKILL.md); citations are in [README.md](README.md).

## Contents

- [The one question](#the-one-question)
- [Decision table](#decision-table)
- [Component folder anatomy](#component-folder-anatomy)
- [Promotion and demotion](#promotion-and-demotion)
- [Named layouts, and when they earn their keep](#named-layouts-and-when-they-earn-their-keep)
- [Naming](#naming)

---

## The one question

> **How many things use this?**

One consumer → it lives with that consumer. Two or more → it moves up to the
nearest ancestor both can reach **[DOC]**.

Everything else on this page is an elaboration. The rule works because it is
*observable* — you can answer it with a grep, today, instead of predicting
whether something will be reused later. Predictions are wrong often enough that
a wrong one costs more than the move would have.

Note the asymmetry that makes "start colocated" the safe default:

| Mistake | Cost to fix |
|---|---|
| Colocated, turns out to be shared | Move the file, update 2 imports. Mechanical. |
| Shared, turns out to be used once | Nothing forces the fix. It stays, and unrelated code accumulates around it. |

Only one of these self-corrects. Bias toward the recoverable error.

---

## Decision table

| What you are placing | Used by | Goes |
|---|---|---|
| Component | one route | `app/<route>/_components/<Name>/` |
| Component | one component | `<Parent>/_components/<Name>/` |
| Component | 2+ routes | `src/components/<name>/` |
| Component | 2+ apps or packages | shared UI package |
| Constant | one component | `constants.ts` in that folder |
| Constant | one feature | `constants.ts` at the feature root |
| Constant | 2+ features | a *named* module — `src/lib/<theme>.ts`, never `src/constants/` |
| Pure function | one component | `helpers.ts` in that folder |
| Pure function | 2+ features | `src/lib/<theme>.ts` — name the theme, not "utils" |
| Hook (calls hooks) | one feature | `hooks/` in that feature |
| Hook (calls hooks) | 2+ features | `src/lib/hooks/` |
| Function that calls no hooks | anywhere | **not a hook** — plain function, `getX` not `useX` **[DOC]** |
| Data access | any | the data-access module; never `fetch` in a component **[DOC]** |
| Type for one module | — | beside it |
| Type crossing packages | — | the shared contract package; never redeclared **[CONV]** |
| Test | — | beside the file it tests **[DOC]** |
| Route-scoped layout | subset of siblings | a `(group)` route group **[DOC]** |

When two rows seem to apply, the more specific consumer wins. A constant used by
one component inside a shared feature belongs to the component, not the feature.

---

## Component folder anatomy

A folder per component, named for the component, holding everything that changes
when it changes **[CONV]**:

```
FindingsCell/
├── FindingsCell.tsx        # the component
├── FindingsCell.test.tsx   # colocated test          [DOC]
├── constants.ts            # only this component's constants
├── helpers.ts              # pure functions, no React
├── styles.ts               # style objects/variants
├── index.ts                # narrow public API — named exports only  [SPLIT]
└── _components/            # subcomponents used only by this one
    └── FindingsRow/
```

Why a folder rather than a flat file: the folder gives the constants and helpers
a *scope*. `constants.ts` needs no further naming because `FindingsCell/`
already names the concept — which is exactly why a global `src/constants/` fails
the purpose-not-essence rule **[DOC]** and this does not.

Nesting `_components/` recursively is fine and mirrors the component tree. It
also makes the promotion rule visible: a subcomponent that starts being imported
from two places physically cannot stay where it is without an upward import.

Do not create the empty ceremony. A component with no constants needs no
`constants.ts`. Files appear when they have content.

### `index.ts` — narrow, hand-written, named **[SPLIT]**

```ts
// good — explicit contract, internals stay private
export { FindingsCell } from "./FindingsCell";
export type { FindingsCellProps } from "./FindingsCell";

// bad — defeats tree-shaking [DOC], and can break the build if it
// re-exports client hooks into a Server Component's import path [DOC]
export * from "./FindingsCell";
export * from "./helpers";
```

The value of a barrel is *encapsulation*: callers import the folder, not its
internals, so internals can be rearranged freely. That value comes from the
export list being deliberate. `export *` gives up the encapsulation and keeps
only the cost.

---

## Promotion and demotion

**Promote** when a second consumer appears — at that moment, not before:

1. Move the folder to the nearest ancestor both consumers can reach.
2. Update imports.
3. Check what came with it. Constants and helpers that only the original
   consumer used should stay behind, not ride along into shared space. This step
   is the one people skip, and it is how shared folders fill with private detail.

**Demote** when a shared module's callers drop to one. This is real work that
nobody schedules, so do it opportunistically: if you are already editing a
shared module and notice it has a single caller, move it down while you are
there. A `src/components/` entry with one importer is a colocated component that
lost its way.

To find candidates:

```sh
# how many files import a given module (adjust the path)
rg -l "from ['\"].*components/run-cost-badge" --glob '!node_modules' src | wc -l
```

---

## Named layouts, and when they earn their keep

Route groups exist for organization and cost nothing at runtime **[DOC]**. Reach
for one when:

| Situation | Construct |
|---|---|
| Some siblings share chrome, others must not | `(group)/layout.tsx` |
| A `loading.tsx` should scope to one route, not all siblings | `(group)/loading.tsx` |
| A section has entirely different UI — marketing vs app | multiple root layouts, one per group **[DOC]** |
| Routes are owned by different teams | `(group)` per section **[DOC]** |

```
app/
├── (marketing)/
│   ├── layout.tsx        # its own root layout: <html>/<body> required  [DOC]
│   └── page.tsx          # → /
└── (app)/
    ├── layout.tsx        # nav, breadcrumbs
    ├── repos/page.tsx    # → /repos
    └── settings/page.tsx # → /settings
```

The tell that you needed a group: you are adding a `layout.tsx` that renders
nothing but `{children}`, purely to create a nesting level.

---

## Naming

Name by **purpose, not essence** **[DOC]**. Essence names describe what the code
*is* (a component, a hook, a type, a utility); purpose names describe what it is
*for*. Essence names cannot exclude anything, so they cannot stay coherent.

| Avoid | Prefer | Because |
|---|---|---|
| `utils/`, `helpers/`, `common/`, `misc/` | `format/`, `github-urls/`, `diff-parse/` | nothing is out of scope for a folder with no scope **[DOC]** |
| `src/constants/` | constants beside their consumer, or `src/lib/<theme>.ts` | the folder names no concept |
| `src/types/` as a default | types beside their module | a type usually belongs to one module |
| `data/`, `manager/`, `handler/`, `processor/` | the domain noun | these are essence names too **[DOC]** |

A shared folder passes the test if you can finish the sentence "this holds
everything about ___" — and if a plausible new file could be *rejected* from it.
If nothing can be rejected, the name is wrong.

`lib/` is the one conventional exception **[CONV]** — it is understood as
"preconfigured third-party integrations and cross-cutting primitives" rather
than a dumping ground, *provided* the files inside it carry thematic names.
`src/lib/format.ts` is fine. `src/lib/utils.ts` reintroduces the problem one
level down, which is exactly the decay FSD warns about **[DOC]**.
