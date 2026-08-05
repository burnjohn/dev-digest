/**
 * RunSeverityBadges — badges group the run's findings by severity (sorted,
 * zero-count severities omitted), hover/focus shows the findings popover,
 * click opens the trace. Counting includes dismissed findings on purpose
 * (COUNT_DISMISSED) so the sum matches the run row's stored findings_count.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunSeverityBadges } from "./RunSeverityBadges";

afterEach(cleanup);

let seq = 0;
function finding(o: Partial<FindingRecord>): FindingRecord {
  seq += 1;
  return {
    id: `f-${seq}`,
    review_id: "rev-1",
    severity: "WARNING",
    category: "bug",
    title: `Finding ${seq}`,
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "The loop calls the DB once per user.",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...o,
  } as FindingRecord;
}

function renderBadges(findings: FindingRecord[], onClick?: () => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunSeverityBadges findings={findings} onClick={onClick} />
    </NextIntlClientProvider>,
  );
}

describe("RunSeverityBadges — badge group", () => {
  it("renders one counted badge per non-zero severity, sorted CRITICAL first", () => {
    renderBadges([
      finding({ severity: "WARNING" }),
      finding({ severity: "CRITICAL" }),
      finding({ severity: "CRITICAL" }),
    ]);
    const button = screen.getByRole("button");
    // Counts render inside the badges; no SUGGESTION badge for a zero count.
    expect(button).toHaveTextContent("2");
    expect(button).toHaveTextContent("1");
    // Sorted: the CRITICAL count (2) comes before the WARNING count (1).
    expect(button.textContent!.indexOf("2")).toBeLessThan(button.textContent!.indexOf("1"));
  });

  it("renders nothing for an empty findings list", () => {
    renderBadges([]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("counts dismissed findings (COUNT_DISMISSED guard)", () => {
    renderBadges([
      finding({ severity: "CRITICAL", dismissed_at: "2026-08-01T00:00:00Z" }),
      finding({ severity: "CRITICAL" }),
    ]);
    expect(screen.getByRole("button")).toHaveTextContent("2");
  });
});

describe("RunSeverityBadges — hover popover", () => {
  const three = () => [
    finding({ severity: "CRITICAL", title: "Hardcoded Stripe secret key", category: "security", confidence: 0.98, file: "src/config.ts", start_line: 12, end_line: 12 }),
    finding({ severity: "CRITICAL", title: "Lethal trifecta", category: "security", confidence: 0.79 }),
    finding({ severity: "WARNING", title: "Retry-After header omitted", category: "bug", confidence: 0.81 }),
  ];

  it("mouseEnter shows title, finding rows, category, file ref and confidence; mouseLeave hides", () => {
    renderBadges(three());
    const anchor = screen.getByRole("button").parentElement!;
    fireEvent.mouseEnter(anchor);

    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("3 findings")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getAllByText("security").length).toBe(2);
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(screen.getByText("98% conf")).toBeInTheDocument();

    fireEvent.mouseLeave(anchor);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("sorts by severity then confidence, caps at 5 and shows '+N more'", () => {
    const findings = [
      ...Array.from({ length: 6 }, (_, i) =>
        finding({ severity: "SUGGESTION", title: `Sugg ${i}`, confidence: 0.5 + i / 100 }),
      ),
      finding({ severity: "CRITICAL", title: "The blocker", confidence: 0.6 }),
    ];
    renderBadges(findings);
    fireEvent.mouseEnter(screen.getByRole("button").parentElement!);

    // 7 findings → 5 rows + footer; CRITICAL first despite lower confidence.
    expect(screen.getByText("7 findings")).toBeInTheDocument();
    expect(screen.getByText("The blocker")).toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
    expect(screen.queryByText("Sugg 0")).not.toBeInTheDocument(); // lowest confidence, capped out
  });

  it("focus also opens the popover (keyboard path)", () => {
    renderBadges(three());
    fireEvent.focus(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });
});

describe("RunSeverityBadges — click", () => {
  it("fires onClick once and closes the popover", () => {
    const onClick = vi.fn();
    renderBadges([finding({ severity: "CRITICAL" })], onClick);
    const button = screen.getByRole("button");
    fireEvent.mouseEnter(button.parentElement!);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
