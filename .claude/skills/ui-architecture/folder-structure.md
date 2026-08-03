# Folder Structure

Top-level layout of `client/src/` and the promote-vs-colocate call. For the anatomy of one feature/component folder, see [component-organization.md](component-organization.md). For App Router-specific organization, see [nextjs-organization.md](nextjs-organization.md).

## The tree as it actually is

```
client/src/
├── app/            # Routes. Next.js special files + colocated _components/. See nextjs-organization.md.
├── components/     # Feature folders used across 2+ routes (diff-viewer, app-shell, severity-counters, ...).
├── lib/            # App-wide, layer-only code with no single feature owner.
│   └── hooks/      # TanStack Query hooks — the server-state layer, shared across features.
├── i18n/           # next-intl config. One file, framework-required location.
├── test/           # Shared test setup + smoke test. Feature tests stay colocated, not here.
└── vendor/         # @devdigest/ui, @devdigest/shared — do not touch, see repo CLAUDE.md.
```

There is **no** top-level `hooks/`, `utils/`, `constants/`, `types/`, `providers/`, `context/`, `api/`, or `services/` folder in this repo, and none should be added. Those roles already exist inside `lib/`:

| Role | Where |
|---|---|
| HTTP transport | `lib/api.ts` |
| Server-state hooks | `lib/hooks/*.ts` (one file per domain: `reviews.ts`, `agents.ts`, `repo-intel.ts`, `trace.ts`, `core.ts`) |
| Client-local types | `lib/types.ts` |
| App-wide providers/contexts | `lib/providers.tsx`, `lib/theme.tsx`, `lib/toast.tsx`, `lib/repo-context.tsx` |
| Pure, app-wide helpers | `lib/findings.ts`, `lib/format.ts`, `lib/github-urls.ts`, `lib/model-label.ts` — each with a colocated `.test.ts` |

`lib/findings.ts` + `lib/findings.test.ts` and `lib/format.ts` + `lib/format.test.ts` are the pattern to copy for a new app-wide pure helper: colocate the test next to the source even at this layer, same as inside a feature folder.

## Layer vs. feature

This repo is **feature-first** inside `components/` and `app/`, and **layer-only** inside `lib/`. Don't blur the two:

- A `lib/` file is correct when it is a single, app-wide concern with **no feature that owns it** — transport (`api.ts`), server-state caching (`hooks/`), cross-cutting UI state (`theme.tsx`, `toast.tsx`).
- The moment a "shared" file's logic actually belongs to one feature's domain, it's feature-first work that got layered by habit — it belongs in that feature's folder instead, or in a domain-named `lib/hooks/<domain>.ts` file (already the pattern), not a new generic layer file.
- Don't invent a new top-level layer folder (`services/`, `utils/`) to hold a single feature's logic — that's `components/<feature>/helpers.ts` wearing a disguise.

## The promotion threshold

