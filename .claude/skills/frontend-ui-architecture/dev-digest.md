# dev-digest — how these rules land on `client/`

The rules in [SKILL.md](SKILL.md) are general. This file records how `client/`
actually implements them, and where it currently diverges.

Audit performed **2026-08-07** against `client/src` (excluding `src/vendor/**`).
Counts will drift — re-run the commands rather than trusting the numbers.

## Contents

- [The layout](#the-layout)
- [Where things go here](#where-things-go-here)
- [Divergences found](#divergences-found)
- [Re-running the audit](#re-running-the-audit)

---

## The layout

```
client/src/
├── app/                    # App Router. 121 .ts/.tsx files.
│   └── <route>/
│       ├── page.tsx        # thin
│       └── _components/    # feature components, nested recursively
│           └── <Name>/
│               ├── <Name>.tsx
│               ├── <Name>.test.tsx
│               ├── constants.ts
│               ├── helpers.ts
│               ├── styles.ts
│               ├── index.ts
│               └── _components/   # sub-subcomponents
├── components/             # shared across 2+ routes. 8 folders, 44 files.
├── lib/                    # 17 files
│   ├── api.ts              # the only module that calls fetch
│   ├── hooks/              # every TanStack Query hook
│   ├── providers.tsx       # "use client" provider stack
│   ├── format.ts           # thematically named, not "utils"
│   └── github-urls.ts
├── i18n/
└── vendor/                 # do not touch
```

This is the "split project files by feature or route" strategy — one of the
three Next.js names without ranking **[DOC]**. It is a valid choice; what makes
it work is that it is applied consistently.

Existing prose lives in [client/AGENTS.md](../../../client/AGENTS.md) (6 lines
of conventions) and [client/README.md](../../../client/README.md) (route map).
This skill supplies the reasoning those files omit; it does not replace them.

---

## Where things go here

| What | Here | Matches |
|---|---|---|
| Route-specific component | `app/<route>/_components/<Name>/` | promotion rule **[DOC]** |
| Shared component | `src/components/<name>/` | promotion rule **[DOC]** |
| Component constants | `constants.ts` in the folder — 17 of them, no global `src/constants/` | purpose-not-essence **[DOC]** |
| Pure functions | `helpers.ts` in the folder; shared → `src/lib/format.ts`, `github-urls.ts` | thematic naming **[DOC]** |
| Data access | hook in `src/lib/hooks/*` → `src/lib/api.ts`. Components never call `fetch`. | DAL shape **[DOC]** |
| Server state | TanStack Query, never mirrored into `useState` | server ≠ client state **[DOC]** |
| API types | `@devdigest/shared`, never redeclared | contract package **[CONV]** |
| Tests | `<Name>.test.tsx` beside the component | colocation **[DOC]** |
| App chrome | `src/components/app-shell` | — |
| User-facing strings | `next-intl`, `messages/<locale>/*.json` — never inline in JSX | — |

Two local conventions worth knowing because they are *not* general practice:

- **`styles.ts` per component folder [CONV]** — style objects live beside the
  component rather than in a global stylesheet.
- **Provider stack is centralized** in `src/lib/providers.tsx` — `"use client"`,
  accepts `children`, creates the `QueryClient` via `useState(() => …)`. This
  matches both TanStack's App Router guidance and Next.js's "wrap `{children}`,
  not `<html>`" rule **[DOC]**.

---

## Divergences found

These are real, currently in the tree, and ordered by how much they matter.

### 1. `src/lib/hooks/index.ts` is the exact documented hazard **[DOC]**

```ts
export * from "./core";
export * from "./agents";
export * from "./reviews";
export * from "./trace";
export * from "./repo-intel";
```

A wildcard barrel re-exporting React Query hooks is the pattern that can fail a
build when a Server Component's import path reaches it **[DOC]**.

It does not fail today — all 5 consumers already carry `"use client"`, so
nothing server-side reaches it. That is a property of current call sites, not of
the module. The first Server Component that imports from `@/lib/hooks` inherits
the problem, and the error will point at the barrel rather than at the import
that caused it.

Cheap fix: replace the wildcards with named re-exports. The file's own comment
already promises a curated surface ("the platform hooks") that `export *` does
not deliver.

### 2. No `server-only` anywhere — the boundary is unenforced

Zero modules import `server-only`. The one grep hit in
`src/components/mermaid-diagram/MermaidDiagram.tsx` is a **comment** containing
the word "client-only", not an import.

Low urgency while the app is client-heavy, but it means the `NEXT_PUBLIC_`
failure mode is fully live: an unprefixed variable silently becomes `""` rather
than erroring **[DOC]**. Any module that grows to touch a secret should take
`import 'server-only'` at that moment.

### 3. Five pages carry `"use client"` at the top

```
src/app/page.tsx
src/app/onboarding/page.tsx
src/app/agents/[id]/page.tsx
src/app/repos/[repoId]/pulls/page.tsx
src/app/repos/[repoId]/pulls/[number]/page.tsx
```

62 files total carry the directive. Marking a *page* client puts everything it
imports into the client graph **[DOC]** — the opposite of pushing the boundary
down to interactive leaves **[DOC]**.

This is a deliberate-looking architecture (the studio is interactive throughout,
data comes from TanStack Query rather than server fetches), not an accident. But
it should be a decision someone can point at, not a default. When a page is
mostly static chrome around a few interactive widgets, the directive belongs on
the widgets.

### 4. Zero route groups

No `(group)` folders exist across 121 files in `src/app/`. Sections — `agents`,
`repos`, `settings`, `onboarding` — are separated only by URL hierarchy, so
there is currently no way to give a subset of siblings a shared layout without
affecting the URL **[DOC]**.

Not a defect. Worth knowing the tool exists before someone adds a passthrough
`layout.tsx` to work around its absence.

### 5. Barrels with a single export

Several `index.ts` files re-export exactly one component
(`AgentCard/`, `AgentsListView/`, `ConfigTab/`, `CreateAgentModal/`,
`AgentEditor/`, …). That is indirection without encapsulation — there are no
internals being hidden.

Harmless individually; listed for consistency, not as a cleanup task.

### 6. `RunHistory.tsx` at 331 lines **[CONV]**

The largest component in the tree, well past the ~200-line smell trigger. Per
§2 of [SKILL.md](SKILL.md), the number is not itself the finding — it is a
prompt to look for a second responsibility. Someone should look; the line count
alone is not a review comment.

---

## Re-running the audit

```sh
cd client

# barrels using export * (the rule that matters)
grep -rl "export \*" src --include=index.ts --exclude-dir=vendor

# would any Server Component reach the hooks barrel?
for f in $(grep -rl 'from "@/lib/hooks' src --include=*.tsx --include=*.ts); do
  grep -q '"use client"' "$f" || echo "SERVER: $f"
done

# boundary height — client directives on pages and layouts
grep -rl '"use client"' src/app --include=page.tsx --include=layout.tsx

# is the server boundary enforced at all?
grep -rn "^import ['\"]server-only" src --include=*.ts --include=*.tsx

# route groups
find src/app -type d -name "(*)"

# components past the smell trigger
find src -name "*.tsx" -not -path "*/vendor/*" -exec wc -l {} + | sort -rn | head
```

Always pass `--exclude-dir=vendor`, and never grep `server/clones/**` — it holds
a full copy of dev-digest itself and will match everything twice.
