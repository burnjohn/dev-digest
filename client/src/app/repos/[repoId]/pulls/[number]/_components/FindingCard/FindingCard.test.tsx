import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard highlighted (REQ-18 deep-link landing)", () => {
  // jsdom has no scrollIntoView — the component guards the call itself, but
  // stub it too so a regression that drops the guard fails loudly here
  // instead of crashing every consumer's test suite.
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;
  beforeAll(() => {
    scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
  });

  // Same stub, cleared between tests so call counts don't leak across cases.
  afterEach(() => {
    scrollIntoViewMock.mockClear();
  });

  it("scrolls its data-finding-id card into view when it becomes the highlight target (REQ-18)", () => {
    renderWithIntl(
      <FindingCard f={FINDING} onAction={() => {}} highlighted highlightNonce={1} />,
    );
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("does not scroll a card that renders normally, not as the highlight target", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("expands on mount when highlighted, then clears the highlight after ~2s without unmounting", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderWithIntl(
        <FindingCard f={FINDING} onAction={() => {}} highlighted highlightNonce={1} />,
      );
      // Collapsed by default (`defaultExpanded` unset) — `highlighted` forces it open.
      // The Accept/Dismiss actions only render once the body is expanded.
      expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
      const card = container.querySelector('[data-finding-id="f1"]');
      expect(card).toHaveAttribute("data-highlighted", "true");

      act(() => {
        vi.advanceTimersByTime(2100);
      });

      expect(card).not.toHaveAttribute("data-highlighted");
      // The card itself is never removed — only the highlight clears.
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("REQ-34 — scrolls only once the expanded body has actually rendered, not against the collapsed height", () => {
    // Starts COLLAPSED (`defaultExpanded` unset) and highlighted — the old
    // single-effect code called scrollIntoView in the SAME effect body as
    // `setExpanded(true)`, before the expanded body (Accept/Dismiss) had
    // committed to the DOM. A test that would pass under that ordering must
    // fail here: assert what was actually in the DOM at call-time.
    let sawExpandedContentAtCallTime = false;
    scrollIntoViewMock.mockImplementationOnce(function (this: HTMLElement) {
      sawExpandedContentAtCallTime = screen.queryByRole("button", { name: "Accept" }) !== null;
    });

    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} highlighted highlightNonce={1} />);

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(sawExpandedContentAtCallTime).toBe(true);
  });

  it("REQ-34 — repeat clicks on the same chip (highlightNonce bumps) re-scroll exactly once each", () => {
    const { rerender } = renderWithIntl(
      <FindingCard f={FINDING} onAction={() => {}} highlighted highlightNonce={1} />,
    );
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    // Same target, same nonce, another render (e.g. an unrelated parent
    // re-render) — must NOT re-scroll.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingCard f={FINDING} onAction={() => {}} highlighted highlightNonce={1} />
      </NextIntlClientProvider>,
    );
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    // The nonce bumps (repeat click on the same chip) — re-scrolls, exactly once.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingCard f={FINDING} onAction={() => {}} highlighted highlightNonce={2} />
      </NextIntlClientProvider>,
    );
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
  });
});
