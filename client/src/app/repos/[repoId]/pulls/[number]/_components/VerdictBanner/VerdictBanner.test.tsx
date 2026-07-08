import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import { VerdictBanner } from "./VerdictBanner";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("VerdictBanner (smoke)", () => {
  it("shows verdict label + score + finding/blocker counts", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="request_changes"
        summary="Hardcoded secret introduced."
        score={42}
        findingsCount={1}
        blockers={1}
        agentName="Security Reviewer"
      />,
    );
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText(/1 findings · 1 blockers/)).toBeInTheDocument();
  });
});

describe("VerdictBanner (PR Why + Risk Brief enhancements)", () => {
  it("renders identically to before when no new props are passed (regression guard)", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="approve"
        summary="Looks good."
        score={80}
        findingsCount={0}
        blockers={0}
      />,
    );
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Looks good.")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    // No regenerate button rendered without onRegenerate
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // No provenance line without costUsd
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it.each([
    ["critical", 15],
    ["high", 40],
    ["medium", 65],
    ["low", 90],
  ] as const)("maps riskLevel=%s to gauge value %d", (riskLevel, expected) => {
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="fallback"
        score={99}
        findingsCount={0}
        blockers={0}
        riskLevel={riskLevel}
      />,
    );
    // Gauge renders the mapped proxy value, not the raw `score` prop
    expect(screen.getByText(String(expected))).toBeInTheDocument();
    expect(screen.queryByText("99")).not.toBeInTheDocument();
  });

  it("renders what/why narrative concatenated, overriding summary", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="fallback summary"
        score={70}
        findingsCount={0}
        blockers={0}
        what="This PR refactors the auth module."
        why="Because the previous implementation leaked tokens in logs."
      />,
    );
    expect(
      screen.getByText(
        "This PR refactors the auth module. Because the previous implementation leaked tokens in logs.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("fallback summary")).not.toBeInTheDocument();
  });

  it("falls back to summary when what/why are absent", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="deterministic summary only"
        score={70}
        findingsCount={0}
        blockers={0}
      />,
    );
    expect(screen.getByText("deterministic summary only")).toBeInTheDocument();
  });

  it("disables the regenerate icon button while regenerating", () => {
    const onRegenerate = vi.fn();
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="s"
        score={70}
        findingsCount={0}
        blockers={0}
        onRegenerate={onRegenerate}
        regenerating
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
  });

  it("calls onRegenerate when the regenerate icon is clicked", async () => {
    const onRegenerate = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="s"
        score={70}
        findingsCount={0}
        blockers={0}
        onRegenerate={onRegenerate}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).not.toBeDisabled();
    await userEvent.click(btn);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("renders provenance line as '$cost inK+outK' when tokens are present", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="s"
        score={70}
        findingsCount={0}
        blockers={0}
        costUsd={0.014}
        tokensIn={8200}
        tokensOut={1300}
      />,
    );
    expect(screen.getByText(/8\.2K\+1\.3K/)).toBeInTheDocument();
  });

  it("renders the inline error message when generationError is set", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="s"
        score={70}
        findingsCount={0}
        blockers={0}
        generationError="timeout"
      />,
    );
    expect(screen.getByText(/timeout/)).toBeInTheDocument();
  });
});

describe("VerdictBanner (Clear brief)", () => {
  it("does not render the clear button when onClear is not provided", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="s"
        score={70}
        findingsCount={0}
        blockers={0}
      />,
    );
    expect(screen.queryByRole("button", { name: /Clear brief/ })).not.toBeInTheDocument();
  });

  it("renders the clear button when onClear is provided", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="s"
        score={70}
        findingsCount={0}
        blockers={0}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Clear brief" })).toBeInTheDocument();
  });

  it("calls onClear when the clear icon is clicked", async () => {
    const onClear = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="s"
        score={70}
        findingsCount={0}
        blockers={0}
        onClear={onClear}
      />,
    );
    const btn = screen.getByRole("button", { name: "Clear brief" });
    expect(btn).not.toBeDisabled();
    await userEvent.click(btn);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("disables the clear icon button while clearing", () => {
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="s"
        score={70}
        findingsCount={0}
        blockers={0}
        onClear={vi.fn()}
        clearing
      />,
    );
    const btn = screen.getByRole("button", { name: "Clearing…" });
    expect(btn).toBeDisabled();
  });

  it("renders both regenerate and clear buttons together without interfering", async () => {
    const onRegenerate = vi.fn();
    const onClear = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    renderWithIntl(
      <VerdictBanner
        verdict="comment"
        summary="s"
        score={70}
        findingsCount={0}
        blockers={0}
        onRegenerate={onRegenerate}
        onClear={onClear}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Clear brief" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onRegenerate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
