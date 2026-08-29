/* page.test.tsx — T9: the `order`/`finding` URL wiring, the REQ-26 loop guard,
   and the onRunDone Smart Diff invalidation (docs/plans/04-smart-diff.md §T9).
   DiffTab and FindingsTab are mocked at the component boundary (client
   INSIGHTS.md 2026-08-09 seed: mock the hook/component boundary, never
   global fetch) — T7/T8 already prove those components' own behaviour; this
   file proves page.tsx's thin wiring around them. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrDetail } from "@devdigest/shared";

let currentSearch = "tab=diff";
const routerReplace = vi.fn();
const invalidateQueries = vi.fn();
const refetchReviews = vi.fn();
const refetchPr = vi.fn();

let capturedDiffTabProps: any = null;
let capturedFindingsTabProps: any = null;
let scrollMemoryTab: string | null = null;

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1", number: "42" }),
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

// FIX-4: keep the real `QueryClient`/`QueryClientProvider` exports (via
// `importOriginal`) alongside the stubbed `useQueryClient` — FindingsTab is
// mocked below so nothing here actually calls a real query hook, but every
// render still needs a genuine QueryClientProvider ancestor, matching how
// the app mounts this page (`lib/providers.tsx`), not the bespoke wrapper
// this file used to get away with omitting entirely.
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries }),
  };
});

vi.mock("../../../../../lib/hooks", () => ({
  usePulls: () => ({ data: [{ id: "pr-1", number: 42 }], isLoading: false }),
  usePullDetail: () => ({
    data: prFixture,
    isLoading: false,
    isError: false,
    error: null,
    refetch: refetchPr,
  }),
}));

// REQ-35: controllable per-test so wiring can be proven for both the
// not-yet-loaded and the loaded case. `vi.hoisted` because `vi.mock` factories
// are hoisted above ordinary module-scope declarations.
const reviewsState = vi.hoisted(() => ({ isSuccess: true }));

vi.mock("../../../../../lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: [], isSuccess: reviewsState.isSuccess, refetch: refetchReviews }),
  useCancelRun: () => ({ mutate: vi.fn(), isPending: false }),
  usePrActiveRuns: () => ({ data: [] }),
  usePrRuns: () => ({ data: [] }),
  useDeleteRun: () => ({ mutate: vi.fn() }),
}));

vi.mock("../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r1", full_name: "acme/repo" } }),
  useRepoNotFound: () => false,
}));

vi.mock("../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./_components/PrDetailHeader", () => ({
  PrDetailHeader: () => <div>header</div>,
}));

vi.mock("./_components/OverviewTab", () => ({
  OverviewTab: () => <div>overview</div>,
}));

vi.mock("./_components/RunTraceDrawer", () => ({
  default: () => <div>trace-drawer</div>,
}));

vi.mock("./_components/DiffTab", () => ({
  DiffTab: (props: any) => {
    capturedDiffTabProps = props;
    return (
      <div>
        <button onClick={() => props.onOrderChange?.("smart")}>toggle-smart</button>
        <button onClick={() => props.onOrderChange?.(null)}>toggle-original</button>
        <button onClick={() => props.onOpenFinding?.("f1")}>open-finding</button>
      </div>
    );
  },
}));

vi.mock("./_components/FindingsTab", () => ({
  FindingsTab: (props: any) => {
    capturedFindingsTabProps = props;
    return (
      <div>
        <button onClick={() => props.onRunDone?.()}>run-done</button>
        <button onClick={() => props.onTargetResolved?.(null)}>resolve-null</button>
        <button onClick={() => props.onTargetResolved?.("newer-id")}>resolve-newer</button>
        <button onClick={() => props.onTargetResolved?.(props.targetFindingId)}>resolve-same</button>
      </div>
    );
  },
}));

vi.mock("./_lib/use-tab-scroll-memory", () => ({
  useTabScrollMemory: (tab: string) => {
    scrollMemoryTab = tab;
    return { current: null };
  },
}));

import PRDetailPage from "./page";

const prFixture: PrDetail = {
  id: "pr-1",
  number: 42,
  title: "Add rate limiting",
  author: "marisa",
  branch: "feat/rate-limit",
  base: "main",
  head_sha: "abc123",
  additions: 247,
  deletions: 38,
  files_count: 9,
  status: "open",
  body: "Adds rate limiting.",
  files: [],
  commits: [],
  diff_source: "github",
  diff_source_reason: null,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PRDetailPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  currentSearch = "tab=diff";
  routerReplace.mockClear();
  invalidateQueries.mockClear();
  refetchReviews.mockClear();
  refetchPr.mockClear();
  capturedDiffTabProps = null;
  capturedFindingsTabProps = null;
  scrollMemoryTab = null;
  reviewsState.isSuccess = true;
});

describe("PRDetailPage — T9 wiring", () => {
  it("REQ-13: no `order` param renders original order; `order=smart` renders Smart Diff; toggling writes/clears the param", () => {
    renderPage();
    expect(capturedDiffTabProps.order).toBeNull();

    fireEvent.click(screen.getByText("toggle-smart"));
    expect(routerReplace).toHaveBeenCalledTimes(1);
    const [url, opts] = routerReplace.mock.calls[0]!;
    expect(url).toContain("order=smart");
    expect(opts).toEqual({ scroll: false });

    routerReplace.mockClear();
    fireEvent.click(screen.getByText("toggle-original"));
    const [url2] = routerReplace.mock.calls[0]!;
    expect(url2).not.toContain("order=");

    cleanup();
    currentSearch = "tab=diff&order=smart";
    renderPage();
    expect(capturedDiffTabProps.order).toBe("smart");
  });

  it("REQ-17: a chip click is a SINGLE router.replace carrying both tab=findings and finding=<id>", () => {
    renderPage();
    fireEvent.click(screen.getByText("open-finding"));

    expect(routerReplace).toHaveBeenCalledTimes(1);
    const [url, opts] = routerReplace.mock.calls[0]!;
    expect(url).toContain("tab=findings");
    expect(url).toContain("finding=f1");
    expect(opts).toEqual({ scroll: false });
  });

  it("REQ-18: `?finding=<id>` reaches FindingsTab as targetFindingId", () => {
    currentSearch = "tab=findings&finding=abc-id";
    renderPage();
    expect(capturedFindingsTabProps.targetFindingId).toBe("abc-id");
  });

  it("REQ-26: onTargetResolved with a DIFFERENT id rewrites the finding param; the SAME id performs NO navigation (loop guard)", () => {
    currentSearch = "tab=findings&finding=older-id";
    renderPage();

    fireEvent.click(screen.getByText("resolve-newer"));
    expect(routerReplace).toHaveBeenCalledTimes(1);
    expect(routerReplace.mock.calls[0]![0]).toContain("finding=newer-id");

    routerReplace.mockClear();
    fireEvent.click(screen.getByText("resolve-same"));
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("REQ-19: onTargetResolved(null) clears only the `finding` param — tab/trace/order untouched", () => {
    currentSearch = "tab=findings&order=smart&trace=run-1&finding=stale-id";
    renderPage();

    fireEvent.click(screen.getByText("resolve-null"));
    expect(routerReplace).toHaveBeenCalledTimes(1);
    const [url] = routerReplace.mock.calls[0]!;
    expect(url).not.toContain("finding=");
    expect(url).toContain("tab=findings");
    expect(url).toContain("order=smart");
    expect(url).toContain("trace=run-1");
  });

  it("REQ-21/REQ-25: onRunDone invalidates smart-diff alongside pr-active-runs and pr-runs, and refetches reviews", () => {
    currentSearch = "tab=findings";
    renderPage();

    fireEvent.click(screen.getByText("run-done"));

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pr-active-runs", "pr-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["pr-runs", "pr-1"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["smart-diff", "pr-1"] });
    expect(refetchReviews).toHaveBeenCalledTimes(1);
  });

  it("REQ-24: T5's useTabScrollMemory is still wired to the active tab", () => {
    currentSearch = "tab=diff";
    renderPage();
    expect(scrollMemoryTab).toBe("diff");
  });

  it("REQ-35: FindingsTab's runsLoaded prop reflects usePrReviews' isSuccess — a `?finding=` pasted into a cold cache is NOT handed a false-empty `runs` while the reviews query is still loading (or retrying)", () => {
    currentSearch = "tab=findings&finding=abc-id";

    reviewsState.isSuccess = false;
    renderPage();
    expect(capturedFindingsTabProps.runsLoaded).toBe(false);

    cleanup();
    reviewsState.isSuccess = true;
    renderPage();
    expect(capturedFindingsTabProps.runsLoaded).toBe(true);
  });
});
