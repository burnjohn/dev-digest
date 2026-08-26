/**
 * PrBriefCard — SPEC-02 (`server/specs/SPEC-02-pr-risk-brief.md`), plan T7.
 *
 * The band is ONE component (2026-08-26): the verdict headline and findings
 * badge from the latest review run, the brief's own `what`/`why` as the body,
 * the score ring, the cost strip and the single Recalculate control. The
 * `risks[]` list is NOT here — it renders inside IntentCard and is covered by
 * `RiskAreas.test.tsx`.
 *
 * Per client INSIGHTS (2026-08-09 seed) the mock point is the hook boundary,
 * not global fetch — `usePrBrief` / `useRecalculateBrief` and the two review
 * queries are mocked, matching IntentCard.test.tsx / BlastCard.test.tsx.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RiskBriefResponse } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/riskBrief.json";
import prReview from "../../../../../../../../messages/en/prReview.json";

const usePrBriefSpy = vi.fn();
const useRecalculateBriefSpy = vi.fn();
const useReclassifyIntentSpy = vi.fn();
const usePrReviewsSpy = vi.fn();
const usePrRunsSpy = vi.fn();
const recalculateMutate = vi.fn();
const reclassifyMutateAsync = vi.fn();
const refetch = vi.fn();

vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: (prId: string | null) => usePrBriefSpy(prId),
  useRecalculateBrief: (prId: string | null) => useRecalculateBriefSpy(prId),
}));

// Since 2026-08-26 the band is one component: it owns the verdict row too, so
// it reads the review queries and the intent mutation as well as the brief.
vi.mock("@/lib/hooks/reviews", () => ({
  useReclassifyIntent: (prId: string | null) => useReclassifyIntentSpy(prId),
  usePrReviews: (prId: string | null) => usePrReviewsSpy(prId),
  usePrRuns: (prId: string | null) => usePrRunsSpy(prId),
}));

import { PrBriefCard } from "./PrBriefCard";

beforeEach(() => {
  useRecalculateBriefSpy.mockReturnValue({ mutate: recalculateMutate, isPending: false });
  reclassifyMutateAsync.mockResolvedValue(undefined);
  useReclassifyIntentSpy.mockReturnValue({
    mutateAsync: reclassifyMutateAsync,
    isPending: false,
  });
  // Default: a PR that has never been reviewed. Cases that want the verdict
  // row opt in through `withReview`.
  usePrReviewsSpy.mockReturnValue({ data: [] });
  usePrRunsSpy.mockReturnValue({ data: [] });
});

afterEach(() => {
  cleanup();
  usePrBriefSpy.mockReset();
  useRecalculateBriefSpy.mockReset();
  useReclassifyIntentSpy.mockReset();
  usePrReviewsSpy.mockReset();
  usePrRunsSpy.mockReset();
  recalculateMutate.mockClear();
  reclassifyMutateAsync.mockClear();
  refetch.mockClear();
});

function renderCard(prId: string | null = "pr-1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ riskBrief: messages, prReview }}>
      <PrBriefCard prId={prId} />
    </NextIntlClientProvider>,
  );
}

const BASE_SOURCES: RiskBriefResponse["sources"] = {
  intent: "used",
  blast: "used",
  pr_body: "used",
  linked_issue: "missing",
  file_list: "used",
  md_files: [],
};

const BRIEF: RiskBriefResponse = {
  pr_id: "pr-1",
  what: "Adds rate limiting to the public API.",
  why: "Prevents abuse of the /items endpoint under sustained load.",
  risk_level: "high",
  risks: [
    {
      title: "Unpinned dependency",
      explanation: "ioredis is added with no pinned version.",
      severity: "high",
      file: "package.json",
      endpoint: null,
    },
  ],
  review_focus: [],
  sources: BASE_SOURCES,
  model: "openai/gpt-4.1",
  generated_at: "2026-08-26T10:00:00.000Z",
};

const REVIEW_SUMMARY = "Two blockers before merge: a plaintext secret and an N+1 query.";

function review(o: Record<string, unknown> = {}) {
  return {
    id: "rev-1",
    pr_id: "pr-1",
    agent_id: "agent-1",
    run_id: "run-1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "approve",
    summary: REVIEW_SUMMARY,
    score: 61,
    model: "openai/gpt-4.1",
    created_at: "2026-08-26T10:00:00.000Z",
    findings: [
      { id: "f1", review_id: "rev-1", severity: "CRITICAL", dismissed_at: null },
      { id: "f2", review_id: "rev-1", severity: "WARNING", dismissed_at: null },
    ],
    ...o,
  };
}

function run(o: Record<string, unknown> = {}) {
  return {
    run_id: "run-1",
    agent_id: "agent-1",
    agent_name: "Security Reviewer",
    provider: null,
    model: null,
    status: "done",
    error: null,
    duration_ms: null,
    tokens_in: 8200,
    tokens_out: 1300,
    findings_count: 2,
    grounding: null,
    ran_at: "2026-08-26T10:00:00.000Z",
    score: 61,
    blockers: 2,
    cost_usd: 0.014,
    ...o,
  };
}

/** Loads the band with a completed review behind it. */
function withReview(reviewOverrides = {}, runOverrides = {}) {
  usePrBriefSpy.mockReturnValue({ data: BRIEF, isLoading: false, isError: false, refetch });
  usePrReviewsSpy.mockReturnValue({ data: [review(reviewOverrides)] });
  usePrRunsSpy.mockReturnValue({ data: [run(runOverrides)] });
}

