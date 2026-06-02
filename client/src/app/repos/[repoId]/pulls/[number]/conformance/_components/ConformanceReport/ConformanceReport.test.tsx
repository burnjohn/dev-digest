import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../messages/en/conformance.json";

const REPORT = {
  id: "cf1",
  pr_id: "pr1",
  report: {
    spec_id: "specs/payments.prd.md",
    spec_title: "Payments",
    completeness_pct: 67,
    items: [
      { requirement: "Add Stripe SDK", status: "implemented", notes: null, evidence_file: "src/pay.ts" },
      { requirement: "Refund flow", status: "missing", notes: "not found", evidence_file: null },
    ],
  },
};

vi.mock("../../../../../../../../lib/hooks/conformance", () => ({
  useConformance: () => ({ data: REPORT, isLoading: false }),
  useRunConformance: () => ({ mutate: vi.fn(), isPending: false, isError: false, data: undefined }),
}));

import { ConformanceReport } from "./ConformanceReport";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conformance: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ConformanceReport (smoke)", () => {
  it("renders the PRD title + the three columns", () => {
    renderWithIntl(<ConformanceReport prId="pr1" prNumber={482} />);
    expect(screen.getByText("PRD: Payments")).toBeInTheDocument();
    expect(screen.getByText("Implemented")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getByText("Scope creep")).toBeInTheDocument();
    expect(screen.getByText("Add Stripe SDK")).toBeInTheDocument();
  });
});
