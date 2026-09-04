# Component Organization

## Type-based vs. feature-based structure

The traditional layout groups files by **technical type**:

```
src/
  components/
  hooks/
  utils/
  services/
```

This works for small apps, but as an app grows, working on one feature means jumping between four or five unrelated top-level folders, and it becomes unclear which `components/Button.tsx` files are truly shared vs. only used by one screen.

The alternative — now the mainstream recommendation for anything beyond a small app — groups by **feature/domain**:

```
src/
  features/
    checkout/
      components/
      hooks/
      services/
      types/
      constants.ts
    user-profile/
      components/
      hooks/
      ...
  components/     # only genuinely shared UI primitives
  hooks/          # only genuinely shared hooks
  lib/
  types/
```

Rule of thumb: **if deleting a feature folder should not break any other feature**, the structure is doing its job. That's the "self-containment" test bulletproof-react uses.

## bulletproof-react

[bulletproof-react](https://github.com/alan2207/bulletproof-react) is the most-cited production-oriented React architecture guide. Its core rules:

- Code lives in `src/features/<feature>/`, each feature containing everything specific to it.
- `src/components/` is reserved for components reused across features — everything else moves into a feature folder.
- Imports flow **one direction only**: `shared → features → app`. A shared component must never import from a feature; a feature must never import from another feature directly (compose at the app/page level instead).
- See [project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) and [project-standards.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md) for the full breakdown.

## Feature-Sliced Design (FSD)

[Feature-Sliced Design](https://feature-sliced.design/) is a more formal methodology aimed at the same problem, organized as a 3D grid:

- **Layers** (top-down, by scope of influence): `app → pages → widgets → features → entities → shared`.
- **Slices** (within a layer, by domain): e.g. `auth`, `cart`, `product`.
- **Segments** (within a slice, by technical purpose): `ui`, `model`, `api`, `lib`.

A higher layer can import from a lower one, never the reverse. FSD ships a linter and CLI generators to enforce this, which makes it a good fit for larger teams that want the rules machine-checked rather than relying on code review. For most mid-sized apps, bulletproof-react's lighter convention is enough; reach for FSD when the team needs enforced boundaries.

## Container/Presentational split

A classic and still-useful mental model:

- **Container** ("smart") components: fetch data, hold state, own side effects.
- **Presentational** ("dumb") components: pure functions of their props — no API calls, no direct state ownership, easy to test and reuse.

This doesn't require literal separate files for every small component — plenty of components are fine doing both in one file. It becomes a real split when a component is growing and doing both jobs at once: that's the seam to cut along, usually by extracting the "container" half into a custom hook (see `constants-utils-services.md`) and leaving a purely presentational component behind.

## Composition over configuration

Kent C. Dodds' [Advanced React Patterns](https://github.com/kentcdodds/advanced-react-patterns) is the canonical reference for this. Two patterns worth knowing:

- **Compound components** — a parent component plus child components that share implicit state through context, mirroring how `<select>`/`<option>` work together in HTML. Prefer this over one component with a dozen boolean/config props.
- **"Lift content up"** — pass `children`/render props instead of forcing a wrapper component to know about everything it might need to render. Reduces prop-drilling and keeps components decoupled from what they wrap.

## Practical folder conventions

- One component per file (small, purely internal helper components colocated in the same file are fine).
- Colocate a component's tests, styles, and `*.types.ts` next to it, not in a parallel `__tests__/`/`styles/`/`types/` tree at the project root.
- [Robin Wieruch's folder-structure guide](https://www.robinwieruch.de/react-folder-structure/) documents this as a *progression*, not a one-time decision: start flat, group by type once you have a handful of components, regroup by feature once the app has multiple distinct domains. Don't over-structure a small app preemptively — but don't leave a growing app on the type-based structure either.

## Sources

- [bulletproof-react (GitHub)](https://github.com/alan2207/bulletproof-react)
- [bulletproof-react — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
- [bulletproof-react — project-standards.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md)
- [Feature-Sliced Design — official docs](https://feature-sliced.design/)
- [Feature-Sliced Design — GitHub](https://github.com/feature-sliced/documentation)
- [Robin Wieruch — React Folder Structure Best Practices](https://www.robinwieruch.de/react-folder-structure/)
- [Container/Presentational Pattern (Vitor Britto)](https://medium.com/@vitorbritto/react-design-patterns-the-container-presentational-pattern-775b91aa0c49)
- [Kent C. Dodds — Advanced React Patterns (GitHub)](https://github.com/kentcdodds/advanced-react-patterns)
- [React Docs — Thinking in React](https://react.dev/learn/thinking-in-react)
