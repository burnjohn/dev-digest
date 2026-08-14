/**
 * PRRow — the whole row is a click target that routes to the PR detail page.
 *
 * The load-bearing test is the navigation guard: the FINDINGS popup renders
 * inside the row, so without the hover card's stopPropagation, reading a
 * finding would navigate away mid-read. That invariant is exactly what a
 * refactor to a portal (or a "tidy-up" of the event handling) would silently
 * break, so it is pinned here rather than left to manual testing.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
// RunCostBadge in the COST cell reads the `runs` namespace.
import runsMessages from "../../../../../../../messages/en/runs.json";
import { COLUMN_KEYS } from "../../constants";
import { PRRow } from "./PRRow";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/payments-api" } }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  push.mockClear();
  vi.useFakeTimers();
});

function pr(o: Partial<PrMeta> = {}): PrMeta {
  return {
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit",
    base: "main",
    head_sha: "abc123",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    score: 61,
    critical_count: 1,
    warning_count: 0,
    suggestion_count: 0,
    findings: [
      {
        id: "f1",
        severity: "CRITICAL",
        category: "security",
        title: "Hardcoded secret committed",
        file: "src/config.ts",
        start_line: 12,
        end_line: 12,
        rationale: "A literal sk_live_ key is committed.",
        confidence: 0.97,
      },
    ],
    ...o,
  } as PrMeta;
}

function renderRow(meta: PrMeta = pr()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, runs: runsMessages }}>
      <PRRow pr={meta} repoId="r1" />
    </NextIntlClientProvider>,
  );
}

/**
 * The FINDINGS cell trigger. The row itself is also `role="button"` (it is a
 * click target, so it carries the keyboard affordances to match), so this has
 * to be matched by its accessible name rather than by role alone.
 */
const findingsTrigger = () => screen.getByRole("button", { name: "1 findings" });

describe("PRRow", () => {
  it("routes to the PR detail page when the row is clicked", () => {
    renderRow();
    fireEvent.click(screen.getByText("Add rate limiting to public API endpoints"));
    expect(push).toHaveBeenCalledWith("/repos/r1/pulls/482");
  });

  it("does NOT navigate when a finding inside the hover popup is clicked", () => {
    renderRow();
    fireEvent.mouseEnter(findingsTrigger());
    act(() => {
      vi.advanceTimersByTime(150);
    });

    fireEvent.click(screen.getByText("Hardcoded secret committed"));
    expect(push).not.toHaveBeenCalled();
  });

  it("still navigates when the findings badges themselves are clicked", () => {
    // The trigger deliberately does not stop propagation — every other cell in
    // the row navigates, so this one should behave the same.
    renderRow();
    fireEvent.click(findingsTrigger());
    expect(push).toHaveBeenCalledWith("/repos/r1/pulls/482");
  });

  it("renders exactly one cell per declared column", () => {
    // The PRRow leg of the GRID / COLUMN_KEYS / cells lockstep.
    const { container } = renderRow();
    expect(container.firstElementChild!.children).toHaveLength(COLUMN_KEYS.length);
  });

  it("renders a dash in both SCORE and FINDINGS for an unreviewed PR", () => {
    renderRow(
      pr({ score: null, critical_count: null, warning_count: null, suggestion_count: null, findings: null }),
    );
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
