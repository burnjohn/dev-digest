# HW L07 Feedback — Test Coverage Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two gaps a mentor's review of the L07 homework (SPEC-07
Multi-Agent Review lab) flagged: `findings-cluster.ts`'s fixed-point
clustering has no unit tests, and there is no `deriveLiveColumns`-shaped,
independently testable function for the running/done/failed-per-agent live
status overlay `ColumnsView` renders.

**Architecture:** Both gaps are closed the same way — pull already-existing,
already-correct logic out where it can be exercised without I/O or React
rendering, then write vitest coverage for the corner cases the feedback
named. Task 1 is test-only (`clusterFindings` in
`server/src/modules/reviews/findings-cluster.ts` is already the fixed-point,
order-independent algorithm — see `server/INSIGHTS.md`'s 2026-08-22 entries —
it just has zero test coverage). Task 2 extracts the per-run view-model
computation that currently lives inline inside `ColumnsView.tsx`'s JSX into a
pure `deriveLiveColumns()` in a new colocated `helpers.ts`, following this
repo's own established `_components/<Name>/helpers.ts` + `<Name>/helpers.test.ts`
pattern (already used by `client/src/components/app-shell/helpers.ts`, and by
the `outcomeOf` promotion into `client/src/lib/run-outcome.ts` that
`ColumnsView.tsx` already calls).

**Tech Stack:** TypeScript, Vitest. Server tests: plain Vitest, no DB/Postgres
needed (`clusterFindings` is a pure function, no I/O). Client tests: Vitest +
`@devdigest/shared` fixture types — `helpers.test.ts` needs no
`@testing-library/react` render, since `deriveLiveColumns` is plain data-in/
data-out.

**Spec:** No spec file — this plan responds directly to mentor feedback on
the finished SPEC-07 (`docs/specs/SPEC-07-multi-agent-review.md`) lab
homework, not a new feature. AC-18/AC-19/AC-20 (clustering rules) are the
relevant acceptance criteria already defined in that spec; nothing here
changes product behavior, only adds test coverage and one internal
refactor.

## Global Constraints

- **No behavior change.** Task 2's extraction must render byte-identical
  output — this is a refactor for testability, not a feature change.
- **`server/` conventions** (`server/CLAUDE.md`, `TESTING.md`): new server
  test goes in `server/test/<name>.test.ts` (flat, not colocated — matches
  every existing `*.test.ts` in that directory), imports via relative `.js`
  extensions (ESM), no `.it.test.ts` suffix (no DB needed).
- **`client/` conventions** (`client/CLAUDE.md`): colocated
  `_components/<Name>/helpers.ts` + `<Name>/helpers.test.ts`, `"use client"`
  files stay component-only — the extracted helper is a plain `.ts` file,
  no `"use client"` directive needed since it does no React/DOM work.
- Run the smallest check that could catch the change (root `CLAUDE.md`): both
  tasks are pure additions/refactors inside `server/` and `client/`
  respectively — no `.claude/skills/**`, `.claude/agents/**`, or root
  `CLAUDE.md` changes, so `evals/` tiers do not apply here.

---

## Task 1: Unit tests for `clusterFindings` (findings-cluster.ts)

**Files:**
- Create: `server/test/findings-cluster.test.ts`
- Read (no changes expected): `server/src/modules/reviews/findings-cluster.ts`,
  `server/src/db/rows.ts` (`FindingRow` type)

**Interfaces:**
- Consumes: `clusterFindings(items: ClusteredFinding[]): FindingCluster[]`,
  `ClusteredFinding { finding: FindingRow; agentId: string | null; agentName: string | null }`,
  `FindingCluster { file: string; start_line: number; end_line: number; findings: ClusteredFinding[] }`
  — all exported from `server/src/modules/reviews/findings-cluster.ts`.
- Produces: nothing (leaf test file).

