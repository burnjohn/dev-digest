/* REQ-18/19/25/26 — the landing half of the Smart Diff deep link (§5.7).
   Exercises FindingsTab's two-step ?finding=<id> resolution end to end,
   through the REAL (unedited) ReviewRunAccordion + FindingsPanel + FindingCard
   chain — only the two mutation hooks they call are mocked. */
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsTab } from "./FindingsTab";

afterEach(cleanup);

// jsdom has no scrollIntoView. ReviewRunAccordion calls it (when
// `scrollOnTarget`) and so does FindingCard — record which ELEMENT each call
// landed on (`this`) so REQ-34's tests can tell the two apart, not just count
// calls.
let scrollTargets: Element[] = [];
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrollTargets.push(this);
  });
});
afterEach(() => {
  scrollTargets = [];
});

function mkFinding(o: Partial<FindingRecord> & Pick<FindingRecord, "id" | "review_id">): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "security",
    title: "Rate limiter forgets to release the lock",
    file: "src/middleware/ratelimit.ts",
    start_line: 28,
    end_line: 28,
    rationale: "A lock acquired on entry is never released on the early-return path.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function mkReview(
  o: Partial<ReviewRecord> & Pick<ReviewRecord, "id" | "run_id" | "created_at" | "findings">,
): ReviewRecord {
  return {
    pr_id: "pr1",
    agent_id: "a1",
    agent_name: "Agent A",
    kind: "review",
    verdict: "comment",
    summary: null,
    score: 80,
    model: null,
    grounding: null,
    ...o,
  };
}

function mkRunSummary(o: Partial<RunSummary> & Pick<RunSummary, "run_id">): RunSummary {
  return {
    agent_id: "a1",
    agent_name: "Agent A",
    provider: "openai",
    model: "gpt-5",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 100,
    findings_count: 1,
    grounding: null,
    ran_at: "2026-08-05T00:00:00.000Z",
    score: 80,
    blockers: 0,
    cost_usd: 0.01,
    ...o,
  };
}

function tabJsx(
  runs: ReviewRecord[],
  targetFindingId: string | null,
  onTargetResolved: (id: string | null) => void = vi.fn(),
  prRuns: RunSummary[] = [],
  runsLoaded: boolean = true,
) {
  return (
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsTab
        prId="pr1"
        liveRunIds={[]}
        reviewRunning={false}
        lethalTrifecta={[]}
        runs={runs}
        runsLoaded={runsLoaded}
        prRuns={prRuns}
        prCommits={[]}
        cancelMutation={{ mutate: vi.fn(), isPending: false } as any}
        onOpenTrace={() => {}}
        onDelete={() => {}}
        onRunDone={() => {}}
        targetFindingId={targetFindingId}
        onTargetResolved={onTargetResolved}
      />
    </NextIntlClientProvider>
  );
}

function renderTab(
  runs: ReviewRecord[],
  targetFindingId: string | null,
  onTargetResolved: (id: string | null) => void = vi.fn(),
  prRuns: RunSummary[] = [],
  runsLoaded: boolean = true,
) {
  return render(tabJsx(runs, targetFindingId, onTargetResolved, prRuns, runsLoaded));
}