/** The same, for a PR several agents have reviewed. */
function withReviews(rows: { review: Record<string, unknown>; run: Record<string, unknown> }[]) {
  usePrBriefSpy.mockReturnValue({ data: BRIEF, isLoading: false, isError: false, refetch });
  usePrReviewsSpy.mockReturnValue({ data: rows.map((r) => review(r.review)) });
  usePrRunsSpy.mockReturnValue({ data: rows.map((r) => run(r.run)) });
}

/** `n` non-dismissed findings, the first `blockers` of them CRITICAL. */
function findings(id: string, n: number, blockers = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${id}-f${i}`,
    review_id: id,
    severity: i < blockers ? "CRITICAL" : "WARNING",
    dismissed_at: null,
  }));
}

/* The reported bug's exact shape: three agents, and the APPROVING one is the
   newest. Reading `reviews[0]` headlines Approve / 0 findings / 100 here. */
const THREE_AGENTS = [
  {
    review: { id: "rev-sec", agent_id: "sec", run_id: "run-sec", findings: [],
      created_at: "2026-08-26T17:01:43.000Z", score: 100 },
    run: { run_id: "run-sec", agent_id: "sec", score: 100, blockers: 0,
      cost_usd: 0.0004, tokens_in: 5825, tokens_out: 287 },
  },
  {
    review: { id: "rev-gen", agent_id: "gen", run_id: "run-gen", findings: findings("rev-gen", 2),
      created_at: "2026-08-26T16:46:52.000Z", score: 85 },
    run: { run_id: "run-gen", agent_id: "gen", score: 85, blockers: 0,
      cost_usd: 0.0015, tokens_in: 12000, tokens_out: 492 },
  },
  {
    review: { id: "rev-api", agent_id: "api", run_id: "run-api", findings: findings("rev-api", 6, 4),
      created_at: "2026-08-26T16:40:10.000Z", score: 0 },
    run: { run_id: "run-api", agent_id: "api", score: 0, blockers: 4,
      cost_usd: 0.0247, tokens_in: 121000, tokens_out: 1053 },
  },
];

describe("PrBriefCard — loading and error states", () => {
  it("shows a loading placeholder ending in an ellipsis, then an error state with a working retry", () => {
    usePrBriefSpy.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch });
    const { unmount } = renderCard();
    expect(screen.getByText("PR Brief")).toBeInTheDocument();
    expect(screen.getByText(/…$/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();

    usePrBriefSpy.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderCard();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("PrBriefCard — a PR with no review yet (REQ-14, REQ-26)", () => {
  it("renders what/why alone: no verdict, no ring, no cost strip, and no risk badge", () => {
    usePrBriefSpy.mockReturnValue({ data: BRIEF, isLoading: false, isError: false, refetch });
    renderCard();

    expect(screen.getByText(BRIEF.what)).toBeInTheDocument();
    expect(screen.getByText(BRIEF.why)).toBeInTheDocument();

    // The risk-level badge was removed by owner decision on 2026-08-26. The
    // brief still carries `risk_level: "high"` on the wire — this asserts the
    // band does not render it.
    expect(screen.queryByText("High")).not.toBeInTheDocument();
    expect(screen.queryByText(prReview.verdict.requestChanges)).not.toBeInTheDocument();
    expect(screen.queryByText(prReview.verdict.approve)).not.toBeInTheDocument();
    expect(screen.queryByText(prReview.verdict.prScore)).not.toBeInTheDocument();

    // REQ-13: no line number or `#L` fragment anywhere on the page.
    expect(document.body.textContent).not.toMatch(/#L\d/);
    // REQ-9: no dropped-item count anywhere.
    expect(document.body.textContent).not.toMatch(/dropped/i);
    // No cost or token figure without a run to attribute it to — never `$—`.
    expect(document.body.textContent).not.toMatch(/\$[\d.]+/);
    expect(document.body.textContent).not.toMatch(/→/);
    // The risk list belongs to IntentCard now, not this band.
    expect(screen.queryByText("Unpinned dependency")).not.toBeInTheDocument();
  });
});

