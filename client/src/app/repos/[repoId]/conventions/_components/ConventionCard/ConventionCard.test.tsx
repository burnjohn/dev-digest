import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  repo_id: "r1",
  category: "errors",
  rule: "Throw NotFoundError for a missing row",
  rationale: "Callers rely on the throw, never on a null check.",
  evidence_path: "src/api/users.ts",
  evidence_line: 23,
  evidence_snippet: 'if (!user) throw new NotFoundError("User not found");',
  confidence: 0.91,
  status: "pending",
  created_at: "2026-08-05T10:00:00.000Z",
};

function renderCard(
  over: Partial<ConventionCandidate> = {},
  handlers: Partial<{
    onStatus: (s: string) => void;
    onSave: (p: { rule: string; rationale: string | null }) => void;
    onDelete: () => void;
  }> = {},
  props: { evidenceHref?: string | null; selectable?: boolean; selected?: boolean } = {},
) {
  const onStatus = vi.fn();
  const onSave = vi.fn();
  const onDelete = vi.fn();
  const onSelect = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionCard
        candidate={{ ...CANDIDATE, ...over }}
        evidenceHref={props.evidenceHref ?? null}
        selectable={props.selectable}
        selected={props.selected}
        onSelect={onSelect}
        onStatus={handlers.onStatus ?? onStatus}
        onSave={handlers.onSave ?? onSave}
        onDelete={handlers.onDelete ?? onDelete}
      />
    </NextIntlClientProvider>,
  );
  return { onStatus, onSave, onDelete, onSelect };
}

describe("ConventionCard", () => {
  it("shows the rule, its category, the file:line and the verified snippet", () => {
    renderCard();
    expect(screen.getByText("Throw NotFoundError for a missing row")).toBeInTheDocument();
    expect(screen.getByText("errors")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23")).toBeInTheDocument();
    expect(
      screen.getByText('if (!user) throw new NotFoundError("User not found");'),
    ).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
  });

  it("omits the line suffix when the evidence has no line", () => {
    renderCard({ evidence_line: null });
    expect(screen.getByText("src/api/users.ts")).toBeInTheDocument();
  });

  it("accepts a pending candidate", () => {
    const { onStatus } = renderCard();
    fireEvent.click(screen.getByText("Accept"));
    expect(onStatus).toHaveBeenCalledWith("accepted");
  });

  it("rejects a pending candidate", () => {
    const { onStatus } = renderCard();
    fireEvent.click(screen.getByText("Reject"));
    expect(onStatus).toHaveBeenCalledWith("rejected");
  });

  it("clicking Accepted again moves the candidate back to pending", () => {
    const { onStatus } = renderCard({ status: "accepted" });
    fireEvent.click(screen.getByText("Accepted"));
    expect(onStatus).toHaveBeenCalledWith("pending");
  });

  it("edits the rule and saves the trimmed text", () => {
    const { onSave } = renderCard();
    fireEvent.click(screen.getByLabelText("Edit rule"));
    const input = screen.getByDisplayValue("Throw NotFoundError for a missing row");
    fireEvent.change(input, { target: { value: "  Throw NotFoundError, never return null  " } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({
      rule: "Throw NotFoundError, never return null",
      rationale: "Callers rely on the throw, never on a null check.",
    });
  });

  it("cancelling an edit leaves the original rule on the card", () => {
    const { onSave } = renderCard();
    fireEvent.click(screen.getByLabelText("Edit rule"));
    fireEvent.change(screen.getByDisplayValue("Throw NotFoundError for a missing row"), {
      target: { value: "something else" },
    });
    fireEvent.click(screen.getByText("Cancel"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Throw NotFoundError for a missing row")).toBeInTheDocument();
  });

  it("clears an emptied rationale to null rather than an empty string", () => {
    const { onSave } = renderCard();
    fireEvent.click(screen.getByLabelText("Edit rule"));
    fireEvent.change(
      screen.getByDisplayValue("Callers rely on the throw, never on a null check."),
      { target: { value: "   " } },
    );
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ rationale: null }));
  });

  it("links the evidence to the exact line on GitHub, opening in a new tab", () => {
    renderCard(
      {},
      {},
      { evidenceHref: "https://github.com/acme/payments-api/blob/main/src/api/users.ts#L23" },
    );
    const link = screen.getByRole("link", { name: /src\/api\/users\.ts:23/ });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/main/src/api/users.ts#L23",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("renders the evidence as plain text when there is no link to give", () => {
    renderCard();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23")).toBeInTheDocument();
  });

  it("offers an include checkbox only for accepted candidates", () => {
    renderCard({ status: "accepted" }, {}, { selectable: true, selected: true });
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  });

  it("deselecting a candidate reports it, so it can be left out of the skill", () => {
    const { onSelect } = renderCard(
      { status: "accepted" },
      {},
      { selectable: true, selected: true },
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onSelect).toHaveBeenCalledWith(false);
  });

  it("has no checkbox on a pending candidate", () => {
    renderCard();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("deletes the candidate", () => {
    const { onDelete } = renderCard();
    fireEvent.click(screen.getByLabelText("Delete candidate"));
    expect(onDelete).toHaveBeenCalled();
  });
});
