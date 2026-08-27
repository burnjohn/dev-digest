/**
 * OverviewTab — that a broken card stays one broken card.
 *
 * This is the integration half of `components/error-boundary`'s unit tests.
 * The unit tests prove the boundary contains a throw; these prove all FIVE
 * sections (IntentCard, RiskAreas, PrBriefCard, BlastCard, ReviewFocusCard)
 * are actually WRAPPED in their own boundary — the part a future refactor can
 * silently undo without failing anything else.
 *
 * It is also where the LAYOUT contract is pinned (2026-08-26 rework): the PR
 * Brief band above the grid, RISK AREAS inside IntentCard's card, Review Focus
 * below. That is placement, which no card's own suite can see.
 *
 * The failure being reproduced is not a network error — those already render
 * each card's own error branch. It is a resolved-but-malformed response:
 * `lib/api.ts` hands back `api.post`/`api.get<T>()` as a plain cast, so a
 * payload missing the fields a card destructures reaches it as an object
 * that type-checked but does not exist, and destructuring it throws
 * mid-render. Unboxed that reaches `app/error.tsx` and blanks the whole PR
 * page.
 *
 * Mock point is the hook boundary, per client INSIGHTS (2026-08-09 seed).
 * `PrBriefCard`, `RiskAreas` and `ReviewFocusCard` all mount `usePrBrief` -
 * the shared `["pr-brief", prId]` query key (lib/hooks/brief.ts) — so a
 * malformed `usePrBrief` payload throws in all THREE, and that is exactly what
 * one of the tests below proves: three boundaries trip together while
 * IntentCard's own content (a different hook) still renders, even though one
 * of the three sits inside IntentCard's card.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RiskBriefResponse } from "@devdigest/shared";

import blast from "../../../../../../../../messages/en/blast.json";
import common from "../../../../../../../../messages/en/common.json";
import prReview from "../../../../../../../../messages/en/prReview.json";
import riskBrief from "../../../../../../../../messages/en/riskBrief.json";

const useBlastRadiusSpy = vi.fn();
const usePrReviewsSpy = vi.fn();
const usePrRunsSpy = vi.fn();
const usePrIntentSpy = vi.fn();
const usePrBriefSpy = vi.fn();
const useRecalculateBriefSpy = vi.fn();

vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: (prId: string | null) => useBlastRadiusSpy(prId),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  usePrIntent: (prId: string | null) => usePrIntentSpy(prId),
  useReclassifyIntent: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  // ReviewVerdictSummary, the band's top row, reads these two.
  usePrReviews: (prId: string | null) => usePrReviewsSpy(prId),
  usePrRuns: (prId: string | null) => usePrRunsSpy(prId),
}));

vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: (prId: string | null) => usePrBriefSpy(prId),
  useRecalculateBrief: (prId: string | null) => useRecalculateBriefSpy(prId),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
}));

import { OverviewTab } from "./OverviewTab";

function renderTab(prId: string | null = "pr-1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast, common, prReview, riskBrief }}>
      <OverviewTab prId={prId} prBody="the description" repoFullName="owner/name" headSha="abc123" />
    </NextIntlClientProvider>,
  );
}

const healthyBlast = {
  data: {
    totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
    coverage: {
      callers_available: true,
      endpoints_available: true,
      crons_available: true,
      prior_prs_available: true,
    },
    symbols: [],
    status: "ok",
    status_reason: null,
    prior_prs: [],
    narrative: null,
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

/** A resolved query whose `data` is missing every field BlastCard destructures
 *  — what a contract drift or a partial response actually looks like on the
 *  wire, since nothing validates the shape at runtime. */