describe("PrBriefCard — the verdict row (AC-47)", () => {
  it("derives the headline from blockers and shows the counts, ring and cost strip", () => {
    withReview();
    renderCard();

    // `blockers: 2` on the run → Request changes, even though the review
    // record's own `verdict` says "approve".
    expect(screen.getByText(prReview.verdict.requestChanges)).toBeInTheDocument();
    expect(screen.queryByText(prReview.verdict.approve)).not.toBeInTheDocument();
    expect(screen.getByText(/2 findings/)).toBeInTheDocument();
    expect(screen.getByText(/2 blockers/)).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
    expect(screen.getByText(prReview.verdict.prScore)).toBeInTheDocument();
    expect(screen.getByText("$0.014 · 8.2K→1.3K")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Derived from the blocker count/ })).toBeInTheDocument();
  });

  it("never shows the reviewer's name or the reviewer's findings text", () => {
    // Both are the run accordion's job on the Findings tab. The band is the
    // PR's headline, and its prose is always the BRIEF's.
    withReview();
    renderCard();

    expect(screen.queryByText("Security Reviewer")).not.toBeInTheDocument();
    expect(screen.queryByText(REVIEW_SUMMARY)).not.toBeInTheDocument();
    expect(screen.getByText(BRIEF.what)).toBeInTheDocument();
  });

  it("headlines Approve on a clean run and Comment when findings do not block", () => {
    withReview({ findings: [] }, { blockers: 0 });
    const clean = renderCard();
    expect(screen.getByText(prReview.verdict.approve)).toBeInTheDocument();
    clean.unmount();

    withReview(
      { findings: [{ id: "f1", review_id: "rev-1", severity: "WARNING", dismissed_at: null }] },
      { blockers: 0 },
    );
    renderCard();
    expect(screen.getByText(prReview.verdict.comment)).toBeInTheDocument();
  });

  it("renders no cost strip when the run carries no cost and no tokens", () => {
    withReview({}, { cost_usd: null, tokens_in: null, tokens_out: null });
    renderCard();

    expect(document.body.textContent).not.toMatch(/\$/);
    expect(document.body.textContent).not.toMatch(/→/);
    // …while the rest of the row still renders.
    expect(screen.getByText("61")).toBeInTheDocument();
  });

  it("degrades to the never-reviewed rendering on a malformed reviews payload", () => {
    // `api.get` is a cast with no runtime parse, so a drifted payload arrives
    // resolved. Without the shape guard this throws and takes the BRIEF down
    // with it — that is the regression this case exists to catch.
    usePrBriefSpy.mockReturnValue({ data: BRIEF, isLoading: false, isError: false, refetch });
    usePrReviewsSpy.mockReturnValue({ data: [{ id: "rev-x", run_id: "run-1" }] });
    usePrRunsSpy.mockReturnValue({ data: [run()] });
    renderCard();

    expect(screen.getByText(BRIEF.what)).toBeInTheDocument();
    expect(screen.queryByText(prReview.verdict.requestChanges)).not.toBeInTheDocument();
    expect(screen.queryByText(prReview.verdict.prScore)).not.toBeInTheDocument();
  });
});

