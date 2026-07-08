/**
 * ReviewFocusCard tests — design conformance:
 * items render in ascending priority order regardless of input array order,
 * clickable path element when the file is changed (internal diff nav) or a
 * github_link is present (external), plain path span only when neither
 * applies, count badge shows the item count, empty state shown when items is [].
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReviewFocusItem } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";

const navigateMock = vi.fn();
vi.mock("@/lib/diff-nav", () => ({
  useDiffNavigate: () => navigateMock,
}));

import { ReviewFocusCard } from "./ReviewFocusCard";

afterEach(() => {
  cleanup();
  navigateMock.mockClear();
});

const ITEMS: ReviewFocusItem[] = [
  {
    path: "src/modules/reviews/brief-generator.ts",
    line: 42,
    reason: "Core orchestration logic for the one LLM call",
    priority: 2,
    github_link: "https://github.com/acme/devdigest/blob/abc123/src/modules/reviews/brief-generator.ts#L42",
  },
  {
    path: "src/modules/reviews/routes.ts",
    line: 10,
    reason: "New rate-limited POST route",
    priority: 1,
    github_link: "https://github.com/acme/devdigest/blob/abc123/src/modules/reviews/routes.ts#L10",
  },
  {
    path: "src/modules/reviews/repository/pull.repo.ts",
    line: null,
    reason: "Dropped reference — file no longer matches known facts",
    priority: 3,
    github_link: null,
  },
];

function renderCard(items: ReviewFocusItem[], changedPaths?: Set<string>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      <ReviewFocusCard items={items} changedPaths={changedPaths} />
    </NextIntlClientProvider>,
  );
}

describe("ReviewFocusCard", () => {
  it("renders items in ascending priority order regardless of input array order", () => {
    renderCard(ITEMS);
    const reasons = screen
      .getAllByText(/New rate-limited POST route|orchestration logic|Dropped reference/)
      .map((el) => el.textContent);
    expect(reasons).toEqual([
      "New rate-limited POST route",
      "Core orchestration logic for the one LLM call",
      "Dropped reference — file no longer matches known facts",
    ]);
  });

  it("renders a plain (non-link) path span only when the file is neither changed nor has a github_link", () => {
    renderCard(ITEMS);
    const plainPath = screen.getByText("src/modules/reviews/repository/pull.repo.ts");
    expect(plainPath.tagName).toBe("SPAN");
  });

  it("a changed-file item is clickable and calls diff-nav with isChanged=true", () => {
    renderCard(ITEMS, new Set(["src/modules/reviews/routes.ts"]));
    const btn = screen.getByText("src/modules/reviews/routes.ts:10");
    expect(btn.tagName).toBe("BUTTON");
    fireEvent.click(btn);
    expect(navigateMock).toHaveBeenCalledWith(
      "src/modules/reviews/routes.ts",
      10,
      "https://github.com/acme/devdigest/blob/abc123/src/modules/reviews/routes.ts#L10",
      true,
    );
  });

  it("a non-changed item with a github_link is still clickable and calls diff-nav with isChanged=false", () => {
    renderCard(ITEMS);
    const btn = screen.getByText("src/modules/reviews/brief-generator.ts:42");
    expect(btn.tagName).toBe("BUTTON");
    fireEvent.click(btn);
    expect(navigateMock).toHaveBeenCalledWith(
      "src/modules/reviews/brief-generator.ts",
      42,
      "https://github.com/acme/devdigest/blob/abc123/src/modules/reviews/brief-generator.ts#L42",
      false,
    );
  });

  it("renders the count badge with the correct count", () => {
    renderCard(ITEMS);
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("renders the empty state when items is []", () => {
    renderCard([]);
    expect(screen.getByText("No review-focus items.")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });
});
