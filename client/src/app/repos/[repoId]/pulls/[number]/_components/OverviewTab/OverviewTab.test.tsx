/**
 * OverviewTab — that a broken card stays one broken card.
 *
 * This is the integration half of `components/error-boundary`'s unit tests.
 * The unit tests prove the boundary contains a throw; these prove the two
 * cards are actually WRAPPED, which is the part a future refactor can silently
 * undo without failing anything else.
 *
 * The failure being reproduced is not a network error — those already render
 * each card's own error branch. It is a resolved-but-malformed response:
 * `lib/api.ts` hands back `api.get<T>()` as a plain cast, so a payload missing
 * `totals`/`coverage` reaches BlastCard as an object that type-checked and does
 * not exist, and destructuring it throws mid-render. Unboxed that reaches
 * `app/error.tsx` and blanks the whole PR page.
 *
 * Mock point is the hook boundary, per client INSIGHTS (2026-08-09 seed).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import blast from "../../../../../../../../messages/en/blast.json";
import common from "../../../../../../../../messages/en/common.json";
import prReview from "../../../../../../../../messages/en/prReview.json";

const useBlastRadiusSpy = vi.fn();
const usePrIntentSpy = vi.fn();

vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: (prId: string | null) => useBlastRadiusSpy(prId),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  usePrIntent: (prId: string | null) => usePrIntentSpy(prId),
  useReclassifyIntent: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
}));

import { OverviewTab } from "./OverviewTab";

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast, common, prReview }}>
      <OverviewTab prId="pr-1" prBody="the description" repoFullName="owner/name" headSha="abc123" />
    </NextIntlClientProvider>,
  );
}

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

describe("OverviewTab — a malformed payload costs one card, not the page", () => {
  beforeEach(() => {
    // React logs the caught error itself, on top of ErrorBoundary's own log.
    vi.spyOn(console, "error").mockImplementation(() => {});
    usePrIntentSpy.mockReturnValue(healthyIntent);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    cleanup();
  });

  it("renders both cards normally when neither payload is broken", () => {
    useBlastRadiusSpy.mockReturnValue({
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
    });

    renderTab();

    expect(screen.getByText(blast.title)).toBeTruthy();
    expect(screen.queryByText(common.states.error)).toBeNull();
  });

  it("shows the fallback for the broken card while the sibling card survives", () => {
    useBlastRadiusSpy.mockReturnValue(malformedBlast);

    renderTab();

    // The boundary caught it: the error state is on screen instead of a blank
    // page, and BlastCard's own body is gone.
    expect(screen.getByText(common.states.error)).toBeTruthy();

    // …and everything around it still rendered. IntentCard's summary and the
    // PR description below the grid are the proof that the throw did not
    // unwind past the one card.
    expect(screen.getByText("Adds rate limiting to the public API.")).toBeTruthy();
    expect(screen.getByText("the description")).toBeTruthy();
  });

  it("offers a retry on the failed card", () => {
    useBlastRadiusSpy.mockReturnValue(malformedBlast);

    renderTab();

    expect(screen.getByRole("button", { name: common.actions.retry })).toBeTruthy();
  });
});
