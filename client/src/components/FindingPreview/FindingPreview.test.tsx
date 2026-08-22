import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { FindingRecord } from "@devdigest/shared";
import { FindingPreview } from "./FindingPreview";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 14,
  rationale: "A live Stripe key is committed in source.",
  suggestion: null,
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

describe("FindingPreview", () => {
  it("renders title, category, file:line range, confidence and rationale", () => {
    render(<FindingPreview f={FINDING} />);
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:11-14")).toBeInTheDocument();
    expect(screen.getByText("95% conf")).toBeInTheDocument();
    expect(screen.getByText("A live Stripe key is committed in source.")).toBeInTheDocument();
  });

  it("links file:line to GitHub only when repo + head sha are known", () => {
    const { rerender } = render(<FindingPreview f={FINDING} />);
    // No repo/sha → plain button, not an anchor.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    rerender(<FindingPreview f={FINDING} repoFullName="acme/payments-api" headSha="abc123" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc123/src/config.ts#L11-L14",
    );
  });

  it("links file:line to the PR's Files changed when a PR number is known", () => {
    render(<FindingPreview f={FINDING} repoFullName="acme/payments-api" prNumber={482} />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/pull/482/files",
    );
  });

  it("calls onSelect when the card body is clicked, but not when the file link is clicked", () => {
    const onSelect = vi.fn();
    render(
      <FindingPreview f={FINDING} repoFullName="acme/payments-api" prNumber={482} onSelect={onSelect} />,
    );
    // Clicking the file link must not bubble to the card's onSelect.
    fireEvent.click(screen.getByRole("link"));
    expect(onSelect).not.toHaveBeenCalled();
    // Clicking the title (card body) selects the finding.
    fireEvent.click(screen.getByText("Hardcoded Stripe secret key"));
    expect(onSelect).toHaveBeenCalledWith("f1");
  });
});
