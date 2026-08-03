# Component Organization

Anatomy of a single feature/component folder, from one file to many. For where a folder lives in the tree, see [folder-structure.md](folder-structure.md). For App Router-specific colocation (`_components/`), see [nextjs-organization.md](nextjs-organization.md).

## Growth stages

Don't start a new component at the end state below — grow into it as real need appears:

1. **Single file.** `Foo.tsx` next to its siblings. No folder, no `index.ts`. This is correct for a component with no local support files and no subcomponents.
2. **Folder, one component.** Promote to `Foo/Foo.tsx` + `Foo/index.ts` only once the component needs a colocated test, a subcomponent, or a support file — not preemptively for a component that will always be a single file.
3. **Multi-component feature folder.** Promote to the full anatomy below once the feature has genuinely separable subcomponents (each independently namable and testable) — not as a container for "things that might get split up later."

Each stage adds one file/folder; don't jump straight to stage 3 for a component that current requirements put at stage 1.

## Feature folder anatomy — full example

`client/src/components/diff-viewer/` is the model. Real line counts, to show proportions, not just shape:

```
diff-viewer/
├── index.ts              (4)    # public boundary — the ONLY thing outside code imports
├── constants.ts           (7)    # AUTO_EXPAND_MAX_LINES, HUNK_HEADER_RE
├── helpers.ts             (38)   # parsePatch(), Line interface
├── comments.ts            (173)  # DiffCommentApi contract + pure comment-thread helpers
├── styles.ts              (92)   # class-string maps
├── DiffViewer/             DiffViewer.tsx (32)   + index.ts (1)
├── FileCard/               FileCard.tsx (96)     + index.ts (1)
├── CodeLine/               CodeLine.tsx (84)     + index.ts (1)
├── CommentCard/            CommentCard.tsx (35)  + index.ts (1)
├── CommentThreadView/      CommentThreadView.tsx (52) + index.ts (1)
├── InlineComposer/         InlineComposer.tsx (76) + index.ts (1)
└── OutdatedComments/       OutdatedComments.tsx (20) + index.ts (1)
```

`index.ts` in full — a boundary, not a re-export dump:

```ts
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
```

Note the shape: the root support files (`constants.ts`, `helpers.ts`, `styles.ts`, `comments.ts`) carry the bulk of the non-JSX logic (310 lines combined), while each subcomponent folder is a thin, single-purpose `.tsx` (20-96 lines) plus a one-line barrel. That proportion — small subcomponents, root-level files doing the real work — is what makes a feature folder easy to navigate; a feature where every subcomponent independently duplicates constants/helpers has usually been split one level too early.

## The support-file trio

- `constants.ts` — literal values, enums, option lists only. No computation, no imports beyond types.
- `helpers.ts` — pure functions, no React imports, no hooks. Must be unit-testable without rendering anything.
- `styles.ts` — class-string maps and style computation local to the feature.
- Never mix constants and helpers in one file, and never dump unrelated functions into a catch-all `misc.ts`.

## Barrel files — the shape rule, in full

`SKILL.md` states this rule; here is the reasoning and the four cases. The distinction is **shape**, not folder depth:

| | Example | Verdict |
|---|---|---|
| Single-line component barrel, any nesting level | `CodeLine/index.ts` → `export { CodeLine } from "./CodeLine";` | **OK** — an import-path convention, not a re-export hub |
| Feature-root boundary, named exports | `diff-viewer/index.ts` → `export { DiffViewer } from "./DiffViewer"; export type { DiffCommentApi } from "./comments";` | **OK** — this is the actual public API surface |
| Root barrel re-exporting every component | hypothetical `components/index.ts` → `export * from "./diff-viewer"; export * from "./app-shell"; ...` | **BAD** — pulls the whole component graph into every importer's bundle analysis, kills tree-shaking |
| `export *` across sibling domain files | `lib/hooks/index.ts` used to do `export * from "./reviews"; export * from "./agents"; ...` | **BAD** — any name collision between `reviews.ts` and `agents.ts` resolves silently by file order |

Neither exists in this repo today — `lib/hooks/index.ts` was fixed 2026-08-03 to re-export each hook by name instead of `export *`, and no root `components/index.ts` has been added. Both remain in this table as the anti-pattern to avoid introducing, not a description of current code. See [folder-structure.md](folder-structure.md)'s deviations section for what changed.

Never bypass a feature-root `index.ts` from outside the folder — `import { CodeLine } from "@/components/diff-viewer/CodeLine"` defeats the boundary that folder's `index.ts` exists to draw, even though `CodeLine/index.ts` itself is a fine one-line barrel *within* the folder.

## One component per file

Filename matches the exported component name (PascalCase). Two violations found in the 2026-08-02 audit, both **fixed 2026-08-03**:

- `components/showcase/Showcase.tsx` exported a component called `Gallery` — renamed to `Gallery.tsx`.
- `components/page-shell/PageShell.tsx` exported two components (`PageContainer` and `FeaturePlaceholder`) from one file — split: `PageContainer` moved to `app/_components/PageContainer/` (its only caller), `FeaturePlaceholder` stayed, file renamed to `FeaturePlaceholder.tsx`, folder renamed to `components/feature-placeholder/`.

Small colocated internal helpers (a tiny presentational subcomponent that only that component renders) are fine to keep in the same file; two independently-usable, unrelated components in one generically-named file is not. `.../RunTraceDrawer/_components/atoms.tsx` was the concrete offender for this — **fixed** by inlining its two helpers (`Stat`, `Row`) directly into their one caller (`TraceBody.tsx`) as local, non-exported functions, and deleting `atoms.tsx`, rather than promoting them to their own folders.

## Nesting depth

Two levels of component folder (`Feature/SubFeature/`) is the practical ceiling. `app/settings/[section]/_components/SettingsView/_components/SettingsApiKeys/` is already at that limit — it's also where the deepest relative-import violation in the repo lives (`constants.ts:1`, 7 levels of `../`), which is not a coincidence: past two levels, relative imports stop being readable and the `@/...` alias rule in [folder-structure.md](folder-structure.md) becomes load-bearing rather than optional.

## Tests

Colocate a feature's tests next to its source (`Foo.test.tsx` beside `Foo.tsx`), per `client/AGENTS.md`. `diff-viewer/` itself currently has none — that's a gap in that folder, not evidence tests are optional for new feature folders.