describe("PrBriefCard — Recalculate (REQ-29)", () => {
  it("re-runs the intent AND the brief, intent first, once per activation", async () => {
    usePrBriefSpy.mockReturnValue({ data: BRIEF, isLoading: false, isError: false, refetch });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Recalculate/ }));

    // Order is the point, not just the count: the brief is built FROM the
    // intent, so firing them concurrently (or brief-first) bakes the previous
    // classification into the new brief.
    await waitFor(() => expect(recalculateMutate).toHaveBeenCalledTimes(1));
    expect(reclassifyMutateAsync).toHaveBeenCalledTimes(1);
    expect(reclassifyMutateAsync.mock.invocationCallOrder[0]!).toBeLessThan(
      recalculateMutate.mock.invocationCallOrder[0]!,
    );
  });

  it("still recalculates the brief when the reclassification fails", async () => {
    // The brief degrades to `sources.intent: "unavailable"` and says so
    // (AC-32) — refusing to refresh at all would be the worse outcome.
    reclassifyMutateAsync.mockRejectedValue(new Error("502"));
    usePrBriefSpy.mockReturnValue({ data: BRIEF, isLoading: false, isError: false, refetch });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Recalculate/ }));

    await waitFor(() => expect(recalculateMutate).toHaveBeenCalledTimes(1));
  });

  it("is icon-only but still named, and disabled while EITHER mutation is pending", () => {
    usePrBriefSpy.mockReturnValue({ data: BRIEF, isLoading: false, isError: false, refetch });

    useRecalculateBriefSpy.mockReturnValue({ mutate: recalculateMutate, isPending: true });
    const { unmount } = renderCard();
    // Icon-only: the accessible name comes from `aria-label`, not from text.
    const btn = screen.getByRole("button", { name: /Recalculate/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("");
    unmount();

    useRecalculateBriefSpy.mockReturnValue({ mutate: recalculateMutate, isPending: false });
    useReclassifyIntentSpy.mockReturnValue({
      mutateAsync: reclassifyMutateAsync,
      isPending: true,
    });
    renderCard();
    expect(screen.getByRole("button", { name: /Recalculate/ })).toBeDisabled();
  });
});

