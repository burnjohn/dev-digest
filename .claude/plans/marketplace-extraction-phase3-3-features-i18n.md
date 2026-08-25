# Development Plan — Phase 3.3: bonus catalog features + real i18n

**Execution mode:** multi-agent (lightweight — no separate content-review
pass; verification is command-based, run by the orchestrating session)

## Context

Builds on 3.2's SPA shell (hash router, layout, search, plugin/artifact
detail pages, placeholder `useT` stub). This sub-plan (3.3 of 4) adds the
three resolved bonus catalog features from
`docs/specs/marketplace-extraction/architecture.md` (dependency-graph
visualization, "what's new" aggregation, version/compatibility badges),
implements the `#/whats-new` and `#/getting-started` routes that 3.2 left
as placeholders, and replaces 3.2's placeholder `useT` stub with the real
flat-JSON i18n dictionary.

Working directory: `/Users/viptech/dev/ai agent/dev-digest-ai-marketplace`.

## Modules involved

`site/src/**` inside `dev-digest-ai-marketplace` only. No `dev-digest/**`
module touched.

## Constraints

From `docs/specs/marketplace-extraction/architecture.md`:

- **Three bonus features, no more, no fewer** (architecture.md:360-377,
  resolved open question #3): dependency-graph visualization on the plugin
  detail page, "what's new" aggregation at `#/whats-new`, version/
  compatibility badges on every plugin card and detail page. The
  cross-link-from-search-result-to-owning-plugin feature was explicitly
  **dropped** for v1.0.0 (architecture.md:377-380) — do not add it as a
  "nice to have while I'm in here."
- **Dependency-graph data comes from `index.json`, not hand-maintained**
  (architecture.md:366-369): reuse the dependency edges 3.1 already put on
  each plugin's index entry (`plugin.json`'s `dependencies` array,
  surfaced through `build-index.mjs`) — do not re-derive or hardcode the
  graph edges in the SPA (e.g. do not hardcode "sdd-engineering depends on
  research-tools" as a literal string in a component; read it from the
  loaded catalog data).
- **"What's new" is a build-time aggregation across all four
  `CHANGELOG.md` files, newest first** (architecture.md:370-372) — this
  data already exists in 3.1's `releases.json`; `#/whats-new` is a render
  of that data sorted across plugins, not a new build-time computation
  inside the SPA.
- **Version/compatibility badges show current version + the
  `COMPATIBILITY.md` floor** (architecture.md:373-376) — the compatibility
  floor (`Claude Code >=2.1.110` for all four plugins, confirmed identical
  across all four `COMPATIBILITY.md` files as of this phase) must be
  read from the generated data, not hardcoded as a literal string
  component-side, even though all four plugins currently share the same
  floor value — a future plugin raising its own floor (per the
  Invariant at architecture.md:272-277) must not require a component
  change.
