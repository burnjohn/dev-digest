import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { CandidateCard } from "./CandidateCard";

afterEach(cleanup);

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  category: "naming",
  rule: "Always use async/await instead of .then() chains.",
  evidence_path: "src/api/users.ts",
  evidence_start_line: 23,
  evidence_end_line: 31,
  evidence_snippet: "const user = await db.users.find(id);",
  confidence: 0.91,
  accepted: false,
};

function renderCard(overrides: Partial<React.ComponentProps<typeof CandidateCard>> = {}) {
  const onAccept = vi.fn();
  const onReject = vi.fn();
  const onSaveEdit = vi.fn();
  const onToggleBundleSelected = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <CandidateCard
        candidate={CANDIDATE}
        bundleSelected
        onToggleBundleSelected={onToggleBundleSelected}
        onAccept={onAccept}
        onReject={onReject}
        onSaveEdit={onSaveEdit}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
  return { onAccept, onReject, onSaveEdit, onToggleBundleSelected };
}

describe("CandidateCard", () => {
  it("renders the rule, category, evidence location, snippet and confidence", () => {
    renderCard();
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByText("naming")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
    expect(screen.getByText(CANDIDATE.evidence_snippet)).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
  });

  it("shows no bundle checkbox for a not-yet-accepted candidate", () => {
    renderCard();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows the bundle checkbox for an accepted candidate and fires the toggle", () => {
    const { onToggleBundleSelected } = renderCard({
      candidate: { ...CANDIDATE, accepted: true },
      bundleSelected: true,
    });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggleBundleSelected).toHaveBeenCalledWith(false);
  });

  it("fires onAccept and onReject from the action buttons", () => {
    const { onAccept, onReject } = renderCard();
    fireEvent.click(screen.getByText("Accept"));
    expect(onAccept).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Reject"));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("edits rule and category, then saves the trimmed values", () => {
    const { onSaveEdit } = renderCard();
    fireEvent.click(screen.getByLabelText("Edit"));

    const ruleInput = screen.getByPlaceholderText("Rule");
    fireEvent.change(ruleInput, { target: { value: "  Edited rule.  " } });
    const categoryInput = screen.getByPlaceholderText("Category");
    fireEvent.change(categoryInput, { target: { value: "  renamed  " } });

    fireEvent.click(screen.getByText("Save"));
    expect(onSaveEdit).toHaveBeenCalledWith({ rule: "Edited rule.", category: "renamed" });
  });

  it("cancels an edit without calling onSaveEdit", () => {
    const { onSaveEdit } = renderCard();
    fireEvent.click(screen.getByLabelText("Edit"));
    fireEvent.change(screen.getByPlaceholderText("Rule"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByText("Cancel"));

    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
  });
});