This task is characterization/regression testing of existing, already-correct
code (see `server/INSIGHTS.md`'s two 2026-08-22 `clusterFindings` entries —
the fixed-point pairwise-merge algorithm was already verified order-
independent by direct repro when it was written). There is no red step here
in the usual TDD sense: every assertion below is expected to pass on the
first run, because it pins down behavior the function already has. Still run
the test after writing it (Step 2) to catch a typo in the test itself, not to
catch a production bug.

- [ ] **Step 1: Write the test file**

```typescript
// server/test/findings-cluster.test.ts
import { describe, it, expect } from 'vitest';
import { clusterFindings } from '../src/modules/reviews/findings-cluster.js';
import type { ClusteredFinding } from '../src/modules/reviews/findings-cluster.js';
import type { FindingRow } from '../src/db/rows.js';

/**
 * `clusterFindings` (AC-18/19/20, `findings-cluster.ts`) is the one piece of
 * "Where agents disagree" that never got unit coverage in the L07 homework —
 * flagged in mentor review. Two findings cluster when `file` matches AND
 * their `[start_line, end_line]` ranges overlap or sit within ±2 lines; every
 * original finding is retained with its agent attribution, never deduped or
 * mutated. `server/INSIGHTS.md` (2026-08-22, two entries) documents a real
 * regression this pinning would have caught: a since-fixed single-pass
 * "merge into first fitting cluster" version stranded finding 10 in its own
 * cluster when items arrived in order `[14, 10, 12]` instead of sorted —
 * order shouldn't matter, because findings arrive from concurrently-
 * executing agents (T5) with no guaranteed line order.
 */

function findingRow(overrides: Partial<FindingRow>): FindingRow {
  return {
    id: 'f1',
    reviewId: 'r1',
    file: 'src/x.ts',
    startLine: 10,
    endLine: 10,
    severity: 'CRITICAL',
    category: 'security',
    title: 'finding',
    rationale: 'r',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
    ...overrides,
  } as FindingRow;
}

function item(
  findingOverrides: Partial<FindingRow>,
  agent: { agentId: string | null; agentName: string | null },
): ClusteredFinding {
  return { finding: findingRow(findingOverrides), agentId: agent.agentId, agentName: agent.agentName };
}

describe('clusterFindings', () => {
  it('clusters two findings on the same file whose ranges literally overlap', () => {
    const a = item({ id: 'a', file: 'src/x.ts', startLine: 10, endLine: 15 }, { agentId: 'ag1', agentName: 'Security' });
    const b = item({ id: 'b', file: 'src/x.ts', startLine: 12, endLine: 18 }, { agentId: 'ag2', agentName: 'Performance' });

    const clusters = clusterFindings([a, b]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.start_line).toBe(10);
    expect(clusters[0]!.end_line).toBe(18);
    expect(clusters[0]!.findings).toHaveLength(2);
  });

  it('clusters two findings exactly at the ±2-line boundary (AC-18)', () => {
    const a = item({ id: 'a', file: 'src/x.ts', startLine: 10, endLine: 10 }, { agentId: 'ag1', agentName: 'Security' });
    const b = item({ id: 'b', file: 'src/x.ts', startLine: 12, endLine: 12 }, { agentId: 'ag2', agentName: 'Performance' });

    expect(clusterFindings([a, b])).toHaveLength(1);
  });

  it('does NOT cluster findings more than 2 lines apart on the same file', () => {
    const a = item({ id: 'a', file: 'src/x.ts', startLine: 10, endLine: 10 }, { agentId: 'ag1', agentName: 'Security' });
    const b = item({ id: 'b', file: 'src/x.ts', startLine: 13, endLine: 13 }, { agentId: 'ag2', agentName: 'Performance' });

    expect(clusterFindings([a, b])).toHaveLength(2);
  });

  it('never clusters findings from different files, even with identical line ranges', () => {
    const a = item({ id: 'a', file: 'src/x.ts', startLine: 10, endLine: 10 }, { agentId: 'ag1', agentName: 'Security' });
    const b = item({ id: 'b', file: 'src/y.ts', startLine: 10, endLine: 10 }, { agentId: 'ag2', agentName: 'Performance' });

    expect(clusterFindings([a, b])).toHaveLength(2);
  });

  it('merges a proximity chain into ONE cluster regardless of input order (regression: [14,10,12] used to strand 10)', () => {
    const f10 = item({ id: 'f10', file: 'src/x.ts', startLine: 10, endLine: 10 }, { agentId: 'ag1', agentName: 'A' });
    const f12 = item({ id: 'f12', file: 'src/x.ts', startLine: 12, endLine: 12 }, { agentId: 'ag2', agentName: 'B' });
    const f14 = item({ id: 'f14', file: 'src/x.ts', startLine: 14, endLine: 14 }, { agentId: 'ag3', agentName: 'C' });

    const orders = [
      [f10, f12, f14],
      [f14, f10, f12],
      [f12, f14, f10],
    ];

    for (const order of orders) {
      const clusters = clusterFindings(order);
      expect(clusters).toHaveLength(1);
      expect(clusters[0]!.findings.map((f) => f.finding.id).sort()).toEqual(['f10', 'f12', 'f14']);
    }
  });

  it('retains every original finding with its own agent attribution — never dedupes or mutates (AC-19/AC-20)', () => {
    const a = item(
      { id: 'a', file: 'src/x.ts', startLine: 10, endLine: 10, category: 'security', severity: 'CRITICAL' },
      { agentId: 'ag1', agentName: 'Security' },
    );
    const b = item(
      { id: 'b', file: 'src/x.ts', startLine: 11, endLine: 11, category: 'performance', severity: 'SUGGESTION' },
      { agentId: 'ag2', agentName: 'Performance' },
    );

    const [cluster] = clusterFindings([a, b]);
    expect(cluster!.findings).toHaveLength(2);

    const byId = new Map(cluster!.findings.map((f) => [f.finding.id, f]));
    expect(byId.get('a')!.agentId).toBe('ag1');
    expect(byId.get('a')!.finding.category).toBe('security');
    expect(byId.get('b')!.agentId).toBe('ag2');
    expect(byId.get('b')!.finding.category).toBe('performance');
  });

  it('clusters purely on file+line proximity — differing severity/category never blocks or forces a merge', () => {
    const a = item(
      { id: 'a', file: 'src/x.ts', startLine: 10, endLine: 10, severity: 'CRITICAL', category: 'security' },
      { agentId: 'ag1', agentName: 'A' },
    );
    const b = item(
      { id: 'b', file: 'src/x.ts', startLine: 10, endLine: 10, severity: 'SUGGESTION', category: 'style' },
      { agentId: 'ag2', agentName: 'B' },
    );

    expect(clusterFindings([a, b])).toHaveLength(1);
  });

  it('a failed agent contributing zero findings never blocks clustering of the survivors', () => {
    // "Failed agent" corner case: run-executor never produces a
    // ClusteredFinding for an agent whose run failed (no findings exist to
    // cluster for it) — clusterFindings only ever sees whatever the caller
    // collected, so the 2 findings from agents that DID succeed still
    // cluster normally with nothing standing in for the missing third agent.
    const a = item({ id: 'a', file: 'src/x.ts', startLine: 10, endLine: 10 }, { agentId: 'ag1', agentName: 'Security' });
    const b = item({ id: 'b', file: 'src/x.ts', startLine: 11, endLine: 11 }, { agentId: 'ag2', agentName: 'Performance' });

    const clusters = clusterFindings([a, b]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.findings).toHaveLength(2);
  });

  it('a single finding produces its own singleton cluster', () => {
    const a = item({ id: 'a' }, { agentId: 'ag1', agentName: 'A' });

    const clusters = clusterFindings([a]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.findings).toHaveLength(1);
  });

  it('empty input produces no clusters', () => {
    expect(clusterFindings([])).toEqual([]);
  });

  it('supports a null agentId/agentName (unattributed finding)', () => {
    const a = item({ id: 'a' }, { agentId: null, agentName: null });

    const [cluster] = clusterFindings([a]);
    expect(cluster!.findings[0]!.agentId).toBeNull();
    expect(cluster!.findings[0]!.agentName).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test file**

Run: `cd server && pnpm exec vitest run test/findings-cluster.test.ts`
Expected: all 11 tests PASS (this is characterization coverage of already-
correct code — see the note above the test file's header comment; a failure
here means either the test itself has a typo, or `clusterFindings` regressed
since the 2026-08-22 fix documented in `server/INSIGHTS.md`, either of which
is worth stopping and investigating before continuing).

- [ ] **Step 3: Run the full server unit suite to confirm no collateral breakage**

Run: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
Expected: PASS, same count as before plus these 11 new tests.

- [ ] **Step 4: Commit**

```bash
git add server/test/findings-cluster.test.ts
git commit -m "test(reviews): unit coverage for clusterFindings fixed-point clustering