describe("PrBriefCard — 'Built without …' note (REQ-32, REQ-40, REQ-43)", () => {
  it("names an unavailable scalar source and renders nothing for a merely partial one", () => {
    usePrBriefSpy.mockReturnValue({
      data: { ...BRIEF, sources: { ...BASE_SOURCES, blast: "unavailable" } },
      isLoading: false,
      isError: false,
      refetch,
    });
    const { unmount } = renderCard();
    expect(screen.getByRole("status")).toHaveTextContent("Built without blast radius");
    unmount();

    usePrBriefSpy.mockReturnValue({
      data: { ...BRIEF, sources: { ...BASE_SOURCES, blast: "partial" } },
      isLoading: false,
      isError: false,
      refetch,
    });
    renderCard();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("names documentation exactly once whether one or three .md entries are unavailable, and enumerates no path", () => {
    usePrBriefSpy.mockReturnValue({
      data: {
        ...BRIEF,
        sources: { ...BASE_SOURCES, md_files: [{ path: "README.md", status: "unavailable" }] },
      },
      isLoading: false,
      isError: false,
      refetch,
    });
    const { unmount } = renderCard();
    // `getByRole` (not `getAllByRole`) already fails on more than one match —
    // exactly one note is REQ-40's whole point.
    const note = screen.getByRole("status");
    expect(note).toHaveTextContent("Built without documentation");
    expect(note).not.toHaveTextContent("README.md");
    unmount();

    usePrBriefSpy.mockReturnValue({
      data: {
        ...BRIEF,
        sources: {
          ...BASE_SOURCES,
          md_files: [
            { path: "README.md", status: "unavailable" },
            { path: "docs/a.md", status: "unavailable" },
            { path: "docs/b.md", status: "unavailable" },
          ],
        },
      },
      isLoading: false,
      isError: false,
      refetch,
    });
    renderCard();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    unmount();
  });

  it("renders no note when every .md entry is used/truncated/skipped", () => {
    usePrBriefSpy.mockReturnValue({
      data: {
        ...BRIEF,
        sources: {
          ...BASE_SOURCES,
          md_files: [
            { path: "README.md", status: "used" },
            { path: "docs/a.md", status: "truncated" },
            { path: "docs/b.md", status: "skipped" },
          ],
        },
      },
      isLoading: false,
      isError: false,
      refetch,
    });
    renderCard();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("composes exactly one note naming both an unavailable scalar source and documentation", () => {
    usePrBriefSpy.mockReturnValue({
      data: {
        ...BRIEF,
        sources: {
          ...BASE_SOURCES,
          blast: "unavailable",
          md_files: [{ path: "README.md", status: "unavailable" }],
        },
      },
      isLoading: false,
      isError: false,
      refetch,
    });
    renderCard();
    // `getByRole` already fails on more than one match — exactly one note
    // naming both sources is REQ-43's whole point.
    const note = screen.getByRole("status");
    expect(within(note).getByText(/blast radius/)).toBeInTheDocument();
    expect(within(note).getByText(/documentation/)).toBeInTheDocument();
  });
});

describe("PrBriefCard — the verdict row is the PR's, not the newest agent's", () => {
  it("aggregates every agent instead of headlining whichever finished last", () => {
    /* The regression this exists to catch, verbatim from the field: Security
       Reviewer (approve / 0 / 100) completed AFTER an API Contract Reviewer run
       that rejected the PR with 4 blockers, and the band read
       "Approve · 0 findings · 100" while the Agent runs tab beside it read
       8 findings · 4 blockers. */
    withReviews(THREE_AGENTS);
    renderCard();

    expect(screen.getByText(prReview.verdict.requestChanges)).toBeInTheDocument();
    expect(screen.queryByText(prReview.verdict.approve)).not.toBeInTheDocument();
    expect(screen.getByText(/8 findings/)).toBeInTheDocument();
    expect(screen.getByText(/4 blockers/)).toBeInTheDocument();
    // Mean of 100 / 85 / 0, rounded — not the newest run's 100.
    expect(screen.getByText("62")).toBeInTheDocument();
    expect(screen.queryByText("100")).not.toBeInTheDocument();
    // Summed across all three runs, not the newest run's $0.0004 · 5.8K→287.
    expect(screen.getByText("$0.0266 · 138.8K→1.8K")).toBeInTheDocument();
  });

  it("counts a re-run agent once, at its newest numbers", () => {
    withReviews([
      ...THREE_AGENTS,
      {
        review: { id: "rev-api-2", agent_id: "api", run_id: "run-api-2",
          findings: findings("rev-api-2", 1), created_at: "2026-08-26T18:30:00.000Z", score: 90 },
        run: { run_id: "run-api-2", agent_id: "api", score: 90, blockers: 0,
          cost_usd: null, tokens_in: null, tokens_out: null },
      },
    ]);
    renderCard();

    // The API agent's 6 findings / 4 blockers are REPLACED, not added to: 0 + 2 + 1.
    expect(screen.getByText(/3 findings/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/blockers/);
    expect(screen.getByText(prReview.verdict.comment)).toBeInTheDocument();
  });
});
