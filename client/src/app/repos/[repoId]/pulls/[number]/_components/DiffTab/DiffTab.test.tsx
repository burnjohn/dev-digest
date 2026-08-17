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
import { DiffTab } from "./DiffTab";

// Mock the hook boundary, not global fetch (see client/INSIGHTS.md).
vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

afterEach(cleanup);

const FILE = {
  path: "src/a.ts",
  additions: 1,
  deletions: 0,
  patch: "@@ -1 +1,2 @@\n+const a = 1;",
};

function renderTab(props: Partial<React.ComponentProps<typeof DiffTab>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
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
