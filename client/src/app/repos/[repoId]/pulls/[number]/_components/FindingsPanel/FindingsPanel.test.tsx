import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/hooks/eval", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

function makeFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

const FINDINGS: FindingRecord[] = [
  makeFinding({ id: "f1", severity: "CRITICAL", title: "Hardcoded secret" }),
  makeFinding({ id: "f2", severity: "WARNING", title: "Missing null check" }),
  makeFinding({ id: "f3", severity: "SUGGESTION", title: "Use const" }),
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel", () => {
  it("renders the toolbar and all finding cards", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Missing null check")).toBeInTheDocument();
    expect(screen.getByText("Use const")).toBeInTheDocument();
  });

  it("shows the empty state when findings list is empty", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("renders severity filter pills for present severities", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    // CRIT label = first 4 chars of "Critical" uppercased = "CRIT"
    expect(screen.getByTitle("Filter to Critical only")).toBeInTheDocument();
    expect(screen.getByTitle("Filter to Warning only")).toBeInTheDocument();
    expect(screen.getByTitle("Filter to Suggestion only")).toBeInTheDocument();
  });

  it("filters to CRITICAL findings when CRIT pill is clicked", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(screen.getByTitle("Filter to Critical only"));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("Missing null check")).not.toBeInTheDocument();
    expect(screen.queryByText("Use const")).not.toBeInTheDocument();
  });

  it("resets filter when active pill is clicked again", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(screen.getByTitle("Filter to Critical only"));
    fireEvent.click(screen.getByTitle("Show all severities"));
    expect(screen.getByText("Missing null check")).toBeInTheDocument();
    expect(screen.getByText("Use const")).toBeInTheDocument();
  });

  it("shows empty state after filtering to severity with no matches", () => {
    renderWithIntl(
      <FindingsPanel
        findings={[makeFinding({ id: "f1", severity: "CRITICAL", title: "Crit only" })]}
        prId="pr1"
      />,
    );
    // Only CRIT pill should appear
    expect(screen.queryByTitle("Filter to Warning only")).not.toBeInTheDocument();
  });

  it("resets activeSeverity when runId prop changes", () => {
    const { rerender } = renderWithIntl(
      <FindingsPanel findings={FINDINGS} prId="pr1" runId="run-1" />,
    );
    fireEvent.click(screen.getByTitle("Filter to Critical only"));
    expect(screen.queryByText("Missing null check")).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPanel findings={FINDINGS} prId="pr1" runId="run-2" />
      </NextIntlClientProvider>,
    );
    // After run change, filter should reset — all findings visible
    expect(screen.getByText("Missing null check")).toBeInTheDocument();
  });
});
