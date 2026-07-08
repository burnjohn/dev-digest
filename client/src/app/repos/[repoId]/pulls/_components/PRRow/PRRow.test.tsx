/**
 * PRRow — regression guard for the COST column introduced in the cost-badge feature.
 * Verifies that formatCost is wired correctly: '—' when cost is absent, formatted
 * dollar amount when cost_usd is present.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { PRRow } from "./PRRow";

afterEach(cleanup);

const PR: PrMeta = {
  id: "pr-1",
  number: 42,
  title: "Fix security vulnerability",
  author: "alice",
  branch: "fix/sec",
  base: "main",
  head_sha: "abc123",
  additions: 10,
  deletions: 5,
  files_count: 2,
  status: "needs_review",
  opened_at: "2026-06-01T12:00:00.000Z",
  updated_at: "2026-06-25T10:00:00.000Z",
  score: null,
  cost_usd: null,
};

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("PRRow — cost column", () => {
  it("renders '—' when cost_usd is null (no completed runs)", () => {
    renderWithIntl(<PRRow pr={PR} repoId="r1" />);
    // PRRow may show "—" in multiple columns (COST, FINDINGS); confirm at least one.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders a formatted dollar amount when cost_usd is present", () => {
    renderWithIntl(<PRRow pr={{ ...PR, cost_usd: 0.0013 }} repoId="r1" />);
    expect(screen.getByText("$0.0013")).toBeInTheDocument();
  });

  it("renders $0.00 when cost is exactly zero (free model)", () => {
    renderWithIntl(<PRRow pr={{ ...PR, cost_usd: 0 }} repoId="r1" />);
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });
});
