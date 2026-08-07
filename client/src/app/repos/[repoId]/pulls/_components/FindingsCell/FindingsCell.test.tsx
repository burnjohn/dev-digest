/**
 * FindingsCell — the PR list's FINDINGS column.
 *
 * Two things here are easy to break and invisible in review. The popup must be
 * `position: fixed` (it lives inside a row clipped by tableCard's
 * `overflow: hidden`, so `absolute` renders it invisible — and jsdom has no
 * layout, so only the inline style proves it). And a never-reviewed PR must be
 * non-interactive, not an empty hoverable target.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta, PrListFinding } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { FindingsCell } from "./FindingsCell";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => vi.useFakeTimers());

function finding(o: Partial<PrListFinding>): PrListFinding {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret committed",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "A literal sk_live_ key is committed.",
    confidence: 0.97,
    ...o,
  };
}

function pr(o: Partial<PrMeta>): PrMeta {
  return {
    number: 482,
    title: "Add rate limiting",
    author: "marisa.koch",
    branch: "feat/rate-limit",
    base: "main",
    head_sha: "abc123",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    ...o,
  } as PrMeta;
}

function renderCell(meta: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsCell pr={meta} repoFullName="acme/payments-api" />
    </NextIntlClientProvider>,
  );
}

/** Hover and let the 150ms debounce elapse. The act() wrapper is required — a
 *  bare advanceTimersByTime leaves the state update unflushed. */
function hover(el: HTMLElement) {
  fireEvent.mouseEnter(el);
  act(() => {
    vi.advanceTimersByTime(150);
  });
}

describe("FindingsCell", () => {
  it("renders one badge per non-zero severity and omits the empty ones", () => {
    renderCell(
      pr({
        critical_count: 1,
        warning_count: 4,
        suggestion_count: 0,
        findings: [finding({ id: "a" }), finding({ id: "b", severity: "WARNING" })],
      }),
    );
    const trigger = screen.getByRole("button");
    expect(trigger.textContent).toContain("1");
    expect(trigger.textContent).toContain("4");
    // A zero-count severity renders no badge at all.
    expect(screen.queryByText("0")).toBeNull();
  });

  it("renders a muted dash and stays non-interactive when never reviewed", () => {
    renderCell(pr({ critical_count: null, warning_count: null, suggestion_count: null, findings: null }));
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a dash when the review ran but found nothing live", () => {
    renderCell(pr({ critical_count: 0, warning_count: 0, suggestion_count: 0, findings: [] }));
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens the popup only after the hover debounce, and closes on mouse leave", () => {
    renderCell(pr({ critical_count: 1, warning_count: 0, suggestion_count: 0, findings: [finding({})] }));
    const trigger = screen.getByRole("button");

    fireEvent.mouseEnter(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull(); // still inside the debounce

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(screen.getByText("Hardcoded secret committed")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("positions the popup fixed so tableCard's overflow:hidden cannot clip it", () => {
    renderCell(pr({ critical_count: 1, warning_count: 0, suggestion_count: 0, findings: [finding({})] }));
    hover(screen.getByRole("button"));

    // The card sits inside a zero-sized fixed wrapper. `absolute` here would
    // render correctly in jsdom and be invisible in the real table.
    const wrapper = screen.getByRole("tooltip").parentElement!;
    expect(wrapper.style.position).toBe("fixed");
  });

  it("flips the popup above the trigger when it would not fit below", () => {
    // The last row of a full table sits near the bottom of the viewport; left
    // hanging downward the card runs straight off the fold. jsdom has no
    // layout, so the geometry has to be faked to exercise the decision.
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      // The card is the only element carrying an explicit pixel width.
      const isCard = (this as HTMLElement).getAttribute?.("role") === "tooltip";
      return isCard
        ? ({ height: 420, width: 380, top: 0, bottom: 420, left: 0, right: 380 } as DOMRect)
        : ({ height: 20, width: 140, top: 680, bottom: 700, left: 500, right: 640 } as DOMRect);
    };
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });

    try {
      renderCell(pr({ critical_count: 1, warning_count: 0, suggestion_count: 0, findings: [finding({})] }));
      hover(screen.getByRole("button"));

      const wrapper = screen.getByRole("tooltip").parentElement!;
      // Below would be 700; flipped is trigger-top(680) − height(420) − 2×gap(8).
      expect(wrapper.style.top).toBe("244px");
    } finally {
      Element.prototype.getBoundingClientRect = real;
    }
  });

  it("closes on scroll, since a fixed popup would otherwise drift from its row", () => {
    renderCell(pr({ critical_count: 1, warning_count: 0, suggestion_count: 0, findings: [finding({})] }));
    hover(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeTruthy();

    // Capture-phase listener: the app scrolls <main>, not the window.
    fireEvent.scroll(document.body);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes on Escape", () => {
    renderCell(pr({ critical_count: 1, warning_count: 0, suggestion_count: 0, findings: [finding({})] }));
    const trigger = screen.getByRole("button");
    hover(trigger);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows '+N more' when the counts exceed the embedded list", () => {
    // The API caps the array at 10 while the counts stay uncapped.
    renderCell(
      pr({
        critical_count: 2,
        warning_count: 4,
        suggestion_count: 6,
        findings: Array.from({ length: 10 }, (_, i) => finding({ id: `f${i}` })),
      }),
    );
    expect(screen.getByText("+2 more")).toBeTruthy();
  });

  it("shows no '+N more' when the list is complete", () => {
    renderCell(pr({ critical_count: 1, warning_count: 0, suggestion_count: 0, findings: [finding({})] }));
    expect(screen.queryByText(/more/)).toBeNull();
  });
});
