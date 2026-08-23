/**
 * The detail endpoint degrades to the local cache and still answers 200, so
 * `files: []` alone cannot tell the user whether the PR changed nothing or
 * whether GitHub was unreachable. `diffSource` is what makes those distinct —
 * these assert the three degraded states each say something different, and that
 * a healthy PR stays completely quiet.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/shell.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import type { SmartDiff } from "@devdigest/shared";
import { DiffTab } from "./DiffTab";

// Mock the hook boundary, not global fetch (see client/INSIGHTS.md).
const useSmartDiffSpy = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSmartDiff: (prId: string | null) => useSmartDiffSpy(prId),
}));

afterEach(() => {
  cleanup();
  useSmartDiffSpy.mockReset();
  useSmartDiffSpy.mockReturnValue({ data: undefined });
});
useSmartDiffSpy.mockReturnValue({ data: undefined });

const FILE = {
  path: "src/a.ts",
  additions: 1,
  deletions: 0,
  patch: "@@ -1 +1,2 @@\n+const a = 1;",
};

function renderTab(props: Partial<React.ComponentProps<typeof DiffTab>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages, prReview: prReviewMessages }}>
      <DiffTab prId="pr-1" filesCount={1} files={[FILE]} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("DiffTab degraded-source notice", () => {
  it("says nothing when the diff came live from GitHub", () => {
    renderTab({ diffSource: "github" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says nothing for a legacy payload with no diff_source at all", () => {
    renderTab();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("flags a cached diff as stale rather than presenting it as current", () => {
    renderTab({ diffSource: "cache", diffReason: "unavailable" });
    expect(screen.getByRole("status")).toHaveTextContent(/last cached diff/i);
    // The cached diff itself still renders — stale beats nothing.
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
  });

  it("points at the token, not at GitHub, when the failure was auth", () => {
    renderTab({ diffSource: "unavailable", diffReason: "auth", files: [], filesCount: 4 });
    expect(screen.getByRole("status")).toHaveTextContent(/rejected the request/i);
  });

  it("distinguishes an unreachable GitHub from a PR with no changes", () => {
    renderTab({ diffSource: "unavailable", diffReason: "unavailable", files: [], filesCount: 4 });
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't reach github/i);
  });

  it("drops the file count when there is nothing to count it against", () => {
    // filesCount is GitHub's real changed_files; printing "4 files" above zero
    // rendered cards reads as data loss.
    renderTab({ diffSource: "unavailable", diffReason: "unavailable", files: [], filesCount: 4 });
    expect(screen.getByText("Files changed")).toBeInTheDocument();
    expect(screen.queryByText(/4 files/)).not.toBeInTheDocument();
  });

  it("keeps the count when a cached diff is being shown", () => {
    renderTab({ diffSource: "cache", diffReason: "unavailable", filesCount: 1 });
    expect(screen.getByText(/Files changed · 1 files/)).toBeInTheDocument();
  });

  it("offers a retry so a recovered GitHub does not need a page reload", () => {
    const onRetry = vi.fn();
    renderTab({ diffSource: "unavailable", diffReason: "unavailable", files: [], onRetry });

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

/** Minimal, valid SmartDiff fixture — one file in `core`, nothing else. */
const SMART_DIFF_FIXTURE: SmartDiff = {
  groups: [
    {
      role: "core",
      file_count: 1,
      files: [
        {
          path: "src/a.ts",
          pseudocode_summary: null,
          additions: 1,
          deletions: 0,
          changed_lines: 1,
          large: false,
          has_patch: true,
          default_open: false,
          findings: [],
          finding_lines: [],
        },
      ],
    },
    { role: "wiring", file_count: 0, files: [] },
    { role: "boilerplate", file_count: 0, files: [] },
  ],
  total_files: 1,
  total_lines: 1,
  unmatched_finding_count: 0,
  split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
};

describe("DiffTab Smart Diff mode toggle (REQ-13)", () => {
  it("writes and clears the order via onOrderChange, and never fetches Smart Diff for the original view", () => {
    const onOrderChange = vi.fn();
    renderTab({ onOrderChange });

    // Original order is the default — no Smart Diff fetch, no group section.
    expect(useSmartDiffSpy).toHaveBeenCalledWith(null);
    expect(screen.queryByText(prReviewMessages.smartDiff.sectionLabel)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: prReviewMessages.smartDiff.orderSmart }));
    expect(onOrderChange).toHaveBeenCalledWith("smart");

    fireEvent.click(screen.getByRole("button", { name: prReviewMessages.smartDiff.orderOriginal }));
    expect(onOrderChange).toHaveBeenCalledWith(null);
  });

  it("order='smart' fetches and renders the Smart Diff groups instead of the plain diff", () => {
    useSmartDiffSpy.mockReturnValue({ data: SMART_DIFF_FIXTURE });
    renderTab({ order: "smart" });

    expect(useSmartDiffSpy).toHaveBeenCalledWith("pr-1");
    expect(screen.getByText(prReviewMessages.smartDiff.sectionLabel)).toBeInTheDocument();
    expect(screen.getByText(prReviewMessages.smartDiff.groupTitleCore)).toBeInTheDocument();
  });
});

/**
 * REQ-20: the changed-files header shows the touched-file count in BOTH
 * modes, and a degraded `diffSource` still renders the existing notice
 * (never an empty "no changed files" state) once Smart order is on. Both
 * elements sit structurally above the `order === "smart" ? … : …` branch in
 * DiffTab.tsx, so they must survive the mode switch — these mirror the
 * original-mode assertions above into `order="smart"`.
 */
describe("DiffTab structural elements survive Smart Diff mode (REQ-20)", () => {
  it("shows the touched-file count in smart mode too", () => {
    useSmartDiffSpy.mockReturnValue({ data: SMART_DIFF_FIXTURE });
    renderTab({ order: "smart", filesCount: 1 });

    expect(screen.getByText(/Files changed · 1 files/)).toBeInTheDocument();
  });

  it("flags a cached diff as stale in smart mode too", () => {
    useSmartDiffSpy.mockReturnValue({ data: SMART_DIFF_FIXTURE });
    renderTab({ order: "smart", diffSource: "cache", diffReason: "unavailable" });

    expect(screen.getByRole("status")).toHaveTextContent(/last cached diff/i);
  });

  it("flags an unreachable GitHub as stale in smart mode too", () => {
    useSmartDiffSpy.mockReturnValue({ data: SMART_DIFF_FIXTURE });
    renderTab({
      order: "smart",
      diffSource: "unavailable",
      diffReason: "unavailable",
      files: [],
      filesCount: 4,
    });

    expect(screen.getByRole("status")).toHaveTextContent(/couldn't reach github/i);
  });

  it("keeps the retry affordance next to the notice in smart mode", () => {
    useSmartDiffSpy.mockReturnValue({ data: SMART_DIFF_FIXTURE });
    const onRetry = vi.fn();
    renderTab({
      order: "smart",
      diffSource: "unavailable",
      diffReason: "unavailable",
      files: [],
      onRetry,
    });

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