describe("FindingsTab — targetFindingId resolution (REQ-18/19/25/26)", () => {
  it("opens a run that would otherwise stay collapsed, for a finding unique to it", () => {
    const NEW_REVIEW = mkReview({
      id: "review-new",
      run_id: "run-new",
      created_at: "2026-08-05T00:00:00.000Z",
      findings: [mkFinding({ id: "f-new-unique", review_id: "review-new", title: "New review's own finding" })],
    });
    const OLD_REVIEW = mkReview({
      id: "review-old",
      run_id: "run-old",
      created_at: "2026-08-01T00:00:00.000Z",
      findings: [mkFinding({ id: "f-old-unique", review_id: "review-old", title: "Old review's own finding" })],
    });
    const onResolved = vi.fn();
    // Reviews come newest-first — only NEW_REVIEW (index 0) is `defaultOpen`.
    renderTab([NEW_REVIEW, OLD_REVIEW], "f-old-unique", onResolved);

    expect(screen.getByText("Old review's own finding")).toBeInTheDocument();
    expect(onResolved).toHaveBeenCalledWith("f-old-unique");
  });

  it("REQ-25/REQ-26 — resolves a stale id to the NEWER finding sharing its key, never the one the URL named", () => {
    const SHARED = {
      severity: "CRITICAL" as const,
      category: "security" as const,
      title: "Hardcoded Stripe secret key",
      file: "src/config.ts",
      start_line: 12,
      end_line: 12,
    };
    const OLD_REVIEW = mkReview({
      id: "review-old",
      run_id: "run-old",
      created_at: "2026-08-01T00:00:00.000Z",
      findings: [mkFinding({ id: "f-old", review_id: "review-old", ...SHARED })],
    });
    const NEW_REVIEW = mkReview({
      id: "review-new",
      run_id: "run-new",
      created_at: "2026-08-05T00:00:00.000Z",
      findings: [mkFinding({ id: "f-new", review_id: "review-new", ...SHARED })],
    });
    const runs = [NEW_REVIEW, OLD_REVIEW];
    const onResolved = vi.fn();

    // The URL names the STALE (older) id — the exact mutation this test exists to catch.
    const { container } = renderTab(runs, "f-old", onResolved);

    const newerCard = container.querySelector('[data-finding-id="f-new"]');
    const olderCard = container.querySelector('[data-finding-id="f-old"]');
    expect(newerCard).toHaveAttribute("data-highlighted", "true");
    // The older review's accordion never opened — its card isn't even mounted.
    expect(olderCard).toBeNull();
    expect(onResolved).toHaveBeenCalledWith("f-new");
  });

  it("REQ-26 — reports the SAME id when it is already the newest match (no pointless rewrite)", () => {
    const SHARED = {
      severity: "CRITICAL" as const,
      category: "security" as const,
      title: "Hardcoded Stripe secret key",
      file: "src/config.ts",
      start_line: 12,
      end_line: 12,
    };
    const OLD_REVIEW = mkReview({
      id: "review-old",
      run_id: "run-old",
      created_at: "2026-08-01T00:00:00.000Z",
      findings: [mkFinding({ id: "f-old", review_id: "review-old", ...SHARED })],
    });
    const NEW_REVIEW = mkReview({
      id: "review-new",
      run_id: "run-new",
      created_at: "2026-08-05T00:00:00.000Z",
      findings: [mkFinding({ id: "f-new", review_id: "review-new", ...SHARED })],
    });
    const onResolved = vi.fn();
    renderTab([NEW_REVIEW, OLD_REVIEW], "f-new", onResolved);

    expect(onResolved).toHaveBeenCalledWith("f-new");
  });

  it("REQ-19 — degrades quietly when the id resolves by neither step", () => {
    const NEW_REVIEW = mkReview({
      id: "review-new",
      run_id: "run-new",
      created_at: "2026-08-05T00:00:00.000Z",
      findings: [mkFinding({ id: "f-new", review_id: "review-new", title: "The newest run's finding" })],
    });
    const onResolved = vi.fn();
    renderTab([NEW_REVIEW], "does-not-exist", onResolved);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onResolved).toHaveBeenCalledWith(null);
    // The newest run stays open/rendered — no scroll hunt, no empty state.
    expect(screen.getByText("The newest run's finding")).toBeInTheDocument();
  });

  it("REQ-19 — degrades quietly when there are no runs at all, once the reviews query has genuinely loaded", () => {
    // `runsLoaded: true` is the point of this rewrite (REQ-35 — this test
    // used to pass by accident, because the resolution effect ran before
    // `runsLoaded` existed and could not tell "loading" from "loaded and
    // truly empty" apart). Passed explicitly even though it's the default,
    // so the case under test is unambiguous.
    const onResolved = vi.fn();
    renderTab([], "anything", onResolved, [], true);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onResolved).toHaveBeenCalledWith(null);
  });

  it("REQ-35 — a not-yet-loaded (or retrying) reviews query must NOT degrade the target away; it resolves and highlights once the real runs land", () => {
    const onResolved = vi.fn();
    const { rerender, container } = renderTab([], "f-new", onResolved, [], false);

    // Cold cache: `runs` is `[]` only because the query hasn't landed yet —
    // this must NOT be read as "no findings".
    expect(onResolved).not.toHaveBeenCalled();
    expect(screen.queryByText("Landed after cold load")).not.toBeInTheDocument();

    const NEW_REVIEW = mkReview({
      id: "review-new",
      run_id: "run-new",
      created_at: "2026-08-05T00:00:00.000Z",
      findings: [mkFinding({ id: "f-new", review_id: "review-new", title: "Landed after cold load" })],
    });
    rerender(tabJsx([NEW_REVIEW], "f-new", onResolved, [], true));

    expect(onResolved).toHaveBeenCalledWith("f-new");
    expect(screen.getByText("Landed after cold load")).toBeInTheDocument();
    const card = container.querySelector('[data-finding-id="f-new"]');
    expect(card).toHaveAttribute("data-highlighted", "true");
  });

  it("REQ-25 — a finding whose only key-match is dismissed is unresolvable", () => {
    const review = mkReview({
      id: "review-x",
      run_id: "run-x",
      created_at: "2026-08-01T00:00:00.000Z",
      findings: [
        mkFinding({
          id: "f-dismissed",
          review_id: "review-x",
          title: "Only match is dismissed",
          dismissed_at: "2026-08-02T00:00:00.000Z",
        }),
      ],
    });
    const onResolved = vi.fn();
    renderTab([review], "f-dismissed", onResolved);

    expect(onResolved).toHaveBeenCalledWith(null);
  });
});

