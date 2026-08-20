import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(() => {
  cleanup();
  searchParams = new URLSearchParams();
});

const FINDINGS: FindingRecord[] = [
  {
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
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

const MANY: FindingRecord[] = [
  FINDINGS[0]!,
  { ...FINDINGS[0]!, id: "f2", title: "Second critical" },
  { ...FINDINGS[0]!, id: "f3", severity: "WARNING", title: "A warning" },
  { ...FINDINGS[0]!, id: "f4", severity: "SUGGESTION", title: "A suggestion" },
];

describe("FindingsPanel severity counters", () => {
  it("shows one counter per severity present, with its count", () => {
    renderWithIntl(<FindingsPanel findings={MANY} prId="pr1" />);
    const group = screen.getByRole("group", { name: "Findings by severity" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Critical2", "Warning1", "Suggestion1"]);
  });

  it("hides the counter row when there are no findings", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.queryByRole("group", { name: "Findings by severity" })).not.toBeInTheDocument();
  });

  it("clicking a severity shows only its findings; clicking again shows all", () => {
    renderWithIntl(<FindingsPanel findings={MANY} prId="pr1" />);
    const critical = screen.getByTitle("Show only CRITICAL findings");

    fireEvent.click(critical);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Second critical")).toBeInTheDocument();
    expect(screen.queryByText("A warning")).not.toBeInTheDocument();
    expect(screen.queryByText("A suggestion")).not.toBeInTheDocument();
    expect(critical).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTitle("Show all severities"));
    expect(screen.getByText("A warning")).toBeInTheDocument();
    expect(screen.getByText("A suggestion")).toBeInTheDocument();
  });

  it("keeps total counts while a filter is active", () => {
    renderWithIntl(<FindingsPanel findings={MANY} prId="pr1" />);
    fireEvent.click(screen.getByTitle("Show only WARNING findings"));
    const group = screen.getByRole("group", { name: "Findings by severity" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Critical2", "Warning1", "Suggestion1"]);
  });

  it("pre-applies the filter from the ?severity= URL param", () => {
    searchParams = new URLSearchParams("tab=findings&severity=WARNING");
    renderWithIntl(<FindingsPanel findings={MANY} prId="pr1" />);
    expect(screen.getByText("A warning")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    expect(screen.getByTitle("Show all severities")).toHaveAttribute("aria-pressed", "true");
  });

  it("ignores an unknown ?severity= value", () => {
    searchParams = new URLSearchParams("severity=BOGUS");
    renderWithIntl(<FindingsPanel findings={MANY} prId="pr1" />);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("A warning")).toBeInTheDocument();
  });
});