Corner cases from mentor feedback on the L07 homework: overlap vs ±2-line
proximity, no-overlap, different files, input-order independence (regression
guard for the [14,10,12]-stranding bug fixed 2026-08-22), never-dedupe
attribution, and a failed agent contributing zero findings.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Extract `deriveLiveColumns` out of `ColumnsView.tsx` and test it

**Files:**
- Create: `client/src/app/repos/[repoId]/pulls/[number]/_components/ColumnsView/helpers.ts`
- Create: `client/src/app/repos/[repoId]/pulls/[number]/_components/ColumnsView/helpers.test.ts`
- Modify: `client/src/app/repos/[repoId]/pulls/[number]/_components/ColumnsView/ColumnsView.tsx:30-56`
  (removes the inline `reviewByRunId` memo and per-run `outcomeOf`/`settled`/
  `review`/`findings` computation, replaces with one call to
  `deriveLiveColumns`)
- Read (no changes): `client/src/lib/run-outcome.ts` (`outcomeOf`, `Outcome`
  — already promoted out of `RunHistory` for exactly this kind of reuse)

**Interfaces:**
- Consumes: `outcomeOf(run: RunSummary): Outcome` from `@/lib/run-outcome`;
  `RunSummary`, `ReviewRecord`, `FindingRecord` from `@devdigest/shared`.
