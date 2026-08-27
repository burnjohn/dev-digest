/**
 * RiskAreas — SPEC-02 (`server/specs/SPEC-02-pr-risk-brief.md`), the half of
 * the brief that renders INSIDE IntentCard's card (AC-26, reworked 2026-08-26).
 *
 * These cases moved here verbatim from `PrBriefCard.test.tsx` when the card
 * was split; the disclosure behaviour they pin (REQ-28/REQ-34) did not change.
 *
 * Per client INSIGHTS (2026-08-09 seed) the mock point is the hook boundary,
 * not global fetch. No `@testing-library/user-event` dependency exists in this
 * package (every sibling card test uses `fireEvent`), so keyboard operability
 * (REQ-34) is asserted structurally — the trigger is a real `<button>` with
 * `aria-expanded`/`aria-controls`, which is what makes Enter/Space activation
 * a browser default rather than app code this suite would need to fake through
 * jsdom's synthetic `keyDown`.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RiskBriefResponse } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/riskBrief.json";

const usePrBriefSpy = vi.fn();
const refetch = vi.fn();

vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: (prId: string | null) => usePrBriefSpy(prId),
  useRecalculateBrief: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { RiskAreas } from "./RiskAreas";

afterEach(() => {
  cleanup();
  usePrBriefSpy.mockReset();
  refetch.mockClear();
});

function renderSection(
  prId: string | null = "pr-1",
  link: { repoFullName?: string | null; headSha?: string | null } = {
    repoFullName: "owner/name",
    headSha: "abc123",
  },
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ riskBrief: messages }}>
      <RiskAreas prId={prId} repoFullName={link.repoFullName} headSha={link.headSha} />
    </NextIntlClientProvider>,
  );
}

const BASE_SOURCES: RiskBriefResponse["sources"] = {
  intent: "used",
  blast: "used",
  pr_body: "used",
  linked_issue: "missing",
  file_list: "used",
  md_files: [],
};

// Named individually (rather than indexed off `BRIEF.risks[n]`) so every
// assertion below stays a plain `RiskBriefArea`, not a
// `RiskBriefArea | undefined` under `noUncheckedIndexedAccess`.
const RISK_1: RiskBriefResponse["risks"][number] = {
  title: "Unpinned dependency",
  explanation: "ioredis is added with no pinned version, which can silently break the limiter on a minor bump.",
  severity: "high",
  file: "package.json",
  endpoint: null,
};
const RISK_2: RiskBriefResponse["risks"][number] = {
  title: "New public endpoint",
  explanation: "The new route has no auth guard applied yet.",
  severity: "medium",
  file: "src/api/public/items.ts",
  endpoint: "GET /api/public/items",
};

const BRIEF: RiskBriefResponse = {
  pr_id: "pr-1",
  what: "Adds rate limiting to the public API.",
  why: "Prevents abuse of the /items endpoint under sustained load.",
  risk_level: "high",
  risks: [RISK_1, RISK_2],
  review_focus: [],
  sources: BASE_SOURCES,
  model: "openai/gpt-4.1",
  generated_at: "2026-08-26T10:00:00.000Z",
};

describe("RiskAreas — placement contract", () => {
  it("renders no card box of its own: it sits inside IntentCard's card", () => {
    usePrBriefSpy.mockReturnValue({ data: BRIEF, isLoading: false, isError: false, refetch });
    const { container } = renderSection();
    // Its own header would be a duplicate — IntentCard already carries the
    // SectionLabel, and a second bordered box inside that card is exactly the
    // "one card border too many" the 2026-08-26 rework removed.
    expect(screen.queryByText("PR Brief")).not.toBeInTheDocument();
    expect(screen.getByText("Risk areas")).toBeInTheDocument();
    // Inline style, not `getComputedStyle`: jsdom resolves an unset
    // `background` to `rgba(0, 0, 0, 0)`, so only the inline value tells the
    // two apart — and the inline value is exactly what `styles.ts` sets.
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.border).toBe("");
    expect(root.style.background).toBe("");
    expect(root.style.padding).toBe("");
  });

  it("renders nothing without a prId", () => {
    usePrBriefSpy.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch });
    const { container } = renderSection(null);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("RiskAreas — loading and error states", () => {
  it("keeps the label through both, and offers a working retry on error", () => {
    usePrBriefSpy.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch });
    const { unmount } = renderSection();
    expect(screen.getByText("Risk areas")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();

    usePrBriefSpy.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderSection();
    expect(screen.getByText("Risk areas")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("RiskAreas — the rows (REQ-35, REQ-13)", () => {
  it("shows every risk with its full path in `title` and no line info", () => {
    usePrBriefSpy.mockReturnValue({ data: BRIEF, isLoading: false, isError: false, refetch });
    renderSection();

    expect(screen.getByText(RISK_1.title)).toBeInTheDocument();
    expect(screen.getByText(RISK_2.title)).toBeInTheDocument();

    // REQ-35: full path in `title`, and it is the visible text too.
    const pathEl = screen.getByTitle("package.json");
    expect(pathEl).toHaveTextContent("package.json");

    // REQ-35 left-truncation: `direction: rtl` + `textAlign: left` moves the
    // ellipsis to the START of the string (so the filename, at the END of
    // the path, stays visible) — jsdom reflects inline styles through
    // `getComputedStyle` even though it performs no layout
    // (client/INSIGHTS.md 2026-08-26). Asserted here, not just via `styles.ts`,
    // because `styles.ts` describes the constant, not what the element got.
    const pathStyle = getComputedStyle(pathEl);
    expect(pathStyle.direction).toBe("rtl");
    expect(pathStyle.textAlign).toBe("left");
    expect(pathStyle.overflow).toBe("hidden");
    expect(pathStyle.textOverflow).toBe("ellipsis");
    // `minWidth: 0` is the load-bearing property here: without it this flex
    // child never shrinks below its content size and the ellipsis silently
    // never triggers (client/INSIGHTS.md 2026-08-26) — dropping it is the
    // mutation this assertion exists to catch.
    expect(Number.parseFloat(pathStyle.minWidth)).toBe(0);

    // REQ-13: no line number, range, or `#L` fragment anywhere.
    expect(document.body.textContent).not.toMatch(/#L\d/);
    expect(document.body.textContent).not.toMatch(/:\d+(-\d+)?\b/);
  });
});

describe("RiskAreas — the file link (REQ-13, REQ-35)", () => {
  it("links each path to the file at the head sha, with no line fragment", () => {
    usePrBriefSpy.mockReturnValue({ data: BRIEF, isLoading: false, isError: false, refetch });
    renderSection();

    const link = screen.getByRole("link", { name: RISK_1.file });
    expect(link).toHaveAttribute("href", "https://github.com/owner/name/blob/abc123/package.json");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    document.querySelectorAll("a[href]").forEach((a) => {
      expect(a.getAttribute("href")).not.toMatch(/#L/);
    });
  });

  it("keeps the link OUT of the disclosure button", () => {
    // An `<a>` inside a `<button>` is nested interactive content: the parser
    // breaks it apart and the link drops out of the tab order
    // (client/INSIGHTS.md 2026-08-16). This is the mutation that would undo
    // the whole restructure.
    usePrBriefSpy.mockReturnValue({ data: BRIEF, isLoading: false, isError: false, refetch });
    renderSection();

    const trigger = screen.getByRole("button", { name: /Unpinned dependency/ });
    expect(trigger.querySelector("a")).toBeNull();
    expect(screen.getByRole("link", { name: RISK_1.file })).toBeInTheDocument();
  });

  it("degrades to plain text when the repo full name or head sha is missing", () => {
    usePrBriefSpy.mockReturnValue({ data: BRIEF, isLoading: false, isError: false, refetch });

    const { unmount } = renderSection("pr-1", { repoFullName: null, headSha: "abc123" });
    expect(screen.queryByRole("link")).toBeNull();
    // Still readable, still truncatable, just not clickable.
    expect(screen.getByTitle(RISK_1.file)).toHaveTextContent(RISK_1.file);
    unmount();

    renderSection("pr-1", { repoFullName: "owner/name", headSha: null });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTitle(RISK_1.file)).toHaveTextContent(RISK_1.file);
  });
});

describe("RiskAreas — disclosure (REQ-28, REQ-34)", () => {
  it("collapses to title/severity/file, reveals only the activated row's explanation, and closes it again on activation", () => {
    usePrBriefSpy.mockReturnValue({ data: BRIEF, isLoading: false, isError: false, refetch });
    renderSection();

    // Collapsed: no explanation text anywhere yet.
    expect(screen.queryByText(RISK_1.explanation)).not.toBeInTheDocument();
    expect(screen.queryByText(RISK_2.explanation)).not.toBeInTheDocument();

    const trigger1 = screen.getByRole("button", { name: /Unpinned dependency/ });
    const trigger2 = screen.getByRole("button", { name: /New public endpoint/ });
    expect(trigger1).toHaveAttribute("aria-expanded", "false");
    expect(trigger1).toHaveAttribute("aria-controls");

    fireEvent.click(trigger1);
    expect(trigger1).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(RISK_1.explanation)).toBeInTheDocument();
    const regionId = trigger1.getAttribute("aria-controls")!;
    expect(document.getElementById(regionId)).toHaveTextContent(RISK_1.explanation);

    // Opening row 2 hides row 1's explanation — single open at a time.
    fireEvent.click(trigger2);
    expect(trigger1).toHaveAttribute("aria-expanded", "false");
    expect(trigger2).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText(RISK_1.explanation)).not.toBeInTheDocument();
    expect(screen.getByText(RISK_2.explanation)).toBeInTheDocument();

    // Activating the open row again closes it.
    fireEvent.click(trigger2);
    expect(trigger2).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(RISK_2.explanation)).not.toBeInTheDocument();
  });
});

describe("RiskAreas — empty risks (REQ-30)", () => {
  it("renders the named empty state in place of the list", () => {
    usePrBriefSpy.mockReturnValue({
      data: { ...BRIEF, risks: [] },
      isLoading: false,
      isError: false,
      refetch,
    });
    renderSection();
    expect(screen.getByText("No risk areas identified")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Risk areas" })).not.toBeInTheDocument();
  });
});
