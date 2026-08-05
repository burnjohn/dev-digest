import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@/lib/types";
import type { ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const usePrReviews = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: (...args: unknown[]) => usePrReviews(...args),
}));

import { PRRow } from "./PRRow";

afterEach(cleanup);

function pr(o: Partial<PrMeta>): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit-public",
    base: "main",
    head_sha: "abc123",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    opened_at: "2026-06-11T18:00:00.000Z",
    updated_at: "2026-06-11T18:44:34.000Z",
    score: 61,
    cost_usd: 0.014,
    latest_run_cost_usd: 0.014,
    latest_review_id: null,
    findings: null,
    ...o,
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PRRow — COST column", () => {
  it("collapses to a single value when the PR has just one run", () => {
    usePrReviews.mockReturnValue({ data: undefined, isLoading: false });
    renderWithIntl(<PRRow pr={pr({ cost_usd: 0.014, latest_run_cost_usd: 0.014 })} repoId="repo-1" />);
    expect(screen.getByText("$0.014")).toBeInTheDocument();
  });

  it("shows the latest run's cost with the total in parens when they differ", () => {
    usePrReviews.mockReturnValue({ data: undefined, isLoading: false });
    renderWithIntl(<PRRow pr={pr({ cost_usd: 0.041, latest_run_cost_usd: 0.014 })} repoId="repo-1" />);
    expect(screen.getByText("$0.014 ($0.041)")).toBeInTheDocument();
  });

  it("shows the em dash for a PR with no runs (no score, no cost)", () => {
    usePrReviews.mockReturnValue({ data: undefined, isLoading: false });
    renderWithIntl(
      <PRRow pr={pr({ cost_usd: null, latest_run_cost_usd: null, score: null })} repoId="repo-1" />,
    );
    // The score, findings, and cost cells all fall back to the em dash when unset.
    expect(screen.getAllByText("—")).toHaveLength(3);
  });
});

describe("PRRow — FINDINGS column", () => {
  it("shows an em dash when the PR has never been reviewed", () => {
    usePrReviews.mockReturnValue({ data: undefined, isLoading: false });
    renderWithIntl(<PRRow pr={pr({ findings: null, latest_review_id: null })} repoId="repo-1" />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows a green 'No findings' badge when the latest review found nothing", () => {
    usePrReviews.mockReturnValue({ data: undefined, isLoading: false });
    renderWithIntl(
      <PRRow
        pr={pr({ findings: { critical: 0, warning: 0, suggestion: 0 }, latest_review_id: "rev-1" })}
        repoId="repo-1"
      />,
    );
    expect(screen.getByText("No findings")).toBeInTheDocument();
  });

  it("shows severity badges and opens a popover listing the latest review's findings on click", () => {
    const review: ReviewRecord = {
      id: "rev-1",
      pr_id: "pr-1",
      agent_id: null,
      run_id: "run-1",
      agent_name: "Sec",
      kind: "review",
      verdict: "request_changes",
      summary: null,
      score: 40,
      model: "gpt-4.1",
      cost_usd: null,
      created_at: "2026-06-11T18:00:00.000Z",
      findings: [
        {
          id: "f-1",
          review_id: "rev-1",
          severity: "CRITICAL",
          category: "security",
          title: "Hardcoded secret",
          file: "src/config.ts",
          start_line: 11,
          end_line: 11,
          rationale: "A live key is committed in source.",
          suggestion: null,
          confidence: 0.9,
          kind: "finding",
          accepted_at: null,
          dismissed_at: null,
        },
      ],
    };
    usePrReviews.mockReturnValue({ data: [review], isLoading: false });
    renderWithIntl(
      <PRRow
        pr={pr({ findings: { critical: 1, warning: 0, suggestion: 0 }, latest_review_id: "rev-1" })}
        repoId="repo-1"
      />,
    );
    expect(screen.getByText("1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("1"));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });
});