A file moves from a feature folder to a shared location (`components/<feature>/` or `lib/`) only when a **second, unrelated** consumer needs it **today** — not "will probably need it," not "conceptually could be reused." See [folder-structure.md's sibling `SKILL.md`](SKILL.md) for the general colocation principle; this is the concrete test to apply.

Historical counter-examples from the 2026-08-02 audit, i.e. what premature promotion looks like and why it's a cost, not a convenience — updated 2026-08-03 with what happened to each:

- `components/mermaid-diagram/` — **zero** consumers. A shared folder with no caller is pure carrying cost: it still has to be read, typed, and reasoned about by anyone auditing `components/`. Still true today — kept on purpose (see the deviations note above), not fixed, since it's real unwired functionality rather than a placement mistake.
- `components/page-shell/` — exactly **one** real consumer of `PageContainer` (`app/page.tsx`). **Fixed** — `PageContainer` moved to `app/_components/PageContainer/`, colocated with its only caller; the folder was renamed to `components/feature-placeholder/` for what remained.
- `components/findings-popover/` — exactly **one** consumer (`components/severity-counters/SeverityCounters.tsx`). **Fixed** — colocated into `components/severity-counters/FindingsPopover/`.

None of these are broken; they're just evidence that "might be shared later" produced a permanent extra hop for zero present benefit. Don't repeat the pattern — colocate first, promote on the second real caller, in the same PR that adds it.

## Vendor boundary

`@devdigest/ui` and `@devdigest/shared` are vendored (`client/src/vendor/ui/`, `client/src/vendor/shared/`) — see repo `CLAUDE.md`'s "Do not touch" list. Import them only via the alias, never a deep subpath:

```ts
// OK
import { Button, Card } from "@devdigest/ui";

// NOT OK — bypasses the vendor boundary
import { Button } from "@devdigest/ui/primitives/Button";
```

This holds today with zero exceptions (no deep `@devdigest/ui/*` import exists in app code) — keep it that way when adding new UI primitive usage.

## Import-path rule

Use the `@/...` alias for anything outside the current feature/route folder. Use relative paths (`./`, `../`) only for files inside the same folder.

```ts
// OK — crossing a folder boundary, use the alias
import { AppShell } from "@/components/app-shell";
import { useReviews } from "@/lib/hooks/reviews";

// OK — same folder, relative is fine
import { CodeLine } from "./CodeLine";

// NOT OK — crossing many folder boundaries with relative segments
import type { ConnTestProvider } from "../../../../../../../lib/types";
```

This is the single largest real inconsistency in the codebase today (33 alias imports vs. 53 imports with 3+ `../` segments), including the same target imported both ways in sibling files (`AppShell` as `@/components/app-shell` in one page, `"../../../../../components/app-shell"` in another). New code should use the alias; don't add another instance of the second form.

## Known deviations (don't copy these)

Real paths where the code used to diverge from the rules above. **Fixed 2026-08-03** in the refactor that applied this skill to `client/` — kept here so the reasoning isn't lost, not because the code still has the problem.

- ~~`lib/hooks/index.ts`'s header comment explicitly sanctions importing a domain hook file directly (bypassing the barrel), and ~22 call sites do. It also uses `export *` across all 5 domain files, which resolves any name collision silently by file order.~~ **Fixed** — `index.ts` now re-exports each hook by name; direct domain-file imports (e.g. `@/lib/hooks/reviews`) remain valid, since that was never the problem.
- ~~Deepest offender for the import-path rule: `app/settings/[section]/_components/SettingsView/_components/SettingsApiKeys/constants.ts:1` — 7 levels of `../`.~~ **Fixed**, along with every other relative import in `client/src/` that crossed 2+ folders into `lib/` or `components/` (23 files) — all converted to the `@/...` alias.
- ~~`.../RunTraceDrawer/_components/atoms.tsx` bundles two unrelated components (`Stat`, `Row`) in one generically-named file with no `index.ts`.~~ **Fixed** — both had exactly one caller (`TraceBody.tsx`), so they were inlined as local, non-exported helpers there instead of promoted to their own folders; `atoms.tsx` was deleted.
- ~~`components/showcase/Showcase.tsx` exports a component named `Gallery`.~~ **Fixed** — file renamed to `Gallery.tsx`.
- ~~`components/page-shell/PageShell.tsx` exports two components (`PageContainer` and `FeaturePlaceholder`) from one file.~~ **Fixed** — `PageContainer` (single consumer: `app/page.tsx`) moved to `app/_components/PageContainer/`; `FeaturePlaceholder` (zero consumers, kept intentionally per user decision — see below) stays in the renamed `components/feature-placeholder/`.
- ~~5 of 9 `components/*/index.ts` files re-export `default` alongside the named export.~~ **Fixed** — all 5 default exports removed; every component barrel now exports named only.
- ~~`client/vitest.config.ts` aliases `@devdigest/ui` to the vendor **directory**, while `client/tsconfig.json` aliases it to `vendor/ui/index.ts`.~~ **Fixed** — both configs now point at `index.ts`.
- ~~`components/diff-viewer/comments.ts` references a `DiffComments.tsx` file that doesn't exist.~~ **Fixed** — comment now names the real files (`CommentThreadView/`, `InlineComposer/`, `OutdatedComments/`). `vendor/ui/README.md`'s stale `/showcase` route claim was **not** touched — `vendor/` is off-limits per repo `CLAUDE.md`.

Two zero/one-consumer folders named in the original audit were deliberately **not** removed, on user decision during the 2026-08-03 refactor:
- `components/mermaid-diagram/` — zero consumers, but a fully-built component backed by a real `mermaid` dependency (syntax validation, lazy import, SVG render), not a stub. Judged likely-unwired-but-real work rather than dead code; left in place rather than deleted unilaterally.
- `components/feature-placeholder/FeaturePlaceholder.tsx` (formerly `page-shell/`) — zero consumers, explicit scaffolding ("Feature agents (A1–A6) replace `FeaturePlaceholder` with their real screen"). Kept on request for the next route that starts as a placeholder; now imports `PageContainer` from its new location via the `@/` alias.

`components/findings-popover/` (the third single-consumer folder from the original audit) **was** colocated — it had exactly one real caller (`SeverityCounters.tsx`) and no reason to keep standing alone, so it moved to `components/severity-counters/FindingsPopover/`.
