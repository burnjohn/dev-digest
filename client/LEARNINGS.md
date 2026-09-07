# client — engineering learnings

**While working:** append only. Read the file before writing — if the lesson
is already here, extend that entry instead of adding a second copy. If one
turns out wrong, add a new entry correcting it rather than editing history.

**During a scheduled review** (quarterly, or when this file stops being
useful): merge duplicates, delete entries about code that no longer exists,
and resolve contradictions explicitly — two entries giving opposite advice
make the agent pick at random. Treat this file as a draft under review, not
as truth; a bad entry is worse than a missing one.

## What Works

### 2026-07-28 — money formatting here needs significant digits, not fixed decimals

Real run costs in this app are ~$0.0004–$0.02 (verified against `agent_runs`
on the dev DB). Any fixed-decimal formatter renders nearly all of them as
"$0.00" — which is exactly what the pre-`d45ab0d` helper did
(`usd.toFixed(2)`). A magnitude ladder isn't enough either: capping at 4
decimals turns $0.00039347 into "$0.0004", one significant digit.

`formatCost` in `src/lib/format.ts` uses `toPrecision(3)` for sub-dollar
values, trims trailing zeros (so 0.012 → "$0.012", not "$0.0120"), and pads
back to 2 decimals when trimming leaves fewer (0.1 → "$0.10"). Values ≥ $1
use plain `toFixed(2)`. Keep `null` → "—" strictly distinct from `0` →
"$0.00": null means no completed run / unknown pricing, and showing a price
there is the bug the whole format exists to prevent.

## What Doesn't Work

## Codebase Patterns

### 2026-08-22 — D21's derived agent identity {color, icon} was NOT wired into `RunReviewDropdown`'s multi-select rows beyond the icon — the Dropdown extension's scope was already closed

Building Phase B2 (plans/13-multi-agent-review.md), `agentIdentity()`
(`multi-agent/[prId]/_components/MultiAgentResultsView/helpers.ts`) is reused
with its real color in the configure surface's checkbox rows, but
`RunReviewDropdown`'s new multi-select rows only take the `icon` half —
`DropdownItemDef`/`Dropdown.tsx`'s additive extension (specs/13 §8, landed in
Phase B1) added exactly `checked`/`keepOpen` and nothing else; there is no
per-item color field to carry a swatch. Re-opening that extension to add one
was out of this phase's scope (it's a shared primitive every dropdown in the
product depends on, already shipped and tested). If a future session wants
full color parity for agent identity in the PR-page picker, the seam is an
additive `color?: string` on `DropdownItemDef` (rendered as a small swatch
next to the checkbox indicator in `Dropdown.tsx`) — not a parallel dropdown
or a fork.

### 2026-08-22 — the multi-agent "conflicts-only" filter (AC-41) restricts by FILE, not by exact finding — the `Conflict` contract carries no finding id

`ConflictsSection`'s "show only conflicts" toggle (specs/13-multi-agent-review.md
AC-41) filters each layout's rendered findings down to
`findings.filter(f => conflictFiles.has(f.file))`, where `conflictFiles` is
just `new Set(conflicts.map(c => c.file))`. This is coarser than "the exact
findings that anchor a conflict" — `Conflict`/`ConflictTake`
(`contracts/observability.ts`) carry `file`+`line`+`title`+per-agent
`verdict`/`note`, but no finding id, so a finding can't be matched to "is this
specific finding part of a conflict" without re-deriving the server's own
D-P1 (file-scoped-vs-line-scoped classification) and D-P3 (interval-merge)
matching logic client-side — which the plan deliberately keeps server-only
(D6/N13, "conflicts computed on read, never stored"). File-level filtering
was the chosen, defensible approximation given the contract as shipped. A
future session should not assume finer-grained (finding-level) filtering
already exists here; delivering it would need either a contract change
(finding ids on `ConflictTake`) or a dedicated detail endpoint, not a
client-side reimplementation of the conflict-matching algorithm.

### 2026-08-12 — copying SkillsTab's "catalog + link-state" row model for a non-repo-authoritative catalog needs a union, not a lookup

Building the agent/skill editors' Context tab (specs/09-project-context-folder.md),
the plan said "copy SkillsTab's proven shape" — and the checkbox/drag/filter
mechanics do carry over directly. But `SkillsTab/helpers.ts`'s `buildRows`
assumes the catalog (`useWorkspaceSkills()`) is authoritative: every row comes
from the catalog, cross-referenced against the link table. That assumption
breaks for documents, because the "catalog" here (`useRepoDocuments(repoId)`)
is a live filesystem scan — a document can be deleted/renamed/moved out of the
search roots *after* it was attached, and AC-26 requires the attachment to
keep rendering as `missing`, not vanish. `ContextTab/helpers.ts`'s `buildRows`
therefore builds rows from the **union** of catalog paths and attachment
paths (`new Set([...catalogByPath.keys(), ...attachedByPath.keys()])`), not a
map over the catalog alone — a since-deleted attachment gets a row with
`docType: null` and `missing: true` instead of silently disappearing. Any
future tab that cross-references a live external catalog (filesystem, remote
API) against a persisted link table needs the same union, not the SkillsTab
lookup shape, whenever the catalog can drift independently of the links.

