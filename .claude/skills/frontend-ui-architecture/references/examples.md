# Before / after: four restructures

Four failure modes that account for most placement problems, each with the tree before, the tree
after, and the reasoning. Use these when explaining a restructure or executing one.

Contents:
1. [The flat app that outgrew itself](#1-the-flat-app-that-outgrew-itself)
2. [The bloated `utils.ts`](#2-the-bloated-utilsts)
3. [The route importing from another route](#3-the-route-importing-from-another-route)
4. [The page holding business logic](#4-the-page-holding-business-logic)

---

## 1. The flat app that outgrew itself

**Symptom:** `src/components/` has 60 files. Nobody can tell which page a component belongs to,
so nobody dares delete anything.

### Before

```
src/
├── app/
│   ├── page.tsx
│   ├── repos/page.tsx
│   └── repos/[repoId]/pulls/page.tsx
└── components/
    ├── pr-row.tsx              # used by one page
    ├── pr-row-skeleton.tsx     # used by one page
    ├── pr-status-badge.tsx     # used by one page
    ├── repo-card.tsx           # used by one page
    ├── repo-import-dialog.tsx  # used by one page
    ├── severity-filter.tsx     # used by two pages
    ├── button.tsx              # used everywhere
    ├── dialog.tsx              # used everywhere
    └── ... 52 more
```

### After

```
src/
├── app/
│   ├── page.tsx
│   ├── repos/
│   │   ├── page.tsx
│   │   └── _components/
│   │       ├── repo-card/
│   │       │   ├── repo-card.tsx
│   │       │   └── repo-card.test.tsx
│   │       └── repo-import-dialog/
│   │           └── repo-import-dialog.tsx
│   └── repos/[repoId]/pulls/
│       ├── page.tsx
│       └── _components/
│           ├── pr-row/
│           │   ├── pr-row.tsx
│           │   ├── pr-row.test.tsx
│           │   └── helpers.ts
│           ├── pr-row-skeleton/
│           └── pr-status-badge/
└── components/                        # only what 2+ routes actually use
    ├── button/
    ├── dialog/
    └── severity-filter/
```

**What changed:** nothing about the code — only where the files sit. The move is mechanical: for
each component, count its importers. One importer → it moves next to that importer. Two or more →
it stays in `src/components/`.

**What you get:** deleting a route now deletes its components with it. `src/components/` becomes a
short list you can actually read, and everything in it is shared *by evidence*, not by hope.

---

## 2. The bloated `utils.ts`

**Symptom:** `src/lib/utils.ts` is 600 lines and every feature imports it, so every feature
depends on every other feature's helpers through one module.

### Before

```ts
// src/lib/utils.ts — 600 lines
export function clamp(n, min, max) {}
export function groupBy(items, key) {}
export function formatRelativeTime(date) {}
export function formatPrTitle(pr: PullRequest) {}          // knows about PRs
export function severityRank(s: Severity) {}               // knows about findings
export function isReviewRunStale(run: ReviewRun) {}        // knows about review runs
export function repoSlug(repo: Repo) {}                    // knows about repos
// ...
```

### After

```
src/
├── lib/utils/                     # domain-free — could be published as-is
│   ├── clamp.ts
│   ├── group-by.ts
│   └── format-relative-time.ts
└── app/
    ├── repos/_lib/helpers.ts               # repoSlug
    └── repos/[repoId]/pulls/
        ├── _components/pr-row/helpers.ts   # formatPrTitle
        └── _lib/review-run-helpers.ts      # severityRank, isReviewRunStale
```

**The sorting rule:** could this function be published to npm unchanged and still make sense?
`clamp` yes → `lib/utils/`. `formatPrTitle` no, it imports your `PullRequest` type → it is a
helper, and it belongs next to the code that owns that concept.

**What you get:** the import graph stops being a hairball. A change to how PR titles render can no
longer ripple into the repos page, because they no longer share a module.

---

## 3. The route importing from another route

**Symptom:** `app/settings/page.tsx` starts with
`import { SeverityFilter } from '../pulls/_components/severity-filter'`.

### Before

```
app/
├── pulls/
│   ├── page.tsx
│   └── _components/severity-filter/severity-filter.tsx
└── settings/
    └── page.tsx     ← imports ../pulls/_components/severity-filter
```

That import is a lie about ownership: the component is now shared, but it lives in a folder named
after one consumer. Delete the pulls route and settings breaks for no discoverable reason.

### After

```
src/
├── components/
│   └── severity-filter/
│       ├── severity-filter.tsx
│       ├── severity-filter.test.tsx
│       └── index.ts                     # entry point (enforced by lint, not by re-export habit)
└── app/
    ├── pulls/page.tsx                   → @/components/severity-filter
    └── settings/page.tsx                → @/components/severity-filter
```

If both routes live under the same section, promote to that section instead of all the way to the
top:

```
app/(review)/
├── _components/severity-filter/
├── pulls/page.tsx
└── settings/page.tsx
```

**What you get:** the folder now tells the truth about who owns the component, and the lint rule in
`eslint-boundaries.md` keeps the sideways import from coming back.

---

## 4. The page holding business logic

**Symptom:** `page.tsx` is 200 lines, half of it is SQL and permission checks, and none of it can
be tested without rendering a route.

### Before

```tsx
// app/repos/[repoId]/pulls/page.tsx
export default async function Page({ params }) {
  const { repoId } = await params
  const session = await auth()
  const [rows] = await sql`SELECT * FROM pull_request WHERE repo_id = ${repoId}`
  const visible = rows.filter((r) => session.user.isAdmin || r.authorId === session.user.id)
  const sorted = visible.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
  return <ul>{sorted.map((pr) => <PrRow key={pr.id} pr={pr} />)}</ul>
}
```

Three problems, all placement problems: the raw row objects flow into components (so every DB
column reaches the client), the authorization check lives somewhere no auditor will look, and
sorting cannot be unit-tested.

### After

```
src/
├── server/
│   └── pulls.ts               # import 'server-only' — query + authz + DTO
└── app/repos/[repoId]/pulls/
    ├── page.tsx               # thin
    └── _lib/sort-pulls.ts     # pure, testable
```

```tsx
// src/server/pulls.ts
import 'server-only'
import { auth } from '@/lib/auth'

export async function getPullsForRepo(repoId: string) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')
  const [rows] = await sql`SELECT id, title, severity, author_id FROM pull_request WHERE repo_id = ${repoId}`
  return rows
    .filter((r) => session.user.isAdmin || r.author_id === session.user.id)
    .map(toPullRequestDTO)          // only the fields the UI needs
}

// app/repos/[repoId]/pulls/page.tsx
export default async function Page({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params
  const pulls = sortPulls(await getPullsForRepo(repoId))
  return <PullList pulls={pulls} />
}
```

**What you get:** one place an auditor checks for authorization; a DTO boundary that stops extra
columns reaching the browser; a `sortPulls` you can test in milliseconds; and a page short enough
that its job is obvious. Server Actions follow the same shape — thin action, logic in the DAL.

---

## Executing a restructure

1. **One layer at a time.** Move all the components, or all the utils — not "some of each".
   A half-migrated tree is worse than either tree, because now there are two conventions.
2. **Moves before edits.** Land pure file moves in their own commit (`git mv`, fix imports, no
   logic changes). Review is trivial and the diff stays honest.
3. **Turn on the linter at the end of each layer**, so the layer you just fixed cannot regress
   while you work on the next one.
4. **Stop when the tree stops hurting.** The goal is that the next person knows where to put a new
   file — not that the tree matches this document.
