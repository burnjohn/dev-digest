/**
 * SeverityCounters — the chip row and its popover.
 *
 * The load-bearing behaviours: a chip opens ONLY its own severity (the whole
 * point of the counter), and clicking one must not bubble into the PR row's
 * navigation handler underneath it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { SeverityCounters } from "./SeverityCounters";

afterEach(cleanup);

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: `Finding ${o.id}`,
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "because",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

const FINDINGS: FindingRecord[] = [
  finding({ id: "c1", severity: "CRITICAL", title: "Hardcoded Stripe secret key" }),
  finding({ id: "c2", severity: "CRITICAL", title: "Untrusted input reaches exfil path" }),
  finding({ id: "w1", severity: "WARNING", title: "N+1 query in user list endpoint" }),
  finding({ id: "s1", severity: "SUGGESTION", title: "Extract magic number 3600" }),
];

const COUNTS = { CRITICAL: 2, WARNING: 1, SUGGESTION: 1 };

function renderCounters(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SeverityCounters", () => {
  it("renders one chip per non-zero severity, with its count", () => {
    renderCounters(<SeverityCounters counts={COUNTS} findings={FINDINGS} scope="pr" />);
    expect(screen.getByRole("button", { name: /2 critical/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 warning/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 suggestion/i })).toBeInTheDocument();
  });

  it("omits a severity with a count of 0 rather than showing a zero chip", () => {
    renderCounters(
      <SeverityCounters
        counts={{ CRITICAL: 0, WARNING: 1, SUGGESTION: 0 }}
        findings={FINDINGS}
        scope="pr"
      />,
    );
    expect(screen.queryByRole("button", { name: /critical/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 warning/i })).toBeInTheDocument();
  });

  it("shows a dash when the PR has never been reviewed", () => {
    renderCounters(<SeverityCounters counts={null} scope="pr" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a zero state — not a dash — for a reviewed PR that came back clean", () => {
    renderCounters(
      <SeverityCounters counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }} scope="pr" />,
    );
    expect(screen.getByText("No findings")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("opens a popover listing ONLY the clicked severity's findings", () => {
    renderCounters(<SeverityCounters counts={COUNTS} findings={FINDINGS} scope="pr" />);

    fireEvent.click(screen.getByRole("button", { name: /2 critical/i }));

    const panel = screen.getByRole("dialog");
    expect(within(panel).getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(within(panel).getByText("Untrusted input reaches exfil path")).toBeInTheDocument();
    // The other severities must not leak in.
    expect(within(panel).queryByText("N+1 query in user list endpoint")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Extract magic number 3600")).not.toBeInTheDocument();
  });

  it("switches the popover when a different chip is clicked", () => {
    renderCounters(<SeverityCounters counts={COUNTS} findings={FINDINGS} scope="pr" />);

    fireEvent.click(screen.getByRole("button", { name: /2 critical/i }));
    fireEvent.click(screen.getByRole("button", { name: /1 warning/i }));

    const panel = screen.getByRole("dialog");
    expect(within(panel).getByText("N+1 query in user list endpoint")).toBeInTheDocument();
    expect(within(panel).queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
  });

  it("closes when the same chip is clicked again", () => {
    renderCounters(<SeverityCounters counts={COUNTS} findings={FINDINGS} scope="pr" />);
    const chip = screen.getByRole("button", { name: /2 critical/i });

    fireEvent.click(chip);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape and on an outside click", () => {
    renderCounters(
      <div>
        <span data-testid="outside">elsewhere</span>
        <SeverityCounters counts={COUNTS} findings={FINDINGS} scope="pr" />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /2 critical/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /2 critical/i }));
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not bubble a chip click into the row that wraps it", () => {
    // The whole PR list row is a router.push target — a counter must not
    // navigate away instead of opening.
    const onRowClick = vi.fn();
    renderCounters(
      <div onClick={onRowClick}>
        <SeverityCounters counts={COUNTS} findings={FINDINGS} scope="pr" />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /2 critical/i }));
    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("reports open/close so a parent can fetch findings lazily", () => {
    const onOpenChange = vi.fn();
    renderCounters(
      <SeverityCounters
        counts={COUNTS}
        findings={FINDINGS}
        scope="pr"
        onOpenChange={onOpenChange}
      />,
    );

    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: /2 critical/i }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("shows a loading state while the findings behind an open popover arrive", () => {
    renderCounters(<SeverityCounters counts={COUNTS} findings={[]} loading scope="pr" />);

    fireEvent.click(screen.getByRole("button", { name: /2 critical/i }));
    expect(screen.getByText("Loading findings…")).toBeInTheDocument();
  });

  it("says 'in this run' when scoped to a run", () => {
    renderCounters(
      <SeverityCounters
        counts={{ CRITICAL: 0, WARNING: 1, SUGGESTION: 0 }}
        findings={FINDINGS}
        scope="run"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /1 warning/i }));
    expect(screen.getByText(/in this run/i)).toBeInTheDocument();
  });
});
