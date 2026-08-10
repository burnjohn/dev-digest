/**
 * PRRow — the COST cell shows the summed per-PR cost, formatted, and falls back
 * to the muted "—" (never "$0.00") when the PR has no cost data.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@/lib/types";
import messages from "../../../../../../../messages/en/prReview.json";
import { PRRow } from "./PRRow";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// PRRow now calls usePrReviews (a TanStack Query hook) to lazy-load the popup's
// findings. Per client INSIGHTS, mock the hook boundary — not global fetch — so
// a bare render doesn't throw "No QueryClient set".
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: [], isLoading: false }),
}));

afterEach(cleanup);

function pr(o: Partial<PrMeta>): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add rate limiting",
    author: "octocat",
    branch: "feat/rl",
    base: "main",
    head_sha: "abc123",
    additions: 40,
    deletions: 10,
    files_count: 3,
    status: "needs_review",
    opened_at: null,
    updated_at: "2026-06-11T18:44:34.000Z",
    score: 90,
    cost_usd: null,
    findings_by_severity: { critical: 0, warning: 0, suggestion: 0 },
    ...o,
  };
}

function renderRow(meta: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={meta} repoId="r1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — COST cell", () => {
  it("renders the formatted cost when cost_usd is present", () => {
    renderRow(pr({ cost_usd: 0.06 }));
    expect(screen.getByText("$0.06")).toBeInTheDocument();
  });

  it("renders a muted — when cost_usd is null (never $0.00)", () => {
    renderRow(pr({ cost_usd: null, score: null }));
    // Both the score and cost cells render "—" for this fixture.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("renders $0.00 only for a genuine zero-cost run", () => {
    renderRow(pr({ cost_usd: 0 }));
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });
});

describe("PRRow — FINDINGS cell", () => {
  it("renders a severity strip button for each non-zero severity", () => {
    renderRow(pr({ findings_by_severity: { critical: 2, warning: 1, suggestion: 0 } }));
    expect(screen.getByRole("button", { name: /critical/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /warning/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /suggestion/i })).not.toBeInTheDocument();
  });

  it("renders a muted — and no strip when all severities are zero", () => {
    renderRow(pr({ findings_by_severity: { critical: 0, warning: 0, suggestion: 0 } }));
    expect(screen.queryByRole("button", { name: /critical|warning|suggestion/i })).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("renders a muted — when findings_by_severity is absent (back-compat)", () => {
    renderRow(pr({ findings_by_severity: undefined }));
    expect(screen.queryByRole("button", { name: /critical|warning|suggestion/i })).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });
});
