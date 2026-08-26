/**
 * ReviewFocusCard — full-width `review_focus[]` band (docs/plans/08-pr-risk-brief.md T8).
 *
 * Per client INSIGHTS (2026-08-09 seed) the mock point is the hook boundary,
 * not global fetch — `usePrBrief` is mocked, matching BlastCard.test.tsx.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RiskBriefResponse } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import messages from "../../../../../../../../messages/en/riskBrief.json";

const usePrBriefSpy = vi.fn();
const refetch = vi.fn();

vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: (prId: string | null) => usePrBriefSpy(prId),
}));

import { ReviewFocusCard } from "./ReviewFocusCard";

afterEach(() => {
  cleanup();
  usePrBriefSpy.mockReset();
  refetch.mockClear();
});

const REPO_FULL_NAME = "acme/payments-api";
const HEAD_SHA = "abc123";

const SOURCES: RiskBriefResponse["sources"] = {
  intent: "used",
  blast: "used",
  pr_body: "used",
  linked_issue: "missing",
  file_list: "used",
  md_files: [],
};

function brief(review_focus: RiskBriefResponse["review_focus"]): RiskBriefResponse {
  return {
    pr_id: "pr-1",
    what: "Adds rate limiting to the public API.",
    why: "Prevent abuse of unauthenticated endpoints.",
    risk_level: "medium",
    risks: [],
    review_focus,
    sources: SOURCES,
    model: "gpt-test",
    generated_at: "2026-08-26T00:00:00.000Z",
  };
}

function renderCard(
  props: Partial<{ repoFullName: string | null; headSha: string | null }> = {},
  prId: string | null = "pr-1",
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ riskBrief: messages }}>
      <ReviewFocusCard
        prId={prId}
        repoFullName={"repoFullName" in props ? props.repoFullName : REPO_FULL_NAME}
        headSha={"headSha" in props ? props.headSha : HEAD_SHA}
      />
    </NextIntlClientProvider>,
  );
}

describe("ReviewFocusCard — loading and error states", () => {
  it("shows a loading placeholder ending in an ellipsis, then an error state with a working retry", () => {
    usePrBriefSpy.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch });
    const { unmount } = renderCard();
    expect(screen.getByText("Review focus — read these first")).toBeInTheDocument();
    expect(screen.getByText("Generating risk brief…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();

    usePrBriefSpy.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderCard();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("ReviewFocusCard — REQ-27/REQ-15/REQ-13/REQ-35: linked rows in payload order", () => {
  it("renders each entry as a link with an exact no-fragment href, the reason, first-entry-first, and the full path in `title`", () => {
    usePrBriefSpy.mockReturnValue({
      data: brief([
        { file: "src/api/public/index.ts", reason: "New unauthenticated route." },
        { file: "src/lib/rate-limit.ts", reason: "Core limiter logic changed." },
      ]),
      isLoading: false,
      isError: false,
      refetch,
    });
    renderCard();

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);

    // REQ-15: payload order preserved, first entry first in the DOM.
    expect(links[0]).toHaveAttribute("title", "src/api/public/index.ts");
    expect(links[1]).toHaveAttribute("title", "src/lib/rate-limit.ts");

    // REQ-27: exact href shape, no line fragment.
    expect(links[0]).toHaveAttribute(
      "href",
      githubBlobUrl(REPO_FULL_NAME, HEAD_SHA, "src/api/public/index.ts"),
    );
    expect(links[1]).toHaveAttribute(
      "href",
      githubBlobUrl(REPO_FULL_NAME, HEAD_SHA, "src/lib/rate-limit.ts"),
    );

    // REQ-13: no `#L` anywhere.
    for (const link of links) {
      expect(link.getAttribute("href")).not.toMatch(/#L/);
    }

    // REQ-35 left-truncation: `direction: rtl` + `textAlign: left` moves the
    // ellipsis to the START of the string (so the filename, at the END of
    // the path, stays visible) — jsdom reflects inline styles through
    // `getComputedStyle` even though it performs no layout
    // (client/INSIGHTS.md 2026-08-26). Asserted on the rendered element, not
    // by importing `s` from `styles.ts`, which would test the constant only.
    const fileLinkStyle = getComputedStyle(links[0]!);
    expect(fileLinkStyle.direction).toBe("rtl");
    expect(fileLinkStyle.textAlign).toBe("left");
    expect(fileLinkStyle.overflow).toBe("hidden");
    expect(fileLinkStyle.textOverflow).toBe("ellipsis");
    // `minWidth: 0` is the load-bearing property here: without it this flex
    // child never shrinks below its content size and the ellipsis silently
    // never triggers (client/INSIGHTS.md 2026-08-26) — dropping it is the
    // mutation this assertion exists to catch.
    expect(Number.parseFloat(fileLinkStyle.minWidth)).toBe(0);

    expect(screen.getByText("New unauthenticated route.")).toBeInTheDocument();
    expect(screen.getByText("Core limiter logic changed.")).toBeInTheDocument();

    // Entry-count badge on the SectionLabel header.
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("ReviewFocusCard — REQ-27 degradation: missing repoFullName or headSha", () => {
  it("renders plain text with no github.com href and no inert button when repoFullName is absent", () => {
    usePrBriefSpy.mockReturnValue({
      data: brief([{ file: "src/api/public/index.ts", reason: "New unauthenticated route." }]),
      isLoading: false,
      isError: false,
      refetch,
    });
    renderCard({ repoFullName: null });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.querySelector('a[href*="github.com"]')).toBeNull();
    expect(screen.getByText("src/api/public/index.ts")).toBeInTheDocument();
    expect(screen.getByText("New unauthenticated route.")).toBeInTheDocument();
  });

  it("renders plain text with no github.com href and no inert button when headSha is absent", () => {
    usePrBriefSpy.mockReturnValue({
      data: brief([{ file: "src/api/public/index.ts", reason: "New unauthenticated route." }]),
      isLoading: false,
      isError: false,
      refetch,
    });
    renderCard({ headSha: null });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.querySelector('a[href*="github.com"]')).toBeNull();
    expect(screen.getByText("src/api/public/index.ts")).toBeInTheDocument();
  });
});

describe("ReviewFocusCard — REQ-31 empty state / REQ-46 no forbidden metrics", () => {
  it("renders a named empty state for an empty review_focus[], not a bare bordered band", () => {
    usePrBriefSpy.mockReturnValue({
      data: brief([]),
      isLoading: false,
      isError: false,
      refetch,
    });
    renderCard();

    expect(screen.getByText("Review focus — read these first")).toBeInTheDocument();
    expect(screen.getByText("Nothing flagged for review focus.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders no score, verdict, findings count, cost, token figure or line number", () => {
    usePrBriefSpy.mockReturnValue({
      data: brief([{ file: "src/api/public/index.ts", reason: "New unauthenticated route." }]),
      isLoading: false,
      isError: false,
      refetch,
    });
    const { container } = renderCard();

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/\btoken/i);
    expect(text).not.toMatch(/\bverdict\b/i);
    expect(text).not.toMatch(/#L\d/);
  });
});
