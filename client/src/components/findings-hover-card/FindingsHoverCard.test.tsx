/**
 * FindingsHoverCard — shared by the PR timeline and the PR list's FINDINGS
 * column. The load-bearing test here is the last one: the card stops click
 * propagation, which is the only thing keeping a click inside the popup from
 * navigating away when it is rendered inside a clickable PR list row.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrListFinding } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { FindingsHoverCard } from "./FindingsHoverCard";

afterEach(cleanup);

function finding(o: Partial<PrListFinding>): PrListFinding {
  return {
    id: "f1",
    severity: "WARNING",
    category: "perf",
    title: "N+1 query in user list endpoint",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "The loop calls db.posts.findMany once per user.",
    confidence: 0.86,
    ...o,
  };
}

function renderCard(props: Partial<React.ComponentProps<typeof FindingsHoverCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsHoverCard findings={[finding({})]} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("FindingsHoverCard", () => {
  it("renders each finding's title, file:line label and rationale", () => {
    renderCard({
      findings: [
        finding({ id: "a", title: "Hardcoded secret", file: "src/config.ts", start_line: 12, end_line: 12 }),
      ],
    });
    expect(screen.getByText("Hardcoded secret")).toBeTruthy();
    // Same start/end collapses to a single line number.
    expect(screen.getByText("src/config.ts:12")).toBeTruthy();
    expect(screen.getByText(/db.posts.findMany/)).toBeTruthy();
  });

  it("renders a line range when start and end differ", () => {
    renderCard({ findings: [finding({ start_line: 45, end_line: 52 })] });
    expect(screen.getByText("src/api/users.ts:45-52")).toBeTruthy();
  });

  it("sorts worst-severity-first, then by descending confidence", () => {
    renderCard({
      findings: [
        finding({ id: "a", severity: "SUGGESTION", title: "sugg" }),
        finding({ id: "b", severity: "CRITICAL", title: "crit-low", confidence: 0.5 }),
        finding({ id: "c", severity: "WARNING", title: "warn" }),
        finding({ id: "d", severity: "CRITICAL", title: "crit-high", confidence: 0.9 }),
      ],
    });
    const order = ["crit-high", "crit-low", "warn", "sugg"];
    const rendered = order.map((title) => screen.getByText(title));
    // Compare DOM order against the expected severity/confidence order.
    for (let i = 1; i < rendered.length; i++) {
      const prev = rendered[i - 1]!;
      const cur = rendered[i]!;
      expect(prev.compareDocumentPosition(cur) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("deep-links the file to GitHub when repo and sha are known", () => {
    renderCard({ repoFullName: "acme/payments-api", headSha: "abc123" });
    const link = screen.getByText("src/api/users.ts:45-52").closest("a");
    expect(link?.getAttribute("href")).toContain("acme/payments-api");
    expect(link?.getAttribute("href")).toContain("abc123");
  });

  it("renders the file label without a link when the sha is unknown", () => {
    renderCard({ repoFullName: "acme/payments-api", headSha: null });
    expect(screen.getByText("src/api/users.ts:45-52").closest("a")).toBeNull();
  });

  it("stops click propagation so clicking it never triggers the row underneath", () => {
    // The PR list renders this inside a row whose onClick routes to the PR page.
    // Without the card's stopPropagation, reading a finding would navigate away.
    const onRowClick = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        {/* Stands in for the PR list row: click-to-navigate, plus the keyboard
            path that makes it reachable (same shape as FindingsCell). */}
        <div
          role="button"
          tabIndex={0}
          onClick={onRowClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              if (e.key === " ") e.preventDefault();
              onRowClick();
            }
          }}
        >
          <FindingsHoverCard findings={[finding({ title: "Hardcoded secret" })]} />
        </div>
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByText("Hardcoded secret"));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
