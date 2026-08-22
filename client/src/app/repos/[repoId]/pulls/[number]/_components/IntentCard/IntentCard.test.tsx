/**
 * IntentCard — get-or-create on mount (REQ-8/REQ-14), loading/error states.
 *
 * Per client INSIGHTS (2026-08-09) the mock point is the hook boundary, not
 * global fetch — `usePrIntent` / `useReclassifyIntent` are mocked, matching
 * the pattern in PRRow.test.tsx / ConventionsView.test.tsx.
 *
 * NOTE on scope: docs/plans/03-intent-layer.md §12 amendment A6 REVERSED
 * REQ-14's "sources with their statuses" — the Sources block (and its 11
 * message keys) was removed from IntentCard by owner decision; the shipped
 * component never renders `intent.sources`. There is therefore no case here
 * for "a source shows as used / truncated" — that UI does not exist. See the
 * report's Notes for the integrator.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentDetail } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const usePrIntentSpy = vi.fn();
const reclassifyMutate = vi.fn();
const refetch = vi.fn();

vi.mock("@/lib/hooks/reviews", () => ({
  usePrIntent: (prId: string | null) => usePrIntentSpy(prId),
  useReclassifyIntent: () => ({ mutate: reclassifyMutate, isPending: false }),
}));

import { IntentCard } from "./IntentCard";

afterEach(() => {
  cleanup();
  usePrIntentSpy.mockReset();
  reclassifyMutate.mockClear();
  refetch.mockClear();
});

const INTENT: PrIntentDetail = {
  intent: "Adds rate limiting to the public API.",
  in_scope: ["Rate limiter middleware", "Config for limits"],
  out_of_scope: ["Auth changes"],
  confidence: "high",
  sources: [
    { kind: "pr_body", ref: "pr_body", status: "used", chars: 400 },
    { kind: "plan_or_spec", ref: "docs/plans/rl.md", status: "truncated", chars: 6000 },
  ],
  pr_id: "pr-1",
  model: "deepseek/deepseek-v4-flash",
  generated_at: "2026-08-20T10:00:00.000Z",
};

function renderCard(prId: string | null = "pr-1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <IntentCard prId={prId} />
    </NextIntlClientProvider>,
  );
}

describe("IntentCard — get-or-create on mount (REQ-8, REQ-14)", () => {
  it("requests the PR's intent on mount with no user action, and renders what came back", () => {
    usePrIntentSpy.mockReturnValue({ data: INTENT, isLoading: false, isError: false, refetch });
    renderCard("pr-1");

    // Mounting alone is what triggers get-or-create server-side (usePrIntent's
    // own POST) — the card must call the hook for this PR without any click.
    expect(usePrIntentSpy).toHaveBeenCalledWith("pr-1");
    expect(screen.getByText(INTENT.intent)).toBeInTheDocument();
    expect(screen.getByText("Rate limiter middleware")).toBeInTheDocument();
    expect(screen.getByText("Auth changes")).toBeInTheDocument();
    expect(screen.getByText("high confidence")).toBeInTheDocument();
  });
});

describe("IntentCard — cache hit issues no second create (REQ-8)", () => {
  it("renders the cached intent immediately without an automatic reclassification", () => {
    usePrIntentSpy.mockReturnValue({ data: INTENT, isLoading: false, isError: false, refetch });
    renderCard("pr-1");

    // Cache hit: content is already there on first paint (no loading branch
    // taken), and the card itself never calls the force-reclassify mutation.
    expect(screen.getByText(INTENT.intent)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recompute" })).toBeInTheDocument();
    expect(reclassifyMutate).not.toHaveBeenCalled();
  });

  it("only reclassifies when the user explicitly clicks Recompute", () => {
    usePrIntentSpy.mockReturnValue({ data: INTENT, isLoading: false, isError: false, refetch });
    renderCard("pr-1");

    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));
    expect(reclassifyMutate).toHaveBeenCalledTimes(1);
  });
});

describe("IntentCard — loading and error states", () => {
  it("shows a loading placeholder, not the card content, while the classification is in flight", () => {
    usePrIntentSpy.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch });
    renderCard("pr-1");

    expect(screen.getByText("Intent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recompute" })).not.toBeInTheDocument();
    expect(screen.queryByText(INTENT.intent)).not.toBeInTheDocument();
  });

  it("shows an error state and retries through the hook's refetch on click", () => {
    usePrIntentSpy.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderCard("pr-1");

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t classify this PR’s intent.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