- **i18n: one flat JSON file, `site/src/i18n/en.json`, `useT('key')` hook,
  zero hardcoded UI strings in components** (architecture.md:341-347,
  resolved open question #4) — this sub-plan must (a) create the real
  `en.json` dictionary covering every UI string used across 3.2's and
  3.3's components (search placeholder, nav labels, badge labels, "what's
  new" heading, getting-started copy, install-command button text, etc.),
  and (b) replace 3.2's placeholder `useT` stub with a hook that actually
  reads from `en.json`. English-only for v1.0.0 (no second locale file
  required now).
- **Real-data-only still applies** (architecture.md:349-352) — the
  dependency graph, badges, and "what's new" feed must all reflect the
  real four plugins' real `plugin.json`/`CHANGELOG.md`/`COMPATIBILITY.md`
  content, never sample/demo entries.
- **`marked` → `DOMPurify` invariant still applies** to any new markdown
  rendering surface this sub-plan adds (e.g. if "what's new" renders
  CHANGELOG excerpts as markdown, not plain text).
- **English-only prose, no absolute local paths** (architecture.md:587-591,
  AC-8) apply here as everywhere else in this repo.

## Skills to apply (implementer will use)

- `react-best-practices` — for the new components
  (`DependencyGraph`, `WhatsNewFeed`, `CompatibilityBadge`,
  `GettingStarted` page).
- `react-ui-architecture` — deciding whether the graph/badge/feed
  components are page-local or shared (badges likely appear on both the
  catalog landing page's plugin cards and the individual plugin detail
  page, making them a shared component from the start).
- `react-testing-library` — component tests for the badge (renders the
  right version/floor pair for a given plugin) and the "what's new" feed
  (renders entries newest-first across plugins) at minimum.
- `mermaid-diagram` — only as a *reference* for how to think about
  rendering a small dependency graph legibly (node/edge clarity,
  direction), not as a literal dependency: the actual rendering technology
  choice (inline SVG, a tiny non-Mermaid graph library, or a simple
  DOM-based box-and-arrow layout given the graph here is small and fixed —
  at most 4 nodes, 4 edges) is the implementer's call, documented in a
  short comment in the component; do not add a heavyweight graph-rendering
  dependency for a 4-node graph.
- `typescript-expert` — extending the `site/src/types/catalog.ts` shapes
  from 3.2 with whatever additional typed fields these features need
  (e.g. a `CompatibilityInfo` type).

## Ordered steps

1. **Build the real `site/src/i18n/en.json`** — audit every literal UI
   string currently in `site/src/**` from 3.2 (search placeholder, nav
   labels, page titles, button text, empty-state text) plus every new
   string this sub-plan's components need, and write them as flat
   `"section.key": "English text"` entries.
2. **Replace the 3.2 placeholder `useT` stub** with a real hook
   (`site/src/i18n/useT.ts`) that imports `en.json` and returns
   `dict[key] ?? key` (a safe fallback that surfaces a missing-key bug as
   the literal key string rather than crashing).
3. **Sweep `site/src/**` for any remaining hardcoded UI string** left over
   from 3.2 and route it through `useT` — this is the "zero hardcoded
   strings" invariant check for this sub-plan, since 3.2 only used a
   placeholder stub, not the enforcement pass.
4. **Implement `CompatibilityBadge`** (`site/src/components/
   CompatibilityBadge.tsx`): takes a plugin's `version` +
   `compatibilityFloor` (surfaced via 3.1's `index.json`/`stats.json` —
   confirm 3.1's schema already carries the `COMPATIBILITY.md` floor per
   plugin; if it does not, this sub-plan must add that field to
   `build-index.mjs`'s output rather than hardcode it here, since the
   real-data-only constraint forbids a literal `">=2.1.110"` string in a
   component). Render on both the catalog landing page's plugin cards and
   the `#/plugin/<name>` detail page.
5. **Implement `DependencyGraph`** (`site/src/components/
   DependencyGraph.tsx`): reads a plugin's dependency edges (and, for
   `engineering-paved-path`, the reverse edges — which plugins depend on
   it) from the loaded catalog data, renders a small directed graph on the
   plugin detail page.
6. **Implement `#/whats-new`** (`site/src/pages/WhatsNew.tsx`): reads
   3.1's `releases.json`, flattens all four plugins' version entries into
   one feed sorted newest-first (by version/date metadata already present
   in `releases.json`), replacing 3.2's placeholder page.
7. **Implement `#/getting-started`** (`site/src/pages/GettingStarted.tsx`):
   static (i18n-routed) content — what the marketplace is, the
   `claude plugin marketplace add
   viptech/dev-digest-ai-marketplace --scope project` /
   `claude plugin install <name>@dev-digest-ai-marketplace --scope
   project` commands from architecture.md's Data flow section, replacing
   3.2's placeholder page.
8. **Write tests**: `CompatibilityBadge.test.tsx` (correct version/floor
   pair rendered for a fixture plugin), `WhatsNewFeed`/`WhatsNew` page test
   (newest-first ordering across plugins, using a small fixture
   `releases.json`-shaped object, not the real generated file), and at
   least one test confirming a `useT` call with a missing key falls back
   to the key itself rather than throwing.

## Test plan

Run from `site/` (after `npm run build:index` has been re-run from repo
root by the orchestrating session, so 3.1's output reflects any schema
additions from step 4 above):

- `npm test` (Vitest) — all component tests from 3.2 plus this sub-plan's
  new tests pass.
- `npm run build && npm run preview` — manually confirm (by the
  orchestrating session): `#/whats-new` shows real CHANGELOG entries from
  all four plugins; `#/getting-started` renders the real install commands;
  a plugin detail page shows its dependency graph and a badge reading the
  real `1.0.0` / `>=2.1.110` values, not placeholders; switching between
  English strings confirms no raw `i18n.key`-shaped literal leaks into the
  rendered UI (which would indicate a missed `useT` wiring or a genuinely
  missing dictionary key).
- Manual grep-style spot check (by the orchestrating session):
  `grep -rn '"[A-Z][a-z].* [a-z]' site/src --include='*.tsx'` or similar,
  looking for suspicious literal English sentences left outside `useT`
  calls — not a hard gate, a smell check.

**The implementer agent is not expected to have Bash access.** All
commands above are run by the orchestrating session after the
implementer's changes land.

## Out of scope

Architecture and security review are not part of this plan or the
implementer's job — the orchestrating session's command-based verification
stands in for a dispatched review pass in this lightweight multi-agent
phase. CI wiring (`site.yml`/`pages.yml`) is 3.4's job. A second locale
file is explicitly out of scope for v1.0.0.