- Produces: `LiveColumn { run: RunSummary; outcome: Outcome; settled: boolean; review: ReviewRecord | undefined; findings: FindingRecord[] }`
  and `deriveLiveColumns(runs: RunSummary[], reviews: ReviewRecord[]): LiveColumn[]`
  — `ColumnsView.tsx` is the only consumer for now.

- [ ] **Step 1: Write the failing test**

```typescript
// client/src/app/repos/[repoId]/pulls/[number]/_components/ColumnsView/helpers.test.ts
/**
 * `deriveLiveColumns` — the running/done/failed-per-agent live-status
 * overlay `ColumnsView` renders as columns, extracted out of the component's
 * JSX (mentor feedback on the L07 homework: no independently testable
 * function existed for this). Pure data-in/data-out: no render needed.
 */
import { describe, it, expect } from "vitest";
import type { RunSummary, ReviewRecord, FindingRecord } from "@devdigest/shared";
import { deriveLiveColumns } from "./helpers";

function run(overrides: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    multi_agent_run_id: null,
    ...overrides,
  };
}

function finding(overrides: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "finding",
    file: "src/x.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function review(overrides: Partial<ReviewRecord>): ReviewRecord {
  return {
    id: "r1",
    pr_id: "pr1",
    agent_id: "a1",
    run_id: "run-1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: null,
    score: 38,
    model: "deepseek/deepseek-v4-flash",
    grounding: null,
    created_at: "2026-06-11T18:44:34.000Z",
    findings: [],
    ...overrides,
  };
}

describe("deriveLiveColumns", () => {
  it("maps running/done/failed statuses to distinct outcomes and settled flags, joining reviews by run_id regardless of array order", () => {
    const runs: RunSummary[] = [
      run({ run_id: "run-running", status: "running" }),
      run({ run_id: "run-clean", status: "done", findings_count: 0, blockers: 0, score: 95 }),
      run({ run_id: "run-rejected", status: "done", findings_count: 1, blockers: 1, score: 20 }),
      run({ run_id: "run-failed", status: "failed", error: "timeout after 60s" }),
    ];
    // Reviews given in an order that doesn't match `runs` — the join must be
    // by run_id, never by array position.
    const reviews: ReviewRecord[] = [
      review({ run_id: "run-rejected", findings: [finding({ id: "f-rejected" })] }),
      review({ run_id: "run-clean", findings: [] }),
    ];

    const columns = deriveLiveColumns(runs, reviews);

    expect(columns).toHaveLength(4);
    expect(columns.map((c) => c.run.run_id)).toEqual(["run-running", "run-clean", "run-rejected", "run-failed"]);

    const running = columns[0]!;
    expect(running.outcome.key).toBe("running");
    expect(running.settled).toBe(false);
    expect(running.findings).toEqual([]);

    const clean = columns[1]!;
    expect(clean.outcome.key).toBe("approved");
    expect(clean.settled).toBe(true);
    expect(clean.findings).toEqual([]);

    const rejected = columns[2]!;
    expect(rejected.outcome.key).toBe("rejected");
    expect(rejected.settled).toBe(true);
    expect(rejected.findings.map((f) => f.id)).toEqual(["f-rejected"]);

    const failed = columns[3]!;
    expect(failed.outcome.key).toBe("error");
    expect(failed.settled).toBe(false);
    expect(failed.findings).toEqual([]);
  });

  it("a run with no matching review yet safely defaults to an empty findings array", () => {
    const [column] = deriveLiveColumns([run({ run_id: "run-1", status: "done" })], []);
    expect(column!.review).toBeUndefined();
    expect(column!.findings).toEqual([]);
  });

  it("empty runs produces no columns", () => {
    expect(deriveLiveColumns([], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `cd client && pnpm exec vitest run src/app/repos/[repoId]/pulls/[number]/_components/ColumnsView/helpers.test.ts`
Expected: FAIL — `Cannot find module './helpers'` (the file doesn't exist yet).

- [ ] **Step 3: Write `helpers.ts`**

```typescript
// client/src/app/repos/[repoId]/pulls/[number]/_components/ColumnsView/helpers.ts
/* ColumnsView/helpers.ts — the running/done/failed-per-agent live-status
   overlay, pulled out of ColumnsView.tsx's render body so it's testable
   without mounting React (mentor feedback on the L07 homework: no
   independently testable function existed for this derivation). Reuses
   `outcomeOf` (`@/lib/run-outcome`, already promoted out of `RunHistory` for
   exactly this "same badge in two places" reuse) — this file adds no new
   status logic, only the per-run review/findings join that `ColumnsView`
   used to do inline. */
