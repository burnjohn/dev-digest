import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const mockFindingActionMutate = vi.fn(
  (_vars: unknown, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) =>
    opts?.onSuccess?.(),
);
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: mockFindingActionMutate, isPending: false }),
}));

// specs/12-eval-pipeline.md — FindingsPanel now calls a SECOND mutation hook
// (the "turn into eval case" action) unconditionally alongside
// `useFindingAction`; every existing test here must stub it too
// (client/LEARNINGS.md: a component calling two mutation hooks breaks a test
// that only mocked one).
//
// specs/15-skill-eval-cases.md — a THIRD (mutation) and a fourth (query) hook
// are now called unconditionally too: `useCreateSkillEvalCaseFromFinding`
// (the skill-owned sibling of "turn into eval case") and
// `useFindingEvalSkills` (the offer-list read behind the skill menu).
vi.mock("../../../../../../../lib/hooks/eval", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSkillEvalCaseFromFinding: () => ({ mutate: vi.fn(), isPending: false }),
  useFindingEvalSkills: () => ({ data: undefined, isLoading: false }),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("../../../../../../../lib/toast", () => ({
  useToast: () => ({ success: mockToastSuccess, error: mockToastError, info: vi.fn(), toast: vi.fn() }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
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
    ...o,
  };
}

const FINDINGS: FindingRecord[] = [finding({ id: "f1" })];

/** 2 CRITICAL · 1 WARNING · 1 SUGGESTION, one of them low-confidence. */
const MIXED: FindingRecord[] = [
  finding({ id: "c1", severity: "CRITICAL", title: "Hardcoded secret" }),
  finding({ id: "c2", severity: "CRITICAL", title: "Open redirect" }),
  finding({ id: "w1", severity: "WARNING", title: "Missing rate limit" }),
  finding({ id: "s1", severity: "SUGGESTION", title: "Extract helper", confidence: 0.2 }),
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** The severity chips are the toolbar's buttons; cards are headings elsewhere. */
function chips() {
  return screen.getAllByRole("button").filter((b) => /^\d+ [A-Z]+$/.test(b.textContent ?? ""));
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

describe("FindingsPanel — severity counters", () => {
  it("counts each severity, in severity order", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    expect(chips().map((c) => c.textContent)).toEqual([
      "2 CRITICAL",
      "1 WARNING",
      "1 SUGGESTION",
    ]);
  });

  it("omits a severity with no findings", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(chips().map((c) => c.textContent)).toEqual(["1 CRITICAL"]);
  });

  it("clicking a severity leaves only its findings", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    fireEvent.click(screen.getByText("1 WARNING"));

    expect(screen.getByText("Missing rate limit")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    expect(screen.queryByText("Extract helper")).not.toBeInTheDocument();
  });

  it("clicking the active severity again clears the filter", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    const warning = screen.getByText("1 WARNING");

    fireEvent.click(warning);
    expect(warning).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();

    fireEvent.click(warning);
    expect(warning).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("counts follow hide-low-confidence, so a chip always matches its list", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    // The 0.2-confidence SUGGESTION is counted while the toggle is off…
    expect(chips().map((c) => c.textContent)).toContain("1 SUGGESTION");

    fireEvent.click(screen.getByRole("switch"));

    // …and disappears from the chips once it's hidden from the list.
    expect(chips().map((c) => c.textContent)).toEqual(["2 CRITICAL", "1 WARNING"]);
    expect(screen.queryByText("Extract helper")).not.toBeInTheDocument();
  });
});

describe("FindingsPanel — turn into eval case (specs/12-eval-pipeline.md AC-1, AC-2)", () => {
  it("shows the action only on a triaged (accepted/dismissed) finding, and calls the eval-case mutation, not the accept/dismiss one", () => {
    renderWithIntl(
      <FindingsPanel findings={[finding({ id: "f1", accepted_at: "2026-01-01T00:00:00.000Z" })]} prId="pr1" />,
    );
    fireEvent.click(screen.getByText("Turn into eval case"));
  });

  it("is absent on an untriaged finding", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.queryByText("Turn into eval case")).not.toBeInTheDocument();
  });
});

describe("FindingsPanel — Learn (specs/13-multi-agent-review.md AC-63..65)", () => {
  it("calls the shared finding-action mutation with 'learn' and toasts the recorded copy", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.click(screen.getByText("Learn"));
    expect(mockFindingActionMutate).toHaveBeenCalledWith(
      { findingId: "f1", action: "learn", prId: "pr1" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith("This finding was recorded as a note for this repository.");
  });
});
