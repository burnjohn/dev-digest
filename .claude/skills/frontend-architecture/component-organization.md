# Component Organization

How to split components, where business logic lives, and when to extract custom hooks.
This is about *placement and boundaries* — not React API mechanics.

## Contents
- [Splitting components (SRP)](#splitting-components-srp)
- [Composition techniques](#composition-techniques)
- [Where business logic lives (layering)](#where-business-logic-lives-layering)
- [Extracting custom hooks](#extracting-custom-hooks)

## Splitting components (SRP)

A component should have **one reason to change**.

**Signals to split:**
- You describe it with "and" ("renders the list *and* fetches *and* validates").
- You must edit component A to change the behavior of component B.
- A "god component" that fetches + transforms + holds state + renders.
- The file grows past ~200 lines or mixes unrelated concerns.

**Signals you've split too far:**
- Tiny components that only forward props and add a layer of indirection.
- More files than the feature's complexity warrants.

Split for *responsibility*, not for line count alone. Group closely-related components in one directory.

## Composition techniques

1. **Extract real sub-components** — promote chunks of JSX to named components (not inline sub-render methods, which keep state/props tangled).
2. **Separate fetching from presentation** — a hook (`useReview`) fetches; a presentational component renders the data it's handed and knows nothing about fetching.
3. **`children` / slot props** — pass elements (not just data) to build flexible template components. Reserve `children` for the main content area; use named element props for slots (`header`, `actions`).
4. **HOCs** — only for genuinely cross-cutting, generic concerns (auth, theming). Prefer hooks/composition first.

```tsx
// Good: a layout component owns arrangement; callers own content.
<SplitPane left={<FileTree />} right={<DiffView />} />

// Good: fetching in a hook, rendering in a dumb component.
function ReviewPanel({ id }) {
  const { data, isLoading } = useReview(id);   // React-specific logic
  if (isLoading) return <Spinner />;
  return <ReviewView review={data} />;          // pure presentation
}
```

## Where business logic lives (layering)

Map each kind of code to a layer, then to a folder:

| Kind of code | Goes in | Notes |
|---|---|---|
| Pure UI rendering | component | dumb/presentational |
| React state, effects, data-fetching wiring | custom hook | the "smart" layer |
| Framework-agnostic rules / calculations | plain function (`*.utils.ts`, a `domain`/`use-cases` module) | testable without React; portable across frameworks |
| Backend/API I/O | `services/` (or feature `api/`) | keeps components declarative |

```
component (UI)  →  hook (React glue)  →  pure functions (rules)
                                      →  services (I/O)
```

**Caveat — don't over-engineer:** this separation only pays off when real logic exists. A single API request or a one-line transform doesn't need three layers. There is no universal consensus here; apply judgment proportional to the logic's complexity.

The predecessor pattern is **container/presentational** (smart/dumb): a container wires data + handlers and passes them down to a presentational component. Custom hooks largely replace the container.

## Extracting custom hooks

Custom hooks are the primary tool for moving stateful logic *out* of components. This section covers
**when/where to extract** organizationally — for hook *rules* and misuse, defer to `react-best-practices`.

**When to extract:**
- Repeated `useState`/`useEffect` clusters across components.
- An Effect that synchronizes with an external system — wrap it so the data flow is explicit (`url in → data out`) and callers can't bolt on unrelated dependencies.
- The component reads as implementation detail instead of intent.

**When NOT to extract:**
- Don't abstract early. A longer function component is fine; extract when duplication or genuine complexity appears, not preemptively.
- Don't create grab-bag hooks like `useMount` — keep one concern per hook.

**The "name test":** if you can't give the hook a clear name, it's too coupled to extract yet. A good name lets even a non-coder guess what it does, takes, and returns (`useOnlineStatus`, `useReviewRun`).

**Placement:** colocate a hook with its only consumer (`ReviewPanel/useReview.ts` or feature `hooks/`); promote to top-level `hooks/` only when shared across features.
