# Boundaries

Read when drawing the server/client line, wiring import rules, or diagnosing a
module that ended up on the wrong side. Evidence tags are defined in
[SKILL.md](SKILL.md); citations in [README.md](README.md).

## Contents

- [The RSC boundary](#the-rsc-boundary)
- [Keeping the boundary low](#keeping-the-boundary-low)
- [Enforced boundaries](#enforced-boundaries)
- [Import direction](#import-direction)
- [Barrels](#barrels)
- [Diagnosing](#diagnosing)

---

## The RSC boundary

`"use client"` "declares a **boundary** between the Server and Client module
graphs" **[DOC]**. Two consequences that people get wrong in opposite
directions:

**It spreads through imports.** "Once a file is marked, **all of its imports and
the components it directly renders** are included in the client bundle" — so
"you don't need to add the directive to every component" **[DOC]**. It marks an
*entry point*. Sprinkling it on every file is noise; what matters is which file
is highest.

**It does not spread through `children`.** The rule "**does not apply to Server
Components passed as children or other props**" — those "are rendered on the
server and passed to the Client Component as rendered output" **[DOC]**. This is
the single most useful structural fact in App Router architecture: a client
component can *wrap* server-rendered content without absorbing it.

```tsx
// modal.tsx — client, owns the open/closed state
"use client";
export default function Modal({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

// page.tsx — server. <Cart /> stays a Server Component.
export default function Page() {
  return (
    <Modal>
      <Cart />   {/* rendered on the server, passed in as output [DOC] */}
    </Modal>
  );
}
```

Compare the version that fails: if `Modal` *imported* `Cart` and rendered it
itself, `Cart` would join the client graph. Same tree on screen, different
architecture. When a client wrapper threatens to pull a subtree across, pass the
subtree in rather than importing it.

A component must be client when it needs — verbatim list **[DOC]** — state and
event handlers, lifecycle logic, browser-only APIs, or **custom hooks**. Note
the last one: adding a hook call to a shared component moves it, and everything
importing it, across the boundary.

---

## Keeping the boundary low

"Add `'use client'` to **specific interactive components** instead of marking
large parts of your UI as Client Components" **[DOC]**. The canonical shape —
the layout stays server, one leaf goes client:

```tsx
// layout.tsx — Server Component
import Logo from "./logo";      // server
import Search from "./search";  // client — only this leaf

export default function Layout({ children }) {
  return (
    <>
      <nav><Logo /><Search /></nav>
      <main>{children}</main>
    </>
  );
}
```

Providers are the common exception, since context is unsupported in Server
Components **[DOC]**. Even then, render them "**as deep as possible in the
tree**" — wrap `{children}`, not `<html>` **[DOC]**, so the static parts of the
server tree remain optimizable.

Third-party components that use client features but ship no directive: wrap them
in your own one-line `"use client"` re-export module rather than making the
consumer a Client Component **[DOC]**.

---

## Enforced boundaries

Prefer boundaries the toolchain checks over boundaries stated in a doc — the
latter erode silently.

| Boundary | Enforcement | Failure mode if unenforced |
|---|---|---|
| Server-only module | `import 'server-only'` → **build error** **[DOC]** | secret-bearing module imported client-side |
| Client-only module | `import 'client-only'` | `window` access during SSR |
| Public env var | `NEXT_PUBLIC_` prefix | **silent** — unprefixed vars become `""` **[DOC]** |
| Layer direction | ESLint `import/no-restricted-paths` **[DOC]** | cross-feature coupling |
| `process.env` confined to the data layer | **audit only**, not a compiler check **[DOC]** | drift |

The `NEXT_PUBLIC_` row deserves emphasis: the failure is not an error. The value
becomes an empty string and the symptom appears somewhere unrelated. Any module
touching secrets should carry `import 'server-only'` so the mistake becomes a
build failure instead of a runtime mystery.

Installing the `server-only` / `client-only` packages is optional in Next.js —
handling is internal **[DOC]** — but install them if your lint rules flag
extraneous dependencies.

---

## Import direction

Dependencies should flow one way: "code should flow in one direction, from
shared parts of the code to the application (`shared → features → app`)"
**[DOC]**. Cross-feature imports are where feature folders rot — compose
features at the app level instead **[DOC]**.

```js
// eslint.config.mjs
{
  rules: {
    "import/no-restricted-paths": ["error", {
      zones: [
        // features may not reach into app
        { target: "./src/features", from: "./src/app" },
        // shared may not reach into features or app
        { target: "./src/components", from: "./src/features" },
        { target: "./src/components", from: "./src/app" },
        { target: "./src/lib",        from: "./src/features" },
        { target: "./src/lib",        from: "./src/app" },
      ],
    }],
  },
}
```

For sibling isolation — feature A must not import feature B — `import/no-restricted-paths`
zones become unwieldy; `eslint-plugin-boundaries` handles element types and
sibling rules directly **[DOC]**. FSD projects have `steiger` and
`@feature-sliced/eslint-config`, which split the same idea into
`no-higher-level-imports` and `no-cross-imports` **[DOC]**.

Turn these on early. Retrofitting a direction rule onto a codebase that has been
importing sideways for a year means a large, unrewarding refactor — which is why
it usually does not happen.

---

## Barrels

Two different things wear the same name **[SPLIT]**.

**Defensible** — a narrow, hand-written public API:

```ts
export { DiffViewer } from "./DiffViewer";
export type { DiffViewerProps } from "./DiffViewer";
```

**Not defensible** — wildcard re-export:

```ts
export * from "./DiffViewer";
export * from "./helpers";
export * from "./hooks";   // ← if these are client hooks, this can break the build
```

Two documented costs. Cross-boundary tree-shaking "does not currently work with
barrel files" **[DOC]**. And a barrel that `export *`s client hooks into a path
a Server Component imports can **fail the build outright** **[DOC]**.

Both costs attach to the wildcard and to what is re-exported — not to the
existence of `index.ts`. A folder's `index.ts` listing three named exports is an
encapsulation boundary and worth keeping; the same file with `export *` is a
liability. `optimizePackageImports` mitigates the perf side for named packages
**[DOC]**, but it does not make `export *` of client hooks safe.

Rules that follow:

- Never `export *`.
- Never re-export client hooks through a barrel that a Server Component's import
  path reaches.
- Do not add a barrel to a folder with one export — `index.ts` re-exporting a
  single component is indirection without encapsulation.

---

## Diagnosing

**"This should be a Server Component but it is in the client bundle."** Walk the
import chain upward to the nearest `"use client"`. Something above it imports
this module. Fix by passing the subtree as `children` instead of importing it,
or by moving the directive down to the leaf that needs it.

**"A build error appeared after adding a hook."** A barrel is re-exporting the
hook into a server import path, or a shared component gained a hook call and
crossed the boundary with all its importers **[DOC]**.

**"An env var is undefined in the browser."** It lacks `NEXT_PUBLIC_`, and was
replaced with `""` rather than erroring **[DOC]**. If it is a secret, the correct
fix is not to add the prefix — it is `import 'server-only'` on the module.

**"Everything re-renders on navigation."** Check provider depth: a provider
wrapping `<html>` instead of `{children}` puts the whole tree in the client graph
**[DOC]**.