describe("FindingsTab — REQ-34: the deep-link target owns the scroll, not the accordion", () => {
  it("already-open accordion (target in the newest, defaultOpen run): exactly one scroll, on the card", () => {
    // The newest run (index 0) is `defaultOpen` — its FindingCards are
    // already mounted when the target arrives, so the card's (child) effect
    // and the accordion's (parent) effect would race in the SAME commit if
    // the accordion still scrolled. This is the exact shape of the owner's
    // reported bug.
    const NEW_REVIEW = mkReview({
      id: "review-new",
      run_id: "run-new",
      created_at: "2026-08-05T00:00:00.000Z",
      findings: [mkFinding({ id: "f-new", review_id: "review-new", title: "Newest run's finding" })],
    });
    renderTab([NEW_REVIEW], "f-new");

    expect(scrollTargets).toHaveLength(1);
    expect(scrollTargets[0]).toHaveAttribute("data-finding-id", "f-new");
    const accordionEl = document.getElementById("review-run-run-new");
    expect(accordionEl).not.toBeNull();
    expect(scrollTargets).not.toContain(accordionEl);
  });

  it("closed accordion (target in an older run): opens it, and still exactly one scroll, on the card", () => {
    const NEW_REVIEW = mkReview({
      id: "review-new",
      run_id: "run-new",
      created_at: "2026-08-05T00:00:00.000Z",
      findings: [mkFinding({ id: "f-new-unique", review_id: "review-new", title: "New review's own finding" })],
    });
    const OLD_REVIEW = mkReview({
      id: "review-old",
      run_id: "run-old",
      created_at: "2026-08-01T00:00:00.000Z",
      findings: [mkFinding({ id: "f-old-unique", review_id: "review-old", title: "Old review's own finding" })],
    });
    // OLD_REVIEW is index 1 — not `defaultOpen` — so its accordion starts closed.
    renderTab([NEW_REVIEW, OLD_REVIEW], "f-old-unique");

    expect(screen.getByText("Old review's own finding")).toBeInTheDocument();
    expect(scrollTargets).toHaveLength(1);
    expect(scrollTargets[0]).toHaveAttribute("data-finding-id", "f-old-unique");
    const accordionEl = document.getElementById("review-run-run-old");
    expect(accordionEl).not.toBeNull();
    expect(scrollTargets).not.toContain(accordionEl);
  });

  it("the Timeline 'go to review' jump still scrolls the accordion — scrollOnTarget defaults to true", () => {
    const REVIEW = mkReview({
      id: "review-a",
      run_id: "run-a",
      created_at: "2026-08-05T00:00:00.000Z",
      findings: [mkFinding({ id: "f-a", review_id: "review-a" })],
    });
    const RUN = mkRunSummary({ run_id: "run-a", agent_name: "Agent A" });
    // No `finding` target at all — this is the OTHER feature sharing the
    // targetRunId/targetNonce channel (§5.4), and it must be unaffected.
    renderTab([REVIEW], null, vi.fn(), [RUN]);

    expect(scrollTargets).toHaveLength(0);
    fireEvent.click(screen.getByTitle("Jump to this run’s findings below"));

    expect(scrollTargets).toHaveLength(1);
    const accordionEl = document.getElementById("review-run-run-a");
    expect(scrollTargets[0]).toBe(accordionEl);
  });
});
