import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

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

/** Build a finding off the CRITICAL fixture, overriding only what a test cares about. */
function mk(o: Partial<FindingRecord>): FindingRecord {
  return { ...FINDINGS[0]!, ...o };
}

// Mixed-severity set. `w2` sits below the 0.65 confidence threshold, so it is
// dropped once "Hide low confidence" is on.
const MIXED: FindingRecord[] = [
  mk({ id: "c1", severity: "CRITICAL", title: "Hardcoded secret", confidence: 0.95 }),
  mk({ id: "w1", severity: "WARNING", title: "Unused variable", confidence: 0.9 }),
  mk({ id: "w2", severity: "WARNING", title: "Shadowed name", confidence: 0.5 }),
  mk({ id: "s1", severity: "SUGGESTION", title: "Rename for clarity", confidence: 0.8 }),
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

describe("FindingsPanel severity chips", () => {
  it("renders one chip per present severity with the right count", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    // aria-labels come from the shared indicator i18n keys (icon-only chips).
    expect(screen.getByRole("button", { name: /1 critical finding/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2 warning findings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 suggestion finding/i })).toBeInTheDocument();
  });

  it("clicking CRITICAL filters the list to critical findings", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    fireEvent.click(screen.getByRole("button", { name: /1 critical finding/i }));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("Unused variable")).not.toBeInTheDocument();
    expect(screen.queryByText("Rename for clarity")).not.toBeInTheDocument();
  });

  it("clicking the active chip again restores all findings (toggle off)", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    const critChip = screen.getByRole("button", { name: /1 critical finding/i });
    fireEvent.click(critChip);
    expect(screen.queryByText("Unused variable")).not.toBeInTheDocument();
    fireEvent.click(critChip);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Unused variable")).toBeInTheDocument();
    expect(screen.getByText("Rename for clarity")).toBeInTheDocument();
  });

  it("combines the severity filter with Hide low confidence", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    // Turn on hide-low: the 0.5-confidence warning drops, so WARNING count → 1.
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("Shadowed name")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /1 warning finding/i }));
    expect(screen.getByText("Unused variable")).toBeInTheDocument();
    expect(screen.queryByText("Shadowed name")).not.toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
  });
});
