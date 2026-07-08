# Development Plan: Expose pr_intent Classification Data in PR Overview Tab

**Date:** 2026-06-30
**Status:** Ready for implementation
**Scope:** Full-stack — server + client
**Affects modules:**

- `server/src/modules/reviews/` — new route + workspace-scoped repo method
- `client/src/lib/hooks/reviews.ts` — new TanStack Query hook
- `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/` — new component + tab logic

---

## 1. Context

The `run-executor` already classifies PR intent via `classifyIntent()` on every review run and writes the result to the `pr_intent` table (`server/src/modules/reviews/repository/pull.repo.ts` — `upsertIntent`). However, no API endpoint or UI consumes this data.

The existing `IntentCard` reads from `pr_brief` (seed-only). Live PRs always show a "not generated" placeholder. This plan wires the `pr_intent` table to the UI so live PRs display intent after a review run.

---

## 2. Architecture Fit

```text
pr_intent table
    ↓ (already written by run-executor on every review run)
GET /pulls/:id/intent  [NEW — server/reviews/routes.ts]
    ↓
usePrIntent(prId)  [NEW — client hook]
    ↓
LiveIntentSection  [NEW — OverviewTab sub-component]
    ↓
OverviewTab  [UPDATED — adds fallback to LiveIntentSection when brief=null]
```

`pr_brief` (seed) path unchanged — `IntentCard` keeps reading from `usePrBrief`.

---

## 3. Skills Applied

- `fastify-best-practices` — route + Zod schema
- `backend-onion-architecture` — keep DB query in repository, not in route
- `react-best-practices` — no `useEffect` for data; TanStack Query
- `zod` — response schema definition

---

## 4. Constraints

- No new DB migrations — `pr_intent` table already exists in `0000_init.sql`
- Every DB query MUST scope by `workspace_id` — use INNER JOIN with `pull_requests`
- `getIntent` in `pull.repo.ts` is already used by `run-executor` without workspace scope (correct — called within verified workspace context). Add a **new** `getIntentScoped` for the public API.
- `reviewer-core` — no changes
- `@devdigest/shared` — `Intent` type already exists in `contracts/brief.ts`; `PrIntentRecord` in `contracts/review-api.ts`. Use existing types.
- Client API calls only via `apiFetch` / `api.*` from `src/lib/api.ts`
- No Shadcn, no Radix — use existing `src/vendor/ui/` primitives

---

## 5. Implementation Steps

Tasks 1–2 are sequential (repo → route). Tasks 3–5 are independent (parallel). Task 6 depends on 3–5.

### Task 1 — Add workspace-scoped `getIntentScoped` to `pull.repo.ts`

**File:** `server/src/modules/reviews/repository/pull.repo.ts`

Add after the existing `getIntent` function:

```ts
export async function getIntentScoped(
  db: Db,
  prId: string,
  workspaceId: string,
): Promise<Intent | undefined> {
  const [row] = await db
    .select({ intent: t.prIntent.intent, inScope: t.prIntent.inScope, outOfScope: t.prIntent.outOfScope })
    .from(t.prIntent)
    .innerJoin(t.pullRequests, eq(t.prIntent.prId, t.pullRequests.id))
    .where(and(eq(t.prIntent.prId, prId), eq(t.pullRequests.workspaceId, workspaceId)));
  if (!row) return undefined;
  return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope };
}
```

Imports needed: `Intent` from `@devdigest/shared` (already imported).

### Task 2 — Expose on `ReviewRepository`

**File:** `server/src/modules/reviews/repository.ts`

Add to `ReviewRepository` class alongside the existing `getIntent`:

```ts
getIntentScoped(prId: string, workspaceId: string): Promise<Intent | undefined> {
  return pullRepo.getIntentScoped(this.db, prId, workspaceId);
}
```

### Task 3 — Add API route `GET /pulls/:id/intent`

**File:** `server/src/modules/reviews/routes.ts`

Add a new route in the Fastify plugin. Pattern mirrors `GET /pulls/:id/brief`:

```ts
app.get(
  '/pulls/:id/intent',
  {
    schema: {
      params: z.object({ id: z.string() }),
      response: {
        200: z.object({
          intent: z.string(),
          in_scope: z.array(z.string()),
          out_of_scope: z.array(z.string()),
        }).nullable(),
      },
    },
  },
  async (req) => {
    const workspaceId = req.workspaceId; // from workspace plugin
    const result = await repo.getIntentScoped(req.params.id, workspaceId);
    return result ?? null;
  },
);
```

Note: `req.workspaceId` follows the same pattern as the existing brief route.

### Task 4 — Add `usePrIntent` hook

**File:** `client/src/lib/hooks/reviews.ts`

Add after `usePrBrief`:

