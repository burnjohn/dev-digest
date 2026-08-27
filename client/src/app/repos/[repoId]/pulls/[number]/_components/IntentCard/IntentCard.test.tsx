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
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import type { PrCommit, PrIntentDetail } from "@devdigest/shared";
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

/** The staleness props are optional in the component, so they are optional
    here too — the pre-existing cases below pass neither and must keep passing. */
function renderCard(
  prId: string | null = "pr-1",
  stale?: { headSha?: string | null; prCommits?: PrCommit[] },
  children?: ReactNode,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <IntentCard prId={prId} headSha={stale?.headSha} prCommits={stale?.prCommits}>
        {children}
      </IntentCard>
    </NextIntlClientProvider>,
  );
}

const STALE_TEXT = "Computed before the latest commit — Recalculate to refresh it.";

function commit(sha: string, committed_at: string | null): PrCommit {
  return { sha, message: `msg ${sha}`, author: "octocat", committed_at };
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
  });
});

describe("IntentCard — cache hit issues no second create (REQ-8)", () => {
  it("renders the cached intent immediately without an automatic reclassification", () => {
    usePrIntentSpy.mockReturnValue({ data: INTENT, isLoading: false, isError: false, refetch });
    renderCard("pr-1");

    // Cache hit: content is already there on first paint (no loading branch
    // taken), and the card itself never calls the force-reclassify mutation.
    expect(screen.getByText(INTENT.intent)).toBeInTheDocument();
    expect(reclassifyMutate).not.toHaveBeenCalled();
  });

  it("carries no refresh control of its own (2026-08-26: one button, on the brief band)", () => {
    // The Overview tab has exactly ONE Recalculate, in PrBriefCard's header,
    // and it drives the intent then the brief. A Recompute button reappearing
    // here is the regression: it would let a reviewer refresh the intent
    // WITHOUT the brief, leaving a brief keyed to the previous classification.
    usePrIntentSpy.mockReturnValue({ data: INTENT, isLoading: false, isError: false, refetch });
    renderCard("pr-1");

    expect(screen.queryByRole("button", { name: /Recompute|Recalculate/ })).not.toBeInTheDocument();
    expect(reclassifyMutate).not.toHaveBeenCalled();
  });
});

describe("IntentCard — loading and error states", () => {
  it("shows a loading placeholder, not the card content, while the classification is in flight", () => {
    usePrIntentSpy.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch });
    renderCard("pr-1");

    expect(screen.getByText("Intent")).toBeInTheDocument();
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

describe("IntentCard — staleness against the head commit", () => {
  it("warns when the head commit landed after the intent was generated", () => {
    usePrIntentSpy.mockReturnValue({ data: INTENT, isLoading: false, isError: false, refetch });
    renderCard("pr-1", {
      headSha: "head",
      prCommits: [commit("head", "2026-08-20T11:00:00.000Z")],
    });

    // `status`, not `alert`: nothing is broken and no action is required —
    // the error branch owns `alert` and the two must stay distinguishable.
    expect(screen.getByRole("status")).toHaveTextContent(STALE_TEXT);
    // The strip is additive — the intent itself still renders behind it.
    expect(screen.getByText(INTENT.intent)).toBeInTheDocument();
  });

  it("stays silent when the intent is newer than the head commit", () => {
    usePrIntentSpy.mockReturnValue({ data: INTENT, isLoading: false, isError: false, refetch });
    renderCard("pr-1", {
      headSha: "head",
      prCommits: [commit("head", "2026-08-20T09:00:00.000Z")],
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(STALE_TEXT)).not.toBeInTheDocument();
  });

  it("stays silent when the caller supplies no head sha or commits at all", () => {
    // Mutation caught: making the props required, or defaulting a missing
    // sha to "stale" — every existing call site would start warning.
    usePrIntentSpy.mockReturnValue({ data: INTENT, isLoading: false, isError: false, refetch });
    renderCard("pr-1");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText(INTENT.intent)).toBeInTheDocument();
  });

  it("stays silent when the head commit is missing from the commit list", () => {
    // Fails closed: a truncated or cache-degraded commit list must not be
    // read as evidence that the intent is out of date.
    usePrIntentSpy.mockReturnValue({ data: INTENT, isLoading: false, isError: false, refetch });
    renderCard("pr-1", {
      headSha: "head",
      prCommits: [commit("another-sha", "2026-08-21T00:00:00.000Z")],
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the stale strip out of the error branch even with a slot filled", () => {
    // Regression guard for the 2026-08-26 restructure: the error branch became
    // a card box (so it can hold `children`), and the stale strip must not
    // have followed it in.
    usePrIntentSpy.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderCard(
      "pr-1",
      { headSha: "head", prCommits: [commit("head", "2026-08-21T00:00:00.000Z")] },
      <p>RISK SLOT</p>,
    );

    expect(screen.queryByText(STALE_TEXT)).not.toBeInTheDocument();
    expect(screen.getByText("RISK SLOT")).toBeInTheDocument();
  });

  it("never shows the stale strip in the error branch", () => {
    // The error card owns `alert`; a stale strip there would be nonsense
    // because there is no intent to be stale.
    usePrIntentSpy.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderCard("pr-1", {
      headSha: "head",
      prCommits: [commit("head", "2026-08-21T00:00:00.000Z")],
    });

    expect(screen.queryByText(STALE_TEXT)).not.toBeInTheDocument();
  });
});

describe("IntentCard — the children slot (2026-08-26; SPEC-02 N3 amended)", () => {
  it("renders the slot inside the card box in every branch, below the scope grid", () => {
    // The slot is where RISK AREAS lives now. It must survive all three
    // branches: a failed or in-flight INTENT fetch has nothing to do with the
    // brief, and hiding the risk areas with it would be the bug.
    const slot = <p>RISK SLOT</p>;

    usePrIntentSpy.mockReturnValue({ data: INTENT, isLoading: false, isError: false, refetch });
    const loaded = renderCard("pr-1", undefined, slot);
    const card = screen.getByRole("group", { name: "Intent" });
    expect(card).toHaveTextContent("RISK SLOT");
    // Order matters: the slot comes AFTER the out-of-scope list, never above
    // the intent quote.
    expect(
      card.textContent!.indexOf("Auth changes") < card.textContent!.indexOf("RISK SLOT"),
    ).toBe(true);
    loaded.unmount();

    usePrIntentSpy.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch });
    const loading = renderCard("pr-1", undefined, slot);
    expect(screen.getByText("RISK SLOT")).toBeInTheDocument();
    loading.unmount();

    usePrIntentSpy.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderCard("pr-1", undefined, slot);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("RISK SLOT")).toBeInTheDocument();
  });

  it("renders no divider when no slot is passed", () => {
    // Every pre-existing call site passes no children; a bare rule hanging
    // under the scope grid would be the visible regression.
    usePrIntentSpy.mockReturnValue({ data: INTENT, isLoading: false, isError: false, refetch });
    const { container } = renderCard("pr-1");
    const dividers = Array.from(container.querySelectorAll("div")).filter(
      (el) => el.style.borderTopStyle === "solid",
    );
    expect(dividers).toHaveLength(0);
  });
});
