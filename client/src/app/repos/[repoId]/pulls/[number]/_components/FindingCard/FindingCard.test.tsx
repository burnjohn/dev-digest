import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const createEvalCaseMutate = vi.fn();
let createEvalCaseState: { isPending: boolean; isSuccess: boolean } = {
  isPending: false,
  isSuccess: false,
};

vi.mock("@/lib/hooks/eval", () => ({
  useCreateEvalCaseFromFinding: () => ({
    mutate: createEvalCaseMutate,
    ...createEvalCaseState,
  }),
}));

import { FindingCard } from "./FindingCard";

afterEach(() => {
  cleanup();
  createEvalCaseMutate.mockClear();
  createEvalCaseState = { isPending: false, isSuccess: false };
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard — add to eval case", () => {
  it("hides the action when the finding is neither accepted nor dismissed", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    expect(screen.queryByText("Add to eval set")).not.toBeInTheDocument();
  });

  it("shows an enabled action once the finding is accepted, and calls the mutation with the finding id", () => {
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-01T00:00:00Z" };
    renderWithIntl(
      <FindingCard f={accepted} defaultExpanded onAction={() => {}} agentId="agent-1" />,
    );
    const button = screen.getByText("Add to eval set");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(createEvalCaseMutate).toHaveBeenCalledWith({ findingId: "f1", agentId: "agent-1" });
  });

  it("creates the case immediately with no confirmation dialog (AC-1)", () => {
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-01T00:00:00Z" };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Add to eval set"));

    // Mutation fires straight away — no intermediate confirmation dialog.
    expect(createEvalCaseMutate).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows an enabled action once the finding is dismissed", () => {
    const dismissed: FindingRecord = { ...FINDING, dismissed_at: "2026-07-01T00:00:00Z" };
    renderWithIntl(<FindingCard f={dismissed} defaultExpanded onAction={() => {}} />);
    expect(screen.getByText("Add to eval set")).toBeEnabled();
  });

  it("disables the action while the mutation is pending", () => {
    createEvalCaseState = { isPending: true, isSuccess: false };
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-01T00:00:00Z" };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);
    expect(screen.getByText("Add to eval set")).toBeDisabled();
  });

  it("renders a success confirmation after the mutation resolves", () => {
    createEvalCaseState = { isPending: false, isSuccess: true };
    const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-01T00:00:00Z" };
    renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);
    expect(screen.getByText("Added to eval set ✓")).toBeInTheDocument();
  });
});