Separately: `ContextTab` (both the agent and skill editor's) is NOT a
repo-scoped route (`/agents/:id`, `/skills/:id` carry no `:repoId`), but still
needs one repo's document catalog to attach from. It resolves this via
`useActiveRepo().activeRepo?.id` from `src/lib/repo-context.tsx` — the same
shell-wide "current repo" used by the sidebar/command-palette, not a route
param. This is a legitimate use of `useActiveRepo()` OUTSIDE a
`/repos/:repoId/...` route, which every prior consumer of that hook was.

**2026-08-12 correction (caught by an automated API Contract Reviewer finding
on PR #9, 100% confidence) — "legitimate" above was wrong once the entity
already has attachments.** `useActiveRepo()` is shell-wide state (URL path >
`localStorage` > first repo in the list, `repo-context.tsx:47-48`) with zero
relationship to which repo an agent's/skill's *own* attachments are pinned to
(spec D3: an attachment records `(repo, path)` and never re-resolves against a
different repo). Both wrapper components
(`app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx`,
the skill editor's sibling) used `activeRepo?.id` unconditionally for `repoId`
— so if the user navigated to `/agents/agent-1?tab=context` with a DIFFERENT
repo active in the sidebar than the one `agent-1`'s attachments actually
belong to, `onToggle`/`onReorder` would silently write to the wrong repo.
Worse for `onReorder`: `SharedContextTab.applyOrder` sends ONE `repoId` for
the WHOLE reordered set (`repo_id: repoId` mapped over every path,
`ContextTab/ContextTab.tsx:124`), so reordering an already-attached agent's
documents while the wrong repo was active would silently REWRITE every
attachment's `repo_id` to that wrong repo — real data corruption, not just a
failed write. Fix: derive `repoId` from `attachments?.[0]?.repo_id` first,
falling back to `activeRepo?.id` only when the entity has no attachments yet
(nothing to anchor to — the very first attach still has to come from
whatever repo is active). Any future consumer of `useActiveRepo()` outside a
`/repos/:repoId/...` route that also reads/writes an already-persisted,
repo-pinned record must anchor to the record's own repo once one exists, not
trust shell state for anything beyond the "nothing attached yet" case.

### 2026-08-04 — `diff-viewer/`'s deliberately narrow public surface had to be widened for a second real consumer; the target+nonce scroll pattern now exists in two places

Building `SmartDiffViewer` (`app/repos/[repoId]/pulls/[number]/_components/
SmartDiffViewer/`), the existing `src/components/diff-viewer/` module needed
to render files grouped by risk instead of `DiffViewer`'s flat list — but
still reuse the same patch parsing and inline-commenting logic, not fork a
second renderer. `diff-viewer/index.ts` originally exported only `DiffViewer`
+ `DiffCommentApi` on purpose (its own top comment said so); it now also
exports `FileCard`, the per-file collapsible unit, since a grouped view needs
to render one `FileCard` per file directly rather than going through
`DiffViewer`'s flat `files.map`. `FileCard`/`CodeLine` gained three additive,
backward-compatible optional props: `defaultOpen` (override the size-based
auto-expand — used to force boilerplate files closed), `scrollTarget: {
line, nonce } | null` + a matching `id={diffline-{path}-{line}}` on
`CodeLine`'s row, and `headerExtra: ReactNode` (a findings-count badge
rendered in the file header, with the caller responsible for
`stopPropagation` so clicking it doesn't also toggle the card). The
`scrollTarget`/`nonce` shape is a direct copy of `ReviewRunAccordion.tsx`'s
`targetRunId`/`targetNonce` pattern — it now exists in two independent
places. If a third "click X, open + scroll to Y" need shows up, it's worth
extracting into a shared hook instead of copying a third time.

**2026-08-06 — the third case showed up (mentor feedback on PR #6: Smart Diff's
findings badge should switch to the Findings tab and highlight the finding's
card, not just scroll within the diff) and it was NOT extracted into a shared
hook — copied a third time, deliberately.** The three "target+nonce" instances
turned out to need different payloads at each level (`FileCard`'s is `{ path,
line }`+nonce; `ReviewRunAccordion`'s is `{ runId }`+nonce; the new
`FindingCard`'s is `{ findingId }`+nonce, i.e. just its own `f.id === target`
check) and different owners: `SmartDiffViewer`'s click doesn't know which
review run a finding belongs to, so `PrDetailView` (the only component holding
both `allFindings` and the tab state) owns a NEW `findingTarget` state and a
`handleSelectFinding` that both switches `tab` to `"findings"` AND bumps the
nonce; `FindingsTab` then *reuses* its own existing `target`/`setTarget` state
(the one Timeline-click navigation already drives) to open+scroll the right
`ReviewRunAccordion`, by resolving `targetFindingId` → containing `run_id` via
`runs.find(r => r.findings.some(f => f.id === targetFindingId))` — so the
accordion-level open/scroll got FOLDED into the existing mechanism instead of
adding a fourth copy, while `targetFindingId`/`targetFindingNonce` themselves
still thread straight through as new props (`ReviewRunAccordion` →
`FindingsPanel` → `FindingCard`) for the card-level expand+highlight+scroll
+ keyboard-focus-move, since that's a genuinely different concern (which
card, not which run). A generic "useTargetScroll(id, nonce)" hook would have
had to abstract over these three different identity shapes and two different
state owners — copying stayed cheaper. Revisit extraction only if a FOURTH
case needs the exact `{ id }`+nonce shape one of these three already has.

**2026-08-14 — the fourth case arrived (specs/11-why-risk-brief.md AC-39, Q7:
PR Brief review-focus click → Files tab, open+scroll that file/line) and it
was STILL not extracted — it reused `FileCard`'s existing `{ path, line }`+
nonce shape exactly, the "supplying an existing prop from a new owner" case
Q7 called out in advance, not a new copy.** `PrDetailView` gained a
`focusTarget: { file, line: number | null, n } | null` state + a
`handleFocusFile` that mirrors `handleSelectFinding` line-for-line — same
component, same reasoning (it already owns both the tab state and every other
cross-tab target). The one genuinely NEW widening: `FileCard`'s `scrollTarget.
line` became `number | null` (previously always `number`) — `line: null` now
scrolls to a new `id={difffile-{path}}` on the card's own root (exported as
`fileAnchorId`) instead of a `diffline-{path}-{line}` row, additive and
backward-compatible (no existing caller ever passed `line: null`, both
existing consumers — `DiffViewer`, `SmartDiffViewer` — still resolve a normal
numeric line unchanged). This is the real fifth-case decision point: the next
"click X, open+scroll Y" need that ALSO wants a file-only (no-line) target can
reuse `fileAnchorId`/the widened `scrollTarget` shape directly; a need for a
genuinely different identity (not `{path, line}`) still doesn't justify
extracting a shared hook by this file's own three-copies-first precedent.

### 2026-08-02 — don't copy `pulls/page.tsx` as a route template; it's the deviation, not the pattern

`client/CLAUDE.md` says pages stay thin, and `agents/page.tsx`,
`settings/[section]/page.tsx` and `onboarding/page.tsx` do exactly that — 7–9
lines returning a colocated `*View`. But `repos/[repoId]/pulls/page.tsx` (135
lines) and `pulls/[number]/page.tsx` do the opposite: `"use client"` on the
route file itself, plus fetching, `useSearchParams` parsing and domain rules
(`OPEN_STATUSES`) inline. They're the two biggest files under `app/`, so
they're the ones you land on first when looking for "how a route is built here"
— and copying them propagates a client boundary that covers the whole route.

Use an `AgentsListView`-shaped route as the template instead: `page.tsx`
returns `<XxxView />` and nothing else; `"use client"` goes on the view.

Two more deviations in the same area, worth knowing before you extend them:
`RunTraceDrawer` nests a second `_components/` level (`.../RunTraceDrawer/
_components/TraceSection/TraceSection.tsx`, 11 path segments) — a second level
means it has outgrown "component" and wants `src/features/`. And
`src/lib/hooks/index.ts` is an `export *` aggregation barrel, so importing one
hook from `@/lib/hooks` pulls in all five modules; import from
`@/lib/hooks/core` or `@/lib/hooks/reviews` directly.

Placement rules are codified in
[`.claude/skills/frontend-ui-architecture/`](../.claude/skills/frontend-ui-architecture/SKILL.md);
its README lists these deviations so they stay visible.

### 2026-07-29 — filter chips must count the list they filter, not the raw prop

`FindingsPanel` composes two independent filters: `hideLow` (confidence) and
severity. Counting from the `findings` prop would show "1 SUGGESTION" while
that card is hidden by hide-low-confidence — the number and the list
disagree, and the chip becomes a lie.

The order that keeps them honest, in `FindingsPanel.tsx`:
`visibleFindings(findings, hideLow)` → `countBySeverity(visible)` →
`bySeverity(visible, severity)`. Counts sit *between* the two filters, so
every chip's number equals exactly what clicking it yields.
`countBySeverity` also drops zero-count severities — a chip that filters to
an empty list is a dead end.

Reset `focusIdx` to 0 whenever either filter changes. j/k navigation
otherwise points past the end of the narrowed list and the focus ring
silently vanishes.

### 2026-07-28 — run usage reaches the verdict banner via `prRuns`, not `ReviewRecord`

`ReviewRecord` (`vendor/shared/contracts/review-api.ts`) carries `run_id` but
no tokens/cost — that data lives on `RunSummary`, fetched separately by
`usePrRuns(prId)` on the PR detail page. `FindingsTab` already receives
`prRuns` for the Timeline but historically passed only `review` down to
`ReviewRunAccordion`.

To put run stats on `VerdictBanner`, build a `Map` keyed by `run_id` from the
`prRuns` the page already has and thread the matched fields down
(`FindingsTab` → `ReviewRunAccordion` → `VerdictBanner`) — no new server join
onto `reviewsForPull` needed. Gate rendering on `status === "done"`, matching
the `settled` check `RunHistory.tsx` already applies before showing
score/findings on a run row.

### 2026-07-28 — `vendor/shared` copy has already drifted from server's

`src/vendor/shared` here is an independent copy of `server/src/vendor/shared`,
not auto-synced — it's already missing fields/types the server copy has
(`sessionId`, the `openrouter` provider id, `CommitFile`/`CommitFilesPayload`).
Editing a shared contract only here does not reach the server; the server
keeps stale types and still type-checks clean.

### 2026-08-04 — `TraceBody.tsx` does not render `PromptAssembly` generically; each field needs three explicit additions

Implementing specs/05-intent-layer.md's UI (wiring `PromptAssembly.intent`
into the Run Trace drawer), the spec claimed "RunTraceDrawer's existing
PromptBlock/PromptModalBody need no new code — they already render whatever
PromptAssembly contains section-by-section." That's not true of this
component: `TraceBody.tsx`
(`app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx`)
enumerates each optional slot explicitly — `{trace.prompt_assembly.X != null
&& <PromptBlock .../>}`, plus its own `PROMPT_COLORS.X` entry
(`RunTraceDrawer/constants.ts`) and its own `trace.prompt.X` i18n key
(`messages/en/runs.json`). Proof this was already a pre-existing gap, not
something this session introduced: `pr_description` was added to
`PromptAssembly` before this session but was never wired into `TraceBody.tsx`
at all — it silently does not render in the trace drawer today, and no test
catches it (`RunTraceDrawer.test.tsx`'s fixture never asserts it renders). I
added the three pieces for `intent` but deliberately left the pre-existing
`pr_description` gap alone (out of this task's scope). Any future
`PromptAssembly` field needs the same three additions here — don't trust a
spec's "renders generically, no new code" claim about this component without
checking `TraceBody.tsx` directly.

### 2026-08-22 — `CiRun` (specs/14-export-to-ci.md, `contracts/eval-ci.ts`) carries no `agent_run_id`, so a CI run's row cannot open the shared `RunTraceDrawer` with real data

`RunTraceDrawer` fetches a persisted trace via `useRunTrace(runId)` →
`GET /runs/:id/trace`, keyed on an `agent_runs.id`. The already-committed
`CiRun` API contract exposes `id` (the `ci_runs` row's own id),
`provider_run_id` (the CI PROVIDER's run id) and `agent`/`agent_name` (the
display name) — but never the `agent_runs.id` the ingest path itself creates
(`server/src/modules/ci/service.ts persistRun()` writes it as
`ci_runs.agent_run_id`, then never maps it onto the `CiRun` the API sends,
confirmed via `toContractRun()` in the same file). Passing any of the ids the
client DOES have to `useRunTrace` doesn't error — `RunTraceDrawer.tsx` already
renders "No trace available yet" for an unresolvable id — which is exactly
what makes this a silent trap: a CI run that DID capture a real trace would
render identically to one that never captured one, with no signal anything
is wrong. Built `/ci-runs` (`app/ci-runs/_components/CiRunsView/`) to link
each row to its CI-provider URL (`github_url`) instead of wiring a
guaranteed-degenerate trace-drawer button. Closing this needs a server change
(`CiRun.agent_run_id: z.string().nullable()` + populating it in
`toContractRun()`), which was out of this pass's scope (Phase E/client-only,
Phase D already committed) — flag it explicitly rather than re-discovering it
silently if `/ci-runs` grows a "View trace" affordance later.

## Tool & Library Notes

### 2026-08-13 — `src/vendor/ui/primitives/Markdown.tsx` sets no `urlTransform` and no `img` override — it does not constrain link/image targets

Confirmed while building the Onboarding Tour page
(specs/10-onboarding-generator.md AC-32/AC-41): `Markdown.tsx` is
`react-markdown` + `remark-gfm` with no `rehype-raw` — that already blocks raw
HTML from rendering as markup (a `<script>` tag in a body renders as inert
text, AC-41), but it does NOT touch link (`a`) or image (`img`) targets.
`react-markdown`'s own default `urlTransform` only blocks `javascript:`, not
an arbitrary `https://` external — so a model-authored `[x](https://evil
.example)` or `![](https://tracker/beacon.png)` inside a markdown `body`
would render as a live link / a loading remote image if nothing upstream
stripped it first. This component is shared by every feature that renders
markdown, so it was deliberately left untouched rather than hardening it here
— the Onboarding module's `grounding.ts` (`neutralizeBody`) scans and
strips disallowed link/image targets from `body` text server-side instead,
before the client ever sees them. Any FUTURE feature that renders
model-authored or otherwise untrusted markdown through this primitive must do
the same (validate/strip targets before they reach `Markdown.tsx`, not after)
— this primitive will not save you.

### 2026-08-21 — `pnpm exec vitest run "src/app/repos/[repoId]/.../**"` silently matches ZERO files; a dynamic-route path segment is a glob character class to vitest's CLI filter

Running plans/13-multi-agent-review.md's own Phase B1 verification command
(`vitest run "src/vendor/ui/kit/**" "src/lib/hooks/**"
"src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/**" ...`)
printed `No test files found, exiting with code 1` — not an error naming the
bad pattern, just a blanket "nothing matched" for the WHOLE command, even
though `Dropdown.test.tsx`, `FindingCard.test.tsx` and `FindingsPanel.test.tsx`
all genuinely exist. Vitest's CLI positional args are glob patterns, and
`[repoId]`/`[number]` — real directory names in this App Router tree — parse
as glob character classes (`[...]`), not literal brackets, so they match
nothing. Quoting the argument does not help (that only stops the *shell* from
glob-expanding it; vitest's own glob engine still sees the brackets). Fix:
either pass the exact `*.test.tsx` file path(s) instead of a directory-glob
suffix, or escape each bracket with a backslash (`\[repoId\]`) if a directory
prefix is genuinely needed. `src/lib/hooks/**` matching zero files in the same
run is NOT this bug — this repo has no hook-level tests at all (see the
`useToast()` entry below), so that filter finding nothing is expected, not a
silent failure.

**2026-09-07 — a THIRD confirmed instance (plans/15-skill-eval-cases.md's own
client verification block), and this time the trailing `"**"` itself is
broken, independent of brackets entirely.** Running `vitest run
"src/app/skills/**" "src/app/eval/**" "src/components/eval-case-editor/**"
"src/lib/hooks/**"` — none of which contain a bracketed segment — printed
`No test files found` for the whole command, exactly like the bracket case
above. To isolate the cause, `vitest run "src/app/agents/**"` and `vitest run
"src/vendor/ui/kit/**"` were run directly: both are bracket-free directories
with real, long-established `*.test.tsx` files (`AgentEditor.test.tsx`,
`Dropdown.test.tsx`), and BOTH also returned zero matches under vitest
2.1.9. Dropping the trailing `"**"` and passing the bare directory
(`vitest run src/app/agents`, no glob suffix at all) found and ran every test
under it correctly. So the `2026-08-21` entry's framing — "brackets are the
character-class problem, plain `**` directory globs are fine" — is not
narrow enough: in this vitest version, `"<dir>/**"` as a CLI positional arg
matches nothing at all, bracketed or not, and a plan's Verification section
that hands you a `"path/**"` pattern needs translating to the bare directory
form before "no test files found" can be trusted as a real signal.

**2026-08-22 — the bug is scoped ENTIRELY to vitest's own CLI positional-arg
glob filter, never to the module graph itself.** Confirmed while building
Phase B2 (plans/13-multi-agent-review.md): a literal bracket directory name
inside a real `import ... from "..."` specifier — e.g. `MultiAgentConfigureView`
and `RunReviewDropdown` both importing D21's identity helper from
`@/app/repos/[repoId]/multi-agent/[prId]/_components/MultiAgentResultsView/helpers`
— resolves cleanly under both `pnpm typecheck` (tsc path-alias resolution) and
`pnpm build` (webpack's static import resolution). Neither ever glob-evaluates
a module specifier; only vitest's CLI arg parser does. A cross-route-tree
import that crosses two or three `[param]` folders is safe to write as-is and
needs no escaping — only a vitest invocation that later tries to *target*
that file by a bracket-containing path needs the file-path-not-glob
workaround above.

### 2026-07-29 — `borderColor` is a shorthand too, and clashes with `borderLeftColor`

`FindingCard/styles.ts` carried a comment warning "never mix `border`
shorthand with `borderLeft`" — right advice, but it missed its own case.
`borderColor` is *itself* shorthand for the four side colours, so having it
alongside `borderLeftColor` makes React warn: *"Updating a style property
during rerender (borderColor) when a conflicting property is set
(borderLeftColor)"*.

It only fires when the value actually changes mid-life — here `focused`
flipping. It sat dormant until the severity filter (which resets focus on
every filter change) made it fire on every test click.

Fix: set `borderTopColor` / `borderRightColor` / `borderBottomColor`
explicitly and leave `borderLeftColor` as the accent. `transition:
border-color` still animates all four.

### 2026-08-03 — `getByText(exactString)` throws "multiple elements" when a wrapper div has exactly one text-bearing child

`<div><span>{name}</span></div>` with no other content in the div: both the
`span` and its parent `div` have an *identical* normalized `textContent`, so
`screen.getByText("the-name")` (default `exact: true`) matches both and
throws, even though visually there's only one piece of text on the page. Hit
this in `ImportSkillDrawer.test.tsx` waiting on a preview name rendered inside
a header div that wrapped nothing else.

Don't reach for `{ exact: false }` as the fix — that spreads the ambiguity
instead of resolving it (now *more* ancestors match as a substring). Prefer
asserting on something structurally unique instead: a button's enabled state,
a `role` query, or (for prose/paragraph-shaped content where nesting is
unpredictable) `render(...).container.textContent.toContain(...)` — note that
route bypasses RTL's whitespace normalizer entirely, so a `<pre>` block's
literal `\n` must appear in the expected string, not the space RTL's default
normalizer would collapse it to.

### 2026-08-03 — counting `../` to `messages/<locale>/*.json` from a test file: measure, don't guess

Every `*.test.tsx` under `app/` imports its namespace's JSON directly
(`import messages from "../../../.../messages/en/foo.json"`), and the segment
count is easy to miscount by one once a component sits 6+ folders deep
(`skills/_components/SkillsView/_components/SkillEditor/_components/
MarkdownEditor/`). Getting it wrong fails with a Vite "Failed to resolve
import" pointing at the right file with the wrong path — not a hint about
which direction to adjust. Compute it instead of counting by eye:

```sh
node -e "console.log(require('path').relative(
  require('path').resolve('src/app/.../TargetDir'),
  require('path').resolve('messages/en/foo.json'),
))"
```

### 2026-08-03 — importing a RUNTIME value (not just a type) from `@devdigest/shared`'s barrel can make Next's webpack dev/prod build fail with a misleading "Module not found" pointing at the barrel's OWN internal `export *` lines

Two new files under `app/skills/**` — `ConfigTab.tsx` and `ImportSkillDrawer.tsx`
— both did `import { SKILL_NAME_RE, type SkillType } from "@devdigest/shared"`,
mixing a real runtime value (a `RegExp`) with a type in one specifier. `next
build` (and `next dev`) failed with `Module not found: Can't resolve
'./contracts/findings.js'` etc., blamed on `src/vendor/shared/index.ts`'s own
`export *` lines — nothing about the failing line even mentions
`SKILL_NAME_RE`. `pnpm typecheck` (tsc via vitest/tsc, not webpack) saw nothing
wrong, so this only surfaces by actually booting `next dev` or running `next
build` — **typecheck and the vitest suite are not enough evidence that a new
route boots.**

The tell: every OTHER file that imports from this barrel under `app/skills/**`
uses `import type { ... }` only (erased entirely before bundling, never
exercises the barrel's runtime resolution). The two broken files were the only
ones pulling a real value through the 10-contract `export *` barrel — and
worse, fixing the FIRST one just moved the identical error to the next file
still doing that, confirming it's about "resolving the barrel for a runtime
value from this route," not about either file individually.

Fix: import the runtime value from its OWN contract module via the narrower
alias, not the aggregating barrel — `import { SKILL_NAME_RE } from
"@devdigest/shared/contracts/knowledge"` (the `"@devdigest/shared/*"` tsconfig
path exists for exactly this). Bypassed the bug and is arguably more precise
anyway. If a THIRD file needs to import a runtime value (not just a type) from
this barrel, prefer the same narrow-module import over the barrel by default —
don't wait to rediscover this by a broken build.

**Process note:** after adding a new route with several new files, actually
boot it (`pnpm dev` + `curl`, or `next build`) before calling the feature
done — a passing `pnpm typecheck` + `pnpm test` was not sufficient evidence
here.

**Recurred 2026-08-03** in the conventions feature:
`ConventionsView/_components/CreateSkillModal/CreateSkillModal.tsx` did
`import { SKILL_NAME_RE, type ConventionCandidate } from "@devdigest/shared"`
— identical shape, identical failure (`Can't resolve './contracts/findings.js'`
in the barrel). Same fix (split the runtime value out to
`@devdigest/shared/contracts/knowledge`), plus `rm -rf .next` was needed once
to clear the dev server's cached failing module graph even after the source
fix landed. This is now a confirmed recurring trap for any new
`@devdigest/shared` consumer, not a one-off — when reviewing a diff that adds
an import from the bare `@devdigest/shared` barrel, check whether anything in
the specifier list is a value (not `type`-only) before it ships.

### 2026-08-03 — a new route needs FOUR wirings to be reachable, and the sidebar link is the one nothing errors on if you skip it

Shipping `/skills` end to end (page, hooks, i18n) still left it invisible: the
sidebar had no link to it. Three of the four things a new top-level route
needs were already in place and made it *feel* done —

1. the route itself (`app/skills/page.tsx`) — exists, 200s, fully functional
2. active-key detection (`components/app-shell/helpers.ts`) — already had
   `if (pathname.startsWith("/skills")) return "skills";`
3. the i18n label (`messages/en/shell.json` → `nav.skills: "Skills"`)

— but the FOURTH, the actual nav item, lives in a completely different file
that none of those three touch: `src/vendor/ui/nav.ts`'s `NAV: NavGroup[]`
array, a static hardcoded list `Sidebar.tsx` maps over. Skip it and nothing
throws, no test fails, `pnpm typecheck` is clean — the page is just
unreachable from the UI, silently. (2 and 3 without 4 is actually WORSE than
having none of them: the active-key logic and the label sit there ready,
creating the impression the nav is wired when it isn't.)

When adding a new top-level section, grep `src/vendor/ui/nav.ts` for the
route's key FIRST — if it's not in the `NAV` array, the route does not exist
as far as a user clicking through the sidebar is concerned, no matter how
complete everything else is. Also update `SHORTCUTS` in the same file with a
`g <letter>` entry if the section is meant to be keyboard-reachable — that
list is independent of `NAV` and drifts the same way.

**2026-08-19 — a second confirmed instance (specs/12-eval-pipeline.md, the
`/eval` dashboard): THREE of the four wirings were pre-reserved, only
`nav.ts` was missing.** `messages/en/eval.json` (a full ~60-key namespace),
`messages/en/shell.json`'s `nav.eval: "Eval Dashboard"`, and
`components/app-shell/helpers.ts:46`'s `if (pathname.startsWith("/eval"))
return "eval";` all existed and were correctly wired — `grep -rn
'useTranslations("eval")' client/src` found zero hits before this session,
which is the tell: reserved i18n + a working active-key branch with **no**
route behind them looks *more* done than it is, not less (same "worse than
having none" point the first instance made). The missing piece was, again,
exactly one `NavItemDef` in `NAV`'s array — also note lucide-react's
`BarChart3` had to be added to `vendor/ui/icons.tsx`'s registry (only the
unrelated `BarChart` was there) before the nav entry's `icon: "BarChart3"`
would even typecheck. Grepping `nav.ts` for the route key before trusting any
other "looks wired" signal remains the right first move.

**2026-08-21 — a THIRD confirmed instance (specs/13-multi-agent-review.md,
`/repos/:repoId/multi-agent`), and this time ALL FOUR of the other wirings
were already pre-reserved.** `messages/en/shell.json`'s `nav["multi-agent"]:
"Multi-Agent Review"` and `components/app-shell/helpers.ts:35`'s `if
(pathname.includes("/multi-agent")) return "multi-agent";` (already correctly
sitting *above* the `/pulls` check) both existed, and `Users` was already
registered in `vendor/ui/icons.tsx` — the ONLY missing piece was, again, one
`NavItemDef` in `NAV` plus one `ShortcutDef` in `SHORTCUTS`. Three-for-three
now: whenever a spec pre-reserves a nav label/active-key/icon ahead of the
route's implementation, assume `nav.ts` is the piece that got skipped and
check it first, not last.

### 2026-08-21 — additively widening a shared `vendor/ui/kit` primitive: add fields as optional, gate all new behavior on their presence, and the "old" call sites need zero changes or test updates

`DropdownItemDef` (`vendor/ui/kit/types.ts`) needed multi-select rows for
specs/13-multi-agent-review.md's agent picker (a `checked` state +
`keepOpen`-on-activation), and `RepoSwitcher` plus every other existing
`Dropdown` consumer in the product depend on the current single-select,
close-on-click behavior. The safe shape: both new fields are optional with no
default-changing side effect — `keepOpen` gates `onClose()` (`if
(!it.keepOpen) onClose()` replacing the unconditional call), and `checked`
(checked via `!== undefined`, not truthiness, so `checked: false` still opts a
row into the checkbox-indicator rendering) gates only an ADDED checkbox
indicator + `role="menuitemcheckbox"`/`aria-checked` — a row supplying
neither field renders and behaves byte-for-byte as before. No existing
`Dropdown` consumer or test needed a single line changed; the new coverage is
one new `Dropdown.test.tsx` (none existed before) asserting both the
unchanged default and the new opt-in behavior. This is the general recipe for
widening any shared, no-second-owner `vendor/ui` primitive: new fields
optional, new behavior gated strictly on the new field's presence (not a
value that could coincide with "unset"), zero changes to the default path.

**2026-08-22 — a fourth instance (specs/14-export-to-ci.md, `/ci-runs` +
`/agent-performance`), and this time the OPPOSITE surprise from plan 12's
`BarChart3`: both icons (`Play`/`Gauge`) were already in `vendor/ui/icons.tsx`'s
registry, so zero icon work was needed.** By the time this Phase E pass
started, an earlier pass in the same effort had already wired all four
things for both routes — `nav.ts`'s `NAV` **and** `SHORTCUTS` entries
(`g i` / `g f`), `messages/en/shell.json`'s `nav["ci-runs"]`/`nav["agent-
performance"]`, and `components/app-shell/helpers.ts`'s `startsWith` branches
for both paths. The only thing still missing was the fifth, unstated
prerequisite this pattern's first two instances didn't have to name because
it was trivially true for them: **the route itself** — `app/ci-runs/page.tsx`
and `app/agent-performance/page.tsx` did not exist, so both nav entries
pointed at 404s despite every wiring signal reading "done". Generalizing:
"all four wirings present" is necessary but not sufficient — always confirm
the route file (`app/<path>/page.tsx`) actually exists on disk before trusting
`nav.ts` + i18n + `helpers.ts` as proof a feature is reachable.

### 2026-08-03 — a repo-scoped feature route (`/repos/:repoId/...`) has its own established pattern; don't reach for the workspace-scoped one

Built `/repos/:repoId/conventions` (specs/03) right after `/skills` existed as
the nearest example, but `/skills` is workspace-global — the actual template
for anything scoped to the *active repo* is `repos/[repoId]/pulls`:
`useParams<{ repoId: string }>()` for the id, `useActiveRepo()` for the repo
object (`activeRepo?.full_name`, never trust the raw route param as a display
name), and `useRepoNotFound(repoId)` gating an early `<RepoNotFound />` return
before anything else renders. `nav.ts` entries route through the same
`:repoId` token (`resolveHref`) that `useActiveRepo`'s pathname-first
resolution already expects — no new wiring needed there beyond adding the
`NavItemDef`.

### 2026-08-04 — a mutation hook writing its own result via `setQueryData` in `onSuccess` can still be overwritten by a GET that was already in flight

`useSetConventionStatus` (`src/lib/hooks/conventions.ts`) calls
`qc.setQueryData(conventionsKeys.list(repoId), ...)` in `onSuccess` to avoid a
refetch round-trip. That's not actually safe on its own: `useConventions` has
no `staleTime`, so if a `GET /conventions` was already in flight when the
mutation started (e.g. a background refetch, or the query mounting right as
the user clicks accept/reject), that GET can resolve *after* the mutation's
`onSuccess` and silently overwrite the just-written status with the
pre-mutation snapshot — the card flips back to "pending" until the next
refetch, with no error anywhere. Caught by an automated PR review, not by any
test (this codebase has no hook-level tests — see `client/CLAUDE.md`'s
component-test convention — so a race between two query-client operations
isn't exercised).

Fix: `qc.cancelQueries({ queryKey: conventionsKeys.list(repoId) })` in
`onMutate`, before the mutation fires — cancelling the in-flight GET makes
React Query discard its result instead of letting it land and win the race.
Any future mutation hook here that writes its own `setQueryData` result
(instead of just `invalidateQueries`) needs the same `onMutate` cancel, not
just a `staleTime` bump — `staleTime` prevents a *new* refetch from firing,
it doesn't stop one that's already in flight from resolving late.

### 2026-08-04 — a component under test that calls `useToast()` does not need `<ToastProvider>` in the tree — `vi.spyOn` it like any other hook

`useToast()` (`src/lib/toast.tsx`) throws `"useToast must be used within
<ToastProvider>"` if the context is missing, which makes it look like any
component calling it needs the real provider mounted for tests (pulling in
its portal/state machinery just to assert a mutation's success/error path).
It doesn't — `VersionsTab.test.tsx` (new `Restore` button, first place this
came up) does `vi.spyOn(toastLib, "useToast").mockReturnValue({ success:
vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() })`, same shape as the
existing `vi.spyOn(hooks, "useSkillVersions")` query-hook mocking pattern
already used across this test suite (see `StatsTab.test.tsx`). Reach for this
before wrapping a test tree in `<ToastProvider>` for any component that only
needs to prove a toast method was *called*, not that a toast actually renders.

### 2026-08-03 — a component that unconditionally calls two mutation hooks (one per "mode") breaks an existing test that only mocked one

Added a URL-import tab to `ImportSkillDrawer` alongside the existing file tab.
Both `useImportSkillPreview()` and the new `useImportSkillFromUrlPreview()`
are called unconditionally at the top of the component (correct per rules of
hooks — you can't call a hook only in one branch), but the FILE-mode test
suite only mocked the first one via `vi.spyOn`. The second hook hit the real
`useMutation` and failed with "No QueryClient set" — a failure with no
apparent connection to the file-mode test itself, since that test never
touches the URL tab. Whenever a component grows a second parallel hook call
for an alternate mode, go back and stub it in every EXISTING test for that
component, not just the new test for the new mode — the old tests will fail
for a reason invisible from their own diff.

**2026-08-19 — same trap, not "per mode" this time but "per action type"
(specs/12-eval-pipeline.md's FindingCard "turn into eval case" action).**
`FindingsPanel.tsx` already called `useFindingAction()` unconditionally;
adding the eval-case action meant a SECOND unconditional call,
`useCreateEvalCaseFromFinding()` (plus `useToast()`, itself unconditional and
throwing outside a `<ToastProvider>` — see the `useToast()` entry above),
purely to branch on the action id inside one `onAction` handler. Every
pre-existing `FindingsPanel.test.tsx` case broke the same way ("No
QueryClient set") until `../../../../../../../lib/hooks/eval` and
`../../../../../../../lib/toast` were ALSO `vi.mock`'d there, even though
none of those tests exercise the new action. Generalizing the lesson: this
isn't specific to "alternate mode" tabs — ANY new unconditional hook call
added to an already-tested component needs the same test-file update, found
only by actually running that component's existing suite, not by reading the
diff.

## Recurring Errors & Fixes

### 2026-08-13 — `activeKeyFor`'s `pathname.includes(...)` checks are a substring-match bug class, not just the one `/onboarding` case

`components/app-shell/helpers.ts`'s `activeKeyFor` matched the Onboarding Tour
nav key via `pathname.includes("/onboarding")` — but `/onboarding` is also the
real route for the unrelated add-a-repo screen (`src/app/onboarding/page.tsx`),
so visiting that screen wrongly highlighted "Onboarding Tour" in the sidebar
(specs/10-onboarding-generator.md D10/AC-39; the tour route itself is
`/repos/:repoId/tour`, chosen specifically to share no segment with
`/onboarding`). Fixed with a local `hasSegment(pathname, seg)` helper
(`pathname.split("/").includes(seg)`) instead of `.includes()` on the raw
string. The other rows in `activeKeyFor` (`/context`, `/conventions`,
`/pulls`, `/multi-agent`) still use `.includes()` and carry the same latent
risk — e.g. a future `/pulls-archive` or `/context-help` route would
misfire the same way. Don't add a new route whose slug is a substring of an
existing one without checking `activeKeyFor` first; prefer `hasSegment` for
any NEW entry, and consider migrating the existing `.includes()` rows the
next time one of them causes a real collision.

### 2026-07-28 — PR-list columns live in three places that must stay in sync

Adding a column to the PR list means editing `COLUMN_KEYS` *and* `GRID` in
`src/app/repos/[repoId]/pulls/constants.ts` — `GRID` is a
`grid-template-columns` string whose track count must match `COLUMN_KEYS`
length, and it's consumed by both `s.headRow` and `s.row` in `styles.ts`. Add
the cell to `PRRow.tsx` in the same ordinal position, plus a label under
`list.columns` in `messages/en/prReview.json`. Miss the `GRID` track and the
header/row cells silently shear apart by one column with no error.

Testing note: asserting `getByText("—")` on a PR row is ambiguous — the
Updated cell renders "—" too whenever `updated_at` is null (`relativeTime`).
Give the fixture a real `updated_at` so the em dash under test is unique.

### 2026-08-06 — a written spec's UI section can describe the wrong placement; a design mockup screenshot overrides prose

`specs/07-blast-radius.md` said "a Blast Radius **tab** on the PR detail
page" and the first implementation pass built exactly that — a fourth
`PrDetailHeader` tab, `BlastRadiusTab`. The actual product design (per a
mockup screenshot the user supplied afterward) places it as a **card** on the
Overview tab, side by side with `IntentCard` in a two-column grid — no new
top-level tab at all. Corrected by deleting `BlastRadiusTab/` and adding
`BlastRadiusCard/` (mirrors `IntentCard`'s folder shape: `SectionLabel`
header, no outer `Card` wrapper at the section level), wired into
`OverviewTab`'s new `s.overviewGrid` (`gridTemplateColumns: "1fr 1fr"`)
instead of `PrDetailHeader`'s `tabs` array. The prose spec had no cross-check
against a design mockup — when one exists (or the user later supplies one),
it is the source of truth for placement/layout, not the spec's word choice.
`specs/07-blast-radius.md` itself was amended after the fact to describe the
card, so it stays accurate for the next reader.

### 2026-08-06 — `PrDetailView`'s own `maxWidth: 1080` (not the sitewide `PageShell` 1200) was capping every PR-detail tab narrower than the figma

Reported as "cards look narrower than figma" across all three PR-detail tabs
(Overview, Agent runs, Files changed) — not just the new `BlastRadiusCard`.
`PrDetailView/styles.ts`'s `s.body`/`s.loadingStack` had their own
`maxWidth: 1080; margin: 0 auto`, independent of (and narrower than)
`page-shell/styles.ts`'s sitewide `maxWidth: 1200` used by list-style pages
(Pull Requests list, Agents list, etc.). No child component in the PR-detail
tree (`OverviewTab`, `FindingsTab`, `DiffTab` and everything under them —
confirmed by a repo-wide grep for `maxWidth` scoped to
`_components/[repoId]/pulls/[number]`) added its own width cap — this was
the only constraint. Fixed by dropping the `maxWidth`/`margin: auto` from
both, keeping only the padding — this page's figma is a full-bleed,
data-dense layout, unlike the sitewide list-page standard. If a future page
in this tree wants a narrower reading width for a text-heavy section (e.g.
a single-column article-style body), scope the constraint to that specific
child, not `PrDetailView`'s shared body wrapper — that wrapper is now
intentionally unconstrained for every tab this page contains.

### 2026-08-06 — a second hook can read a slice of an already-fetched query with zero extra requests, via a matching `queryKey` + `select`

Extracting `IntentCard` out of `OverviewTab` (mentor feedback on PR #6) needed
its own data-fetching hook rather than taking the five `intent_*` fields as
props — but `usePullDetail(prId)` (`lib/hooks/core.ts`) already fetches the
whole `PrDetail` including those fields, and `PrDetailView` mounts `IntentCard`
only after that fetch has already resolved. `lib/hooks/intent.ts`'s
`useIntent(prId)` reuses `usePullDetail`'s exact `queryKey: ["pull", prId]`
and `queryFn`, adding only a `select: toIntent` to narrow the return shape —
React Query treats identical `queryKey`+`queryFn` calls as the SAME cache
entry (dedup is by key, not by call site), so this issues zero additional
network requests and still gets its own render-optimized (via `select`) view
of the data. Any future "give this leaf component its own hook instead of
prop-drilling a slice of an already-fetched parent query" need can use this
shape instead of either prop-drilling or a second real fetch.

Testing it followed this repo's already-established convention (see
`StatsTab.test.tsx`/`VersionsTab.test.tsx`), confirmed still the only pattern
in use as of this date: mock the hook module itself
(`vi.spyOn(hooks, "useIntent").mockReturnValue({ data, ... })`) inside a bare
`QueryClientProvider` wrapper, never a real `fetch` stub — this codebase has
no `global.fetch`/`msw` mocking anywhere in `client/src`, confirmed by a
repo-wide grep while building `IntentCard.test.tsx`.

### 2026-08-19 — `api.ts`'s `post`/`patch`/etc. discard the HTTP status; an idempotent-create route needs a status-aware variant to tell "created" from "already existed"

`POST /findings/:id/eval-case` (specs/12-eval-pipeline.md D17/AC-1) returns
201 on a genuine create and 200 when a case for that finding already exists
— the BODY shape is identical either way (`EvalCase`), so the only signal a
caller has is the status code, and `api.post` (`src/lib/api.ts`) discarded it
before this session. Rather than have `useCreateEvalCaseFromFinding`
re-derive "was this just created" from timestamps (fragile, and wrong at
whole-second resolution), `apiFetch` was split into an internal
`apiFetchWithStatus` returning `{ data, status }`, with `apiFetch` staying
the status-discarding convenience every other hook keeps using, plus one new
additive `api.postWithStatus`. Any future idempotent-POST route that needs to
distinguish "created" from "returned existing" client-side should use
`api.postWithStatus`, not thread a `created` flag through the response body
just to work around `api.post`'s discarded status.

## Session Notes

### 2026-08-27 — test-writer backfill for specs/14: `CiTab.tsx` reads `inst.last_run_status`/`inst.last_run_at`, fields the real API response never sends

Writing `CiTab.test.tsx` surfaced a real bug, not fixed here (test-writer role
— reported, not patched). `GET /agents/:id/ci/installations`
(`CiService.listInstallationsForAgent` → `toContractInstallation`, `server/
src/modules/ci/service.ts`) returns the `CiInstallation` contract shape,
which nests last-run data under `last_run: {status, ran_at, findings_count} |
null` (`vendor/shared/contracts/eval-ci.ts`). `CiTab.tsx` (lines ~115-126)
instead reads `inst.last_run_status` and `inst.last_run_at` directly — flat
fields that exist only on `hooks/ci.ts`'s `CiInstallationListItem` TYPE
(lines ~30-32), a type assertion at the API boundary with no actual reshaping
code behind it. Confirmed via `grep -rn "last_run_status\|last_run_at"
server/src client/src`: the server writes only the nested `last_run` object,
never flat sibling fields, for this route. Net effect: the CI tab's
per-installation badge always falls back to "Never run" (`inst.last_run_
status` is `undefined`) and the timestamp never renders, regardless of actual
CI run history — silently, no error, no failing existing test (nothing
asserted on this rendering path before this session). `CiTab.test.tsx`
deliberately does not assert on the badge text for this reason — asserting
against the flat shape would encode the bug as correct behavior. Fix needs
either `toContractInstallation` to also emit flat `last_run_status`/`last_
run_at` siblings, or (cleaner) `CiTab.tsx` to read `inst.last_run?.status`/
`inst.last_run?.ran_at` and drop `CiInstallationListItem`'s flat fields
entirely.

### 2026-08-12 — test-writer backfill for specs/09: the shared `ContextTab`'s keyboard reorder path and `ProjectContextView`'s empty state had zero coverage

Checking plans/09-project-context-folder.md's client test matrix ("reorder
(drag+keyboard)" / "the view-only page's empty state") against
`src/components/context-tab/ContextTab/ContextTab.test.tsx` and
`.../ProjectContextView/ProjectContextView.test.tsx` found both genuinely
untested despite the implementer session landing the code: (1) `DocumentRow`'s
drag handle has an `onKeyDown` that calls `drag.onMove(±1)` on ArrowUp/
ArrowDown — the existing test suite only exercised mouse drag
(`fireEvent.dragStart`/`drop`), never `fireEvent.keyDown(handle, { key:
"ArrowDown" })`, and never asserted the `reorderAnnounce` live-region text
(`"Moved {path} to position {position} of {total}"`), which is a DIFFERENT
i18n key from the already-tested `attachAnnounce`/`detachAnnounce`, so
testing one gave no signal about the other. (2) `ProjectContextView` branches
on `documents.length === 0` to render `EmptyState` with `t("page.empty.body",
{ roots })`, but every existing test fixture supplied a non-empty
`DocumentList` — the empty-state/roots-named branch (AC-20) had never been
rendered under test at all. Both backfilled. General lesson matching the
server-side entry of the same date: a `plan-verifier` PASS proves the
component exists and behaves per the plan's *description*, not that every row
of the plan's own Verification test matrix has a corresponding test — worth
re-deriving the matrix's exact wording (not just skimming existing test
titles) before calling a component's coverage complete.

## Open Questions

### 2026-07-28 — `formatTokens` is coarse below 1K

`formatTokens` renders in thousands with one decimal, per the spec'd
"8.2K→1.3K" format. Typical completion sizes here are small (125 tokens →
"0.1K"), so the out-side is often near-meaningless. Left as-is to match the
agreed format; revisit if the token figures are meant to be read precisely
rather than as a magnitude.