import { outcomeOf, type Outcome } from "@/lib/run-outcome";
import type { FindingRecord, ReviewRecord, RunSummary } from "@devdigest/shared";

export interface LiveColumn {
  run: RunSummary;
  outcome: Outcome;
  /** `true` only once the run has reached its terminal "done" status — a
   *  running or failed agent's column never shows a cost badge or findings,
   *  even if a stale `review` row happens to exist for its `run_id`. */
  settled: boolean;
  review: ReviewRecord | undefined;
  findings: FindingRecord[];
}

/** One `LiveColumn` per run, in the same order as `runs`. `reviews` is
 *  joined by `run_id` (a Map lookup, not array position) — reviews and runs
 *  can and do arrive in different orders from `usePrRuns`/`usePrReviews`. */
export function deriveLiveColumns(runs: RunSummary[], reviews: ReviewRecord[]): LiveColumn[] {
  const reviewByRunId = new Map(reviews.filter((r) => r.run_id).map((r) => [r.run_id as string, r]));

  return runs.map((run) => {
    const review = reviewByRunId.get(run.run_id);
    return {
      run,
      outcome: outcomeOf(run),
      settled: run.status === "done",
      review,
      findings: review?.findings ?? [],
    };
  });
}
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `cd client && pnpm exec vitest run src/app/repos/[repoId]/pulls/[number]/_components/ColumnsView/helpers.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Wire `ColumnsView.tsx` to use `deriveLiveColumns`**

In `ColumnsView.tsx`, replace the import block and the body of the component:

```typescript
// before (ColumnsView.tsx:14-44, abbreviated to the parts that change):
import { severityCounts } from "@/lib/findings";
import { outcomeOf } from "@/lib/run-outcome";
import { s } from "./styles";
import type { ReviewRecord, RunSummary } from "@devdigest/shared";