```ts
export function usePrIntent(prId?: string | null) {
  return useQuery({
    queryKey: ['pull-intent', prId],
    queryFn: () => apiFetch<{ intent: string; in_scope: string[]; out_of_scope: string[] } | null>(
      `/pulls/${prId}/intent`
    ),
    enabled: !!prId,
    staleTime: 5 * 60 * 1000,
  });
}
```

### Task 5 — Create `LiveIntentSection` component

**File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/LiveIntentSection.tsx`

Displays intent + in_scope + out_of_scope. No risk chips (not in `pr_intent`). Reuses styles from `./styles`.

```tsx
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

interface LiveIntentProps {
  intent: string;
  in_scope: string[];
  out_of_scope: string[];
}

export function LiveIntentSection({ intent, in_scope, out_of_scope }: LiveIntentProps) {
  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <Icon.Target size={12} />
        Intent
      </div>
      <div style={s.cardBody}>
        <blockquote style={s.intentQuote}>"{intent}"</blockquote>
        <div style={{ display: "flex", gap: 20 }}>
          {in_scope.length > 0 && (
            <div style={{ ...s.scopeSection, flex: 1 }}>
              <div style={s.scopeHeader("var(--ok)")}>In scope</div>
              {in_scope.map((item, i) => (
                <div key={i} style={s.scopeItem}>
                  <Icon.Check size={12} style={{ color: "var(--ok)", flexShrink: 0, marginTop: 2 }} />
                  {item}
                </div>
              ))}
            </div>
          )}
          {out_of_scope.length > 0 && (
            <div style={{ ...s.scopeSection, flex: 1 }}>
              <div style={s.scopeHeader("var(--text-muted)")}>Out of scope</div>
              {out_of_scope.map((item, i) => (
                <div key={i} style={s.scopeItem}>
                  <Icon.X size={12} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 2 }} />
                  {item}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

Uses `Icon.Target` to distinguish from the seeded `IntentCard` (which uses `Icon.GitBranch`).

### Task 6 — Update `OverviewTab`

**File:** `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx`

- Import `usePrIntent` and `LiveIntentSection`
- Add `const { data: prIntent } = usePrIntent(prId);`
- Update the card grid logic:

```text
brief non-null           → IntentCard (seed, full brief with risks)  [unchanged]
brief null + prIntent    → LiveIntentSection (live, no risks) + BlastRadius placeholder
brief null + no prIntent + review exists → "not generated" placeholders  [unchanged]
```

Specifically the card grid section becomes:

```tsx
{brief ? (
  <div style={s.cardGrid}>
    <IntentCard brief={brief} />
    <BlastRadiusCard brief={brief} />
  </div>
) : prIntent ? (
  <div style={s.cardGrid}>
    <LiveIntentSection
      intent={prIntent.intent}
      in_scope={prIntent.in_scope}
      out_of_scope={prIntent.out_of_scope}
    />
    <div style={{ ...s.card, display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 8, minHeight: 120, color: "var(--text-muted)", fontSize: 13 }}>
      <Icon.Clock size={18} style={{ opacity: 0.4 }} />
      <span><strong>Blast radius</strong> analysis not generated for this PR.</span>
    </div>
  </div>
) : latest?.verdict ? (
  // existing "not generated" placeholders for both cards
  ...
) : null}
```

---

## 6. Acceptance Criteria

```sh
# Route exists and returns 200/null
curl http://localhost:3001/pulls/<seeded-pr-id>/intent   # → { intent, in_scope, out_of_scope }
curl http://localhost:3001/pulls/<live-reviewed-pr>/intent # → object after review runs

# Workspace scoping: cross-workspace access returns null
# (PR from workspace A not accessible from workspace B token)

# TypeScript clean
cd server && node node_modules/typescript/bin/tsc --noEmit
cd client && node node_modules/typescript/bin/tsc --noEmit

# UI: PR with completed review shows LiveIntentSection (not placeholder)
# UI: PR without review still shows placeholder
# UI: PR with seed brief still shows IntentCard (unchanged)
```

---

## 7. Testing Plan

- **Unit** (`server`) — `getIntentScoped`: test that cross-workspace query returns `undefined`; test happy path with matching workspace
- **Integration** (`server`) — `GET /pulls/:id/intent` route: inject request, assert 200 with intent object; assert null when no intent exists; assert null (or 404) when PR belongs to different workspace
- **Client** — `usePrIntent`: mock `apiFetch`, assert `queryKey` shape and `enabled: false` when `prId` is nullish
- **Smoke** — verify `OverviewTab` renders `LiveIntentSection` when `brief=null` and `prIntent` is non-null (RTL with mocked hooks)

---

## 8. Out of Scope

- No changes to `reviewer-core`
- No changes to `pr_brief`, seed data, or `IntentCard`
- No blast radius data from `pr_intent` (the table only stores intent)
- No risk chips in `LiveIntentSection` (risks are not in `pr_intent`)
- No new DB migrations
- No i18n keys (plain strings inline, consistent with existing OverviewTab placeholders)
- No changes to how `pr_intent` is written (run-executor already handles this)
