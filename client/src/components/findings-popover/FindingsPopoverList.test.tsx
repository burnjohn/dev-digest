import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { FindingsPopoverList } from "./FindingsPopoverList";

afterEach(cleanup);

function finding(o: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f-1",
    review_id: "rev-1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A live Stripe key is committed in source.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPopoverList", () => {
  it("renders a live finding's severity, file:line, confidence, and a truncated rationale", () => {
    renderWithIntl(<FindingsPopoverList findings={[finding({})]} />);
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getByText(/src\/config\.ts:11/)).toBeInTheDocument();
    expect(screen.getByText("A live Stripe key is committed in source.")).toBeInTheDocument();
  });

  it("drops dismissed findings — a fully-dismissed list reads as empty", () => {
    renderWithIntl(
      <FindingsPopoverList findings={[finding({ dismissed_at: "2026-06-11T18:00:00.000Z" })]} />,
    );
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
    expect(screen.getByText("No findings")).toBeInTheDocument();
  });

  it("shows the empty state when there are no findings at all", () => {
    renderWithIntl(<FindingsPopoverList findings={[]} />);
    expect(screen.getByText("No findings")).toBeInTheDocument();
  });

  it("shows a loading state instead of the findings/empty state", () => {
    renderWithIntl(<FindingsPopoverList findings={undefined} loading />);
    expect(screen.getByText("Loading findings…")).toBeInTheDocument();
  });

  it("truncates a long rationale to ~140 characters as plain text", () => {
    const long = "A".repeat(200);
    renderWithIntl(<FindingsPopoverList findings={[finding({ rationale: long })]} />);
    const shown = screen.getByText(/^A+…$/);
    expect(shown.textContent!.length).toBeLessThan(200);
  });
});