// ...

export function ColumnsView({ runs, reviews, onOpenTrace }: ColumnsViewProps) {
  const t = useTranslations("prReview");

  const reviewByRunId = React.useMemo(
    () => new Map(reviews.filter((r) => r.run_id).map((r) => [r.run_id as string, r])),
    [reviews],
  );

  return (
    <div style={s.grid}>
      {runs.map((run) => {
        const o = outcomeOf(run);
        const settled = run.status === "done";
        const review = reviewByRunId.get(run.run_id);
        const findings = review?.findings ?? [];

        return (
```

```typescript
// after:
import { severityCounts } from "@/lib/findings";
import { deriveLiveColumns } from "./helpers";
import { s } from "./styles";
import type { ReviewRecord, RunSummary } from "@devdigest/shared";

// ...

export function ColumnsView({ runs, reviews, onOpenTrace }: ColumnsViewProps) {
  const t = useTranslations("prReview");

  const columns = React.useMemo(() => deriveLiveColumns(runs, reviews), [runs, reviews]);

  return (
    <div style={s.grid}>
      {columns.map(({ run, outcome: o, settled, findings }) => {
        return (
```

The rest of the JSX (`run.status === "failed" && run.error`, `RunCostBadge`,
the severity-badges block, the `onOpenTrace(run.run_id)` button) is unchanged
— it already only reads `run`, `o`, `settled`, and `findings`, all of which
now come from the destructured `LiveColumn` instead of being computed inline.
Close the `.map()` callback the same way it already closes today (`return (
<div key={run.run_id} ...`, no key change needed).

- [ ] **Step 6: Run typecheck and the client unit suite**

Run: `cd client && pnpm typecheck && pnpm test`
Expected: PASS, no new errors. (No existing `ColumnsView.test.tsx` exists
yet, so this step is only confirming the refactor didn't break typecheck or
any other suite — e.g. anything importing `ColumnsView` indirectly via
`MultiAgentReviewTab`.)

- [ ] **Step 7: Commit**

```bash
git add client/src/app/repos/'[repoId]'/pulls/'[number]'/_components/ColumnsView/helpers.ts \
        client/src/app/repos/'[repoId]'/pulls/'[number]'/_components/ColumnsView/helpers.test.ts \
        client/src/app/repos/'[repoId]'/pulls/'[number]'/_components/ColumnsView/ColumnsView.tsx
git commit -m "refactor(reviews): extract deriveLiveColumns out of ColumnsView + test it

Mentor feedback on the L07 homework: the running/done/failed-per-agent live
status overlay had no independently testable function. Pulls the per-run
outcome/settled/review/findings computation out of ColumnsView.tsx's JSX
into a pure ColumnsView/helpers.ts, matching this repo's existing
_components/<Name>/helpers.ts + helpers.test.ts pattern. No behavior change.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** both feedback items have a task — `findings-cluster.ts`
coverage (Task 1) and a testable `deriveLiveColumns`-equivalent (Task 2,
literally named `deriveLiveColumns` per the feedback's own wording).

**Placeholder scan:** no TBD/"add appropriate"/uncoded steps — every test
and every production file above is complete, runnable code.

**Type consistency:** `ClusteredFinding`/`FindingCluster` (Task 1) and
`LiveColumn`/`deriveLiveColumns` (Task 2) are each defined once and used with
matching names/shapes in their own task's steps.
