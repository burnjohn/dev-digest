/* reviews.test.tsx — the Smart Diff invalidation set (REQ-21, REQ-22, REQ-25).
   Mocks the `api` module (the hook boundary) with a real QueryClient, per
   client/INSIGHTS.md 2026-08-09 seed: tests never hit the network. */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SmartDiffResponse } from "@devdigest/shared";
import { api } from "../api";
import {
  useSmartDiff,
  useRunReview,
  useDeleteRun,
  useDeleteReview,
  useFindingAction,
} from "./reviews";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  },
  API_BASE: "http://localhost:3001",
}));

const getMock = api.get as unknown as Mock;
const postMock = api.post as unknown as Mock;
const delMock = api.del as unknown as Mock;

const PR_ID = "pr-1";

/** A minimal, contract-valid SmartDiff payload carrying one finding, so a
    test can tell "which response is currently rendered" by reading its id. */
function smartDiffFixture(findingId: string): SmartDiffResponse {
  return {
    groups: [
      {
        role: "core",
        file_count: 1,
        files: [
          {
            path: "src/index.ts",
            pseudocode_summary: null,
            additions: 3,
            deletions: 1,
            changed_lines: 4,
            large: false,
            has_patch: true,
            default_open: true,
            findings: [{ id: findingId, line: 10, severity: "CRITICAL" }],
            finding_lines: [10],
          },
        ],
      },
      { role: "wiring", file_count: 0, files: [] },
      { role: "boilerplate", file_count: 0, files: [] },
    ],
    total_files: 1,
    total_lines: 4,
    unmatched_finding_count: 0,
    split_suggestion: { too_big: false, total_lines: 4, proposed_splits: [] },
  };
}

let getCallCount = 0;

beforeEach(() => {
  getCallCount = 0;
  getMock.mockReset();
  postMock.mockReset();
  delMock.mockReset();
  // Each GET of the smart-diff route returns a fixture carrying a fresh
  // finding id, so a re-render proves a REFETCH happened, not a re-render of
  // stale cached data.
  getMock.mockImplementation(async (path: string) => {
    if (path === `/pulls/${PR_ID}/smart-diff`) {
      getCallCount += 1;
      return smartDiffFixture(`finding-${getCallCount}`);
    }
    throw new Error(`unexpected GET ${path}`);
  });
  postMock.mockResolvedValue({});
  delMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
});

/** Mounts every mutation this task owns alongside `useSmartDiff`, so firing
    one and reading the rendered finding id proves (or disproves) that it
    invalidates `["smart-diff", prId]`. */
function Harness({ prId }: { prId: string }) {
  const smartDiff = useSmartDiff(prId);
  const runReview = useRunReview();
  const deleteRun = useDeleteRun(prId);
  const deleteReview = useDeleteReview(prId);
  const findingAction = useFindingAction();

  const findingId = smartDiff.data?.groups[0]?.files[0]?.findings[0]?.id ?? "none";

  return (
    <div>
      <div data-testid="finding-id">{findingId}</div>
      <button onClick={() => runReview.mutate({ prId, all: true })}>run-review</button>
      <button onClick={() => deleteRun.mutate("run-1")}>delete-run</button>
      <button onClick={() => deleteReview.mutate("review-1")}>delete-review</button>
      <button onClick={() => findingAction.mutate({ findingId: "f-1", action: "dismiss", prId })}>
        dismiss
      </button>
      <button onClick={() => findingAction.mutate({ findingId: "f-1", action: "accept", prId })}>
        accept
      </button>
    </div>
  );
}

function renderHarness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <Harness prId={PR_ID} />
    </QueryClientProvider>,
  );
}

describe("useSmartDiff invalidation set (REQ-21, REQ-25)", () => {
  it("refetches smart-diff after every finding-changing mutation: run review, delete run, delete review, dismiss, accept", async () => {
    renderHarness();

    // Initial load.
    expect(await screen.findByText("finding-1")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(1);

    // useRunReview — REQ-25 path 1: a re-run can flip the deduped winner to a
    // NEW id. Each step below is independently checkable: dropping the
    // invalidation from any ONE mutation's onSuccess makes only that step's
    // assertion time out, while the others keep passing.
    fireEvent.click(screen.getByRole("button", { name: "run-review" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("finding-2")).toBeInTheDocument();

    // useDeleteRun — REQ-25 path 2: ids from the deleted run must not linger.
    fireEvent.click(screen.getByRole("button", { name: "delete-run" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(3));

    // useDeleteReview — REQ-25 path 2, the other delete surface.
    fireEvent.click(screen.getByRole("button", { name: "delete-review" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(4));

    // useFindingAction(dismiss) — REQ-25 path 3: a dismissed finding's badge
    // must be able to disappear.
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(5));

    // useFindingAction(accept) — shares the same mutation as dismiss, so it
    // must be covered too.
    fireEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(6));
  });

  it("REQ-25 path 1 — the stale finding id is replaced, not just refetched", async () => {
    renderHarness();

    expect(await screen.findByText("finding-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "run-review" }));

    // Assert on the id itself, per the acceptance box — a refetch count alone
    // would not catch a hand-patched `setQueryData` that never actually
    // dropped the superseded id.
    expect(await screen.findByText("finding-2")).toBeInTheDocument();
    expect(screen.queryByText("finding-1")).not.toBeInTheDocument();
  });
});