const malformedBlast = {
  data: { unexpected: true },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

/** Mirrors `IntentCard.test.tsx`'s own `INTENT` fixture — the contract's
 *  summary field is `intent`, not `summary`. A near-miss here would make
 *  IntentCard render ITS error branch, and the test would then be asserting
 *  that a broken card sits next to another broken card. */
const healthyIntent = {
  data: {
    intent: "Adds rate limiting to the public API.",
    in_scope: ["Rate limiter middleware"],
    out_of_scope: ["Auth changes"],
    confidence: "high",
    sources: [],
    pr_id: "pr-1",
    model: "deepseek/deepseek-v4-flash",
    generated_at: "2026-08-20T10:00:00.000Z",
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

const BRIEF: RiskBriefResponse = {
  what: "Adds a risk brief endpoint.",
  why: "Reviewers currently have to read the whole diff to find the risky parts.",
  risk_level: "medium",
  risks: [
    {
      title: "Unpinned dependency",
      explanation: "ioredis is added with no pinned version.",
      severity: "high",
      file: "package.json",
      endpoint: null,
    },
  ],
  review_focus: [{ file: "server/src/modules/pulls/routes.ts", reason: "New endpoint added here." }],
  pr_id: "pr-1",
  sources: {
    intent: "used",
    blast: "used",
    pr_body: "used",
    linked_issue: "missing",
    file_list: "used",
    md_files: [],
  },
  model: "deepseek/deepseek-v4-flash",
  generated_at: "2026-08-26T10:00:00.000Z",
};

const healthyBrief = { data: BRIEF, isLoading: false, isError: false, refetch: vi.fn() };

/** One completed review + its run row, so the band's verdict half renders.
 *  Two CRITICALs and a persisted `blockers: 2` → a derived "Request changes". */
const REVIEW = {
  id: "rev-1",
  pr_id: "pr-1",
  agent_id: "agent-1",
  run_id: "run-1",
  agent_name: "Reviewer",
  kind: "review",
  verdict: "approve",
  summary: "A secret is committed in plaintext.",
  score: 61,
  model: "openai/gpt-4.1",
  created_at: "2026-08-26T10:00:00.000Z",
  findings: [
    { id: "f1", review_id: "rev-1", severity: "CRITICAL", title: "Secret", dismissed_at: null },
    { id: "f2", review_id: "rev-1", severity: "WARNING", title: "N+1", dismissed_at: null },
  ],
};

const RUN = {
  run_id: "run-1",
  agent_id: "agent-1",
  agent_name: "Reviewer",
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
};

/** Missing `findings`, which ReviewVerdictSummary maps over. */
const malformedReviews = { data: [{ id: "rev-x", run_id: "run-1" }] };

/** Missing every field PrBriefCard/ReviewFocusCard destructure — the same
 *  "resolved but wrong shape" failure as `malformedBlast`, on the shared
 *  `usePrBrief` hook. */
const malformedBrief = {
  data: { unexpected: true },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

describe("OverviewTab — a malformed payload costs its own card(s), not the page", () => {
  beforeEach(() => {
    // React logs the caught error itself, on top of ErrorBoundary's own log.
    vi.spyOn(console, "error").mockImplementation(() => {});
    usePrIntentSpy.mockReturnValue(healthyIntent);
    useBlastRadiusSpy.mockReturnValue(healthyBlast);
    usePrBriefSpy.mockReturnValue(healthyBrief);
    useRecalculateBriefSpy.mockReturnValue({ mutate: vi.fn(), isPending: false });
    usePrReviewsSpy.mockReturnValue({ data: [REVIEW] });
    usePrRunsSpy.mockReturnValue({ data: [RUN] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    cleanup();
  });

  it("renders all five sections normally when every payload is healthy", () => {
    renderTab();

    // The band's verdict row, derived from the run's blocker count — not from
    // REVIEW.verdict, which says "approve".
    expect(screen.getByText(prReview.verdict.requestChanges)).toBeTruthy();
    expect(screen.getByText("$0.014 · 8.2K→1.3K")).toBeTruthy();
    // The band shows the BRIEF's prose, never the reviewer's summary or name.
    expect(screen.getByText(BRIEF.what)).toBeTruthy();
    expect(screen.queryByText(REVIEW.summary)).toBeNull();
    expect(screen.queryByText("Reviewer")).toBeNull();
    expect(screen.getByText(blast.title)).toBeTruthy();
    expect(screen.getByText(riskBrief.title)).toBeTruthy();
    expect(screen.getByText(riskBrief.risks.title)).toBeTruthy();
    expect(screen.getByText(riskBrief.reviewFocus.title)).toBeTruthy();
    expect(screen.getByText("Adds rate limiting to the public API.")).toBeTruthy();
    expect(screen.queryByText(common.states.error)).toBeNull();
  });

  it("shows the fallback for the broken card while every sibling card still renders", () => {
    useBlastRadiusSpy.mockReturnValue(malformedBlast);

    renderTab();

    // The boundary caught it: the error state is on screen instead of a blank
    // page, and BlastCard's own body is gone. Exactly one card is broken.
    expect(screen.getAllByText(common.states.error)).toHaveLength(1);

    // …and everything around it still rendered: IntentCard, PrBriefCard,
    // ReviewFocusCard and the PR description below the grid all read
    // normally — proof the throw did not unwind past BlastCard's own slot.
    expect(screen.getByText("Adds rate limiting to the public API.")).toBeTruthy();
    expect(screen.getByText(riskBrief.title)).toBeTruthy();
    expect(screen.getByText(riskBrief.reviewFocus.title)).toBeTruthy();
    expect(screen.getByText("the description")).toBeTruthy();
  });

  it("trips all three sections sharing usePrBrief, leaving IntentCard's own content and BlastCard untouched", () => {
    usePrBriefSpy.mockReturnValue(malformedBrief);

    renderTab();

    // PrBriefCard, RiskAreas and ReviewFocusCard all destructure the same
    // malformed `usePrBrief` payload, so all three boundaries trip.
    expect(screen.getAllByText(common.states.error)).toHaveLength(3);

    // RiskAreas renders INSIDE IntentCard, and its own boundary is what keeps
    // the intent readable behind the failure — collapse the two boundaries
    // into one and this assertion is what fails.
    expect(screen.getByText(blast.title)).toBeTruthy();
    expect(screen.getByText("Adds rate limiting to the public API.")).toBeTruthy();
    expect(screen.getByText("Auth changes")).toBeTruthy();
    expect(screen.getByText("the description")).toBeTruthy();
  });

  it("places the brief band above the grid, the risk areas inside the Intent card, and Review Focus below", () => {
    const { container } = renderTab();

    // The two bands are top-level children of the tab, NOT grid cells — that
    // is what makes them full-width (SPEC-02 AC-26/AC-27, 2026-08-26 rework).
    const briefHeading = screen.getByText(riskBrief.title);
    const focusHeading = screen.getByText(riskBrief.reviewFocus.title);
    const intentHeading = screen.getByText(prReview.intent.title);

    const order = (el: Element) =>
      Array.prototype.indexOf.call(container.querySelectorAll("*"), el);
    expect(order(briefHeading)).toBeLessThan(order(intentHeading));
    expect(order(intentHeading)).toBeLessThan(order(focusHeading));

    // RISK AREAS is inside IntentCard's own card box, not a card of its own.
    const intentCard = screen.getByRole("group", { name: prReview.intent.title });
    expect(intentCard).toHaveTextContent(riskBrief.risks.title);
    expect(intentCard).toHaveTextContent("Unpinned dependency");
    // …and the brief's prose is NOT in there with it — that half is the band.
    expect(intentCard).not.toHaveTextContent(BRIEF.what);
  });

  it("drops only the verdict row when the REVIEWS payload is malformed", () => {
    // The band is one component now, so there is no separate boundary to catch
    // this — PrBriefCard's own shape guard is what keeps the brief prose
    // rendering. Remove that guard and the throw takes the whole band, and this
    // case fails with a fallback where the prose should be.
    usePrReviewsSpy.mockReturnValue(malformedReviews);

    renderTab();

    expect(screen.queryByText(common.states.error)).toBeNull();
    expect(screen.queryByText(prReview.verdict.requestChanges)).toBeNull();
    expect(screen.getByText(BRIEF.what)).toBeTruthy();
    expect(screen.getByText(riskBrief.risks.title)).toBeTruthy();
    expect(screen.getByText(riskBrief.reviewFocus.title)).toBeTruthy();
    expect(screen.getByText("Adds rate limiting to the public API.")).toBeTruthy();
  });

  it("shows no verdict row at all on a PR that has never been reviewed", () => {
    usePrReviewsSpy.mockReturnValue({ data: [] });

    renderTab();

    expect(screen.queryByText(prReview.verdict.requestChanges)).toBeNull();
    expect(screen.queryByText(prReview.verdict.prScore)).toBeNull();
    expect(screen.queryByText(common.states.error)).toBeNull();
    // …and the brief half of the band is untouched.
    expect(screen.getByText(riskBrief.title)).toBeTruthy();
    expect(screen.getByText(BRIEF.what)).toBeTruthy();
  });

  it("offers a retry on the failed card", () => {
    useBlastRadiusSpy.mockReturnValue(malformedBlast);

    renderTab();

    expect(screen.getByRole("button", { name: common.actions.retry })).toBeTruthy();
  });

  it("clears the fallback once prId changes, per the shared cardFallback's resetKeys", () => {
    useBlastRadiusSpy.mockImplementation((prId: string | null) =>
      prId === "pr-1" ? malformedBlast : healthyBlast,
    );

    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={{ blast, common, prReview, riskBrief }}>
        <OverviewTab prId="pr-1" prBody="the description" repoFullName="owner/name" headSha="abc123" />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText(common.states.error)).toBeTruthy();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ blast, common, prReview, riskBrief }}>
        <OverviewTab prId="pr-2" prBody="the description" repoFullName="owner/name" headSha="abc123" />
      </NextIntlClientProvider>,
    );

    expect(screen.queryByText(common.states.error)).toBeNull();
    expect(screen.getByText(blast.title)).toBeTruthy();
  });
});
