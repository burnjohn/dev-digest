/**
 * FindingsIndicator — a presentational severity strip + portalled popup.
 * These guard the load-bearing behaviors (see INSIGHTS): the popup PORTALS to
 * <body> with position:fixed (so the PR-list table card's overflow:hidden can't
 * clip it), only ONE popup is open page-wide, it preserves a user-picked filter
 * on strip re-entry, and it closes on mouse-leave but NOT when moving strip→popup.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { FindingsIndicator } from "./FindingsIndicator";

afterEach(cleanup);

let fid = 0;
function finding(o: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: `f${fid++}`,
    severity: "CRITICAL",
    category: "bug",
    title: "Null deref",
    file: "src/a.ts",
    start_line: 10,
    end_line: 12,
    rationale: "boom",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function renderIndicator(props: Partial<React.ComponentProps<typeof FindingsIndicator>> = {}) {
  const counts = props.counts ?? { CRITICAL: 2, WARNING: 1, SUGGESTION: 0 };
  const findings =
    props.findings ??
    [
      finding({ severity: "CRITICAL", title: "Null deref" }),
      finding({ severity: "CRITICAL", title: "Race condition" }),
      finding({ severity: "WARNING", title: "Unused var", file: "src/b.ts" }),
    ];
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsIndicator counts={counts} findings={findings} {...props} />
    </NextIntlClientProvider>,
  );
}

/** The strip div owns the mouseEnter/leave handlers; grab it from a badge button. */
function stripOf(button: HTMLElement): HTMLElement {
  return button.parentElement as HTMLElement;
}

describe("FindingsIndicator", () => {
  it("renders one icon per non-zero severity, none for zero", () => {
    renderIndicator({ counts: { CRITICAL: 2, WARNING: 1, SUGGESTION: 0 }, findings: [] });
    expect(screen.getByRole("button", { name: /critical/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /warning/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /suggestion/i })).not.toBeInTheDocument();
  });

  it("renders nothing when all severities are zero", () => {
    const { container } = renderIndicator({
      counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
      findings: [],
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("clicking a severity opens the popup filtered to that level", () => {
    renderIndicator();
    fireEvent.click(screen.getByRole("button", { name: /critical/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Null deref")).toBeInTheDocument();
    expect(screen.getByText("Race condition")).toBeInTheDocument();
    // Filtered to CRITICAL → the WARNING finding is hidden.
    expect(screen.queryByText("Unused var")).not.toBeInTheDocument();
  });

  it("hover opens the popup unfiltered (all findings)", () => {
    renderIndicator();
    fireEvent.mouseEnter(stripOf(screen.getByRole("button", { name: /critical/i })));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Unused var")).toBeInTheDocument();
    expect(screen.getByText("Null deref")).toBeInTheDocument();
  });

  it("strip icons switch the visible set", () => {
    renderIndicator();
    fireEvent.mouseEnter(stripOf(screen.getByRole("button", { name: /critical/i })));
    // Click the WARNING strip icon → filter switches to warnings only.
    fireEvent.click(screen.getByRole("button", { name: /1 warning finding/i }));
    expect(screen.getByText("Unused var")).toBeInTheDocument();
    expect(screen.queryByText("Null deref")).not.toBeInTheDocument();
  });

  it("re-clicking the active strip icon toggles the filter back to all", () => {
    renderIndicator();
    const critIcon = screen.getByRole("button", { name: /2 critical findings/i });
    fireEvent.click(critIcon); // open filtered to CRITICAL
    expect(screen.queryByText("Unused var")).not.toBeInTheDocument();
    fireEvent.click(critIcon); // re-click the active icon → back to "all"
    expect(screen.getByText("Unused var")).toBeInTheDocument();
    expect(screen.getByText("Null deref")).toBeInTheDocument();
  });

  it("shows a spinner, not rows, while loading", () => {
    renderIndicator({ loading: true, findings: [] });
    fireEvent.mouseEnter(stripOf(screen.getByRole("button", { name: /critical/i })));
    expect(screen.getByText(/loading findings/i)).toBeInTheDocument();
    expect(screen.queryByText("Null deref")).not.toBeInTheDocument();
  });

  it("preserves a picked filter when the pointer re-enters the strip", () => {
    renderIndicator();
    const critBtn = screen.getByRole("button", { name: /critical/i });
    fireEvent.click(critBtn); // filter = CRITICAL
    expect(screen.queryByText("Unused var")).not.toBeInTheDocument();
    // Re-enter the strip while already open → filter must NOT reset to "all".
    fireEvent.mouseEnter(stripOf(critBtn));
    expect(screen.queryByText("Unused var")).not.toBeInTheDocument();
    expect(screen.getByText("Null deref")).toBeInTheDocument();
  });

  it("portals the popup to <body> with position:fixed (never clipped)", () => {
    const { container } = renderIndicator();
    fireEvent.click(screen.getByRole("button", { name: /critical/i }));
    const dialog = screen.getByRole("dialog");
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.style.position).toBe("fixed");
  });

  it("keeps only one popup open across multiple indicators", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsIndicator counts={{ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 }} findings={[finding()]} />
        <FindingsIndicator
          counts={{ CRITICAL: 0, WARNING: 1, SUGGESTION: 0 }}
          findings={[finding({ severity: "WARNING", title: "Second" })]}
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /critical/i }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /warning/i }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("closes on mouse-leave after the grace delay", () => {
    vi.useFakeTimers();
    try {
      renderIndicator();
      const strip = stripOf(screen.getByRole("button", { name: /critical/i }));
      fireEvent.mouseEnter(strip);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.mouseLeave(strip);
      act(() => vi.advanceTimersByTime(300));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT close when the pointer moves from strip to popup", () => {
    vi.useFakeTimers();
    try {
      renderIndicator();
      const strip = stripOf(screen.getByRole("button", { name: /critical/i }));
      fireEvent.mouseEnter(strip);
      const dialog = screen.getByRole("dialog");
      fireEvent.mouseLeave(strip); // schedules close
      fireEvent.mouseEnter(dialog); // cancels it
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
