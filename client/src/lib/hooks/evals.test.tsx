/* evals.test.tsx — T8's Acceptance box "every mutation invalidates the query
   keys its write affects": the eval-cases CRUD+run set, the batch-start
   dashboard/history set, and `useFindingEvalDraft`'s activate-on-demand gate.
   Mocks the `api` module (the hook boundary), never global `fetch`, per
   client/INSIGHTS.md 2026-08-09 seed — and every write below goes through
   `useMutation` (never a hand-rolled `api.post` — 2026-08-27's logged bug). */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../api";
import {
  useEvalCases,
  useCreateEvalCase,
  useUpdateEvalCase,
  useDeleteEvalCase,
  useRunEvalCase,
  useStartEvalBatch,
  useEvalBatches,
  useEvalDashboard,
  useFindingEvalDraft,
  type EvalCaseListItem,
} from "./evals";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    patch: vi.fn(),
  },
  API_BASE: "http://localhost:3001",
}));

const getMock = api.get as unknown as Mock;
const postMock = api.post as unknown as Mock;
const putMock = api.put as unknown as Mock;
const delMock = api.del as unknown as Mock;

const OWNER_KIND = "agent";
const OWNER_ID = "agent-1";

function renderWithClient(node: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

/** One case row whose `name` encodes the fetch count, so a re-render proves a
    REFETCH happened rather than a re-render of stale cached data — same trick
    as `reviews.test.tsx`'s `smartDiffFixture`. */
function caseFixture(n: number): EvalCaseListItem {
  return {
    id: "case-1",
    owner_kind: OWNER_KIND,
    owner_id: OWNER_ID,
    name: `case v${n}`,
    expectation_kind: "must_not_flag",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: [],
    forbidden_regions: null,
    filename: null,
    notes: null,
    latest_run: null,
  };
}

let casesCallCount = 0;
let batchesCallCount = 0;
let dashboardCallCount = 0;

beforeEach(() => {
  casesCallCount = 0;
  batchesCallCount = 0;
  dashboardCallCount = 0;
  getMock.mockReset();
  postMock.mockReset();
  putMock.mockReset();
  delMock.mockReset();

  getMock.mockImplementation(async (path: string) => {
    if (path === `/evals/cases?owner_kind=${OWNER_KIND}&owner_id=${OWNER_ID}`) {
      casesCallCount += 1;
      return [caseFixture(casesCallCount)];
    }
    if (path === `/evals/batches?owner_kind=${OWNER_KIND}&owner_id=${OWNER_ID}`) {
      batchesCallCount += 1;
      return [{ id: `batch-${batchesCallCount}` }];
    }
    if (path === "/evals/dashboard") {
      dashboardCallCount += 1;
      return [{ owner_id: `row-${dashboardCallCount}` }];
    }
    if (path === "/findings/finding-1/eval-draft") {
      draftCallCount += 1;
      return {
        owner_kind: OWNER_KIND,
        owner_id: OWNER_ID,
        name: "From finding: leaked key",
        input_diff: "--- a/x\n+++ b/x\n",
        expected_output: [],
        forbidden_regions: null,
        // The server stamps this from `accepted_at`/`dismissed_at`, so the
        // stub reads the decision the component currently holds. A response
        // served from the wrong cache entry then carries the wrong polarity,
        // which is exactly the defect under test.
        seeded_from: currentDecision,
      };
    }
    throw new Error(`unexpected GET ${path}`);
  });
  draftCallCount = 0;
  currentDecision = "accepted";
  postMock.mockResolvedValue({ id: "new-case", owner_kind: OWNER_KIND, owner_id: OWNER_ID });
  putMock.mockResolvedValue({ id: "case-1", owner_kind: OWNER_KIND, owner_id: OWNER_ID });
  delMock.mockResolvedValue({ ok: true });
});

afterEach(() => cleanup());

function CasesHarness() {
  const cases = useEvalCases(OWNER_KIND, OWNER_ID);
  const create = useCreateEvalCase();
  const update = useUpdateEvalCase();
  const del = useDeleteEvalCase(OWNER_KIND, OWNER_ID);
  const run = useRunEvalCase(OWNER_KIND, OWNER_ID);

  const name = cases.data?.[0]?.name ?? "none";

  return (
    <div>
      <div data-testid="case-name">{name}</div>
      <button
        onClick={() =>
          create.mutate({ owner_kind: OWNER_KIND, owner_id: OWNER_ID, name: "x", expected_output: [] })
        }
      >
        create
      </button>
      <button
        onClick={() =>
          update.mutate({
            id: "case-1",
            patch: { owner_kind: OWNER_KIND, owner_id: OWNER_ID, name: "y", expected_output: [] },
          })
        }
      >
        update
      </button>
      <button onClick={() => del.mutate("case-1")}>delete</button>
      <button onClick={() => run.mutate("case-1")}>run</button>
    </div>
  );
}

describe("useEvalCases CRUD+run invalidation set (T8 Acceptance)", () => {
  it("create, update, delete and run each refetch the owner's case list", async () => {
    renderWithClient(<CasesHarness />);

    expect(await screen.findByText("case v1")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "create" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("case v2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "update" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(4));

    fireEvent.click(screen.getByRole("button", { name: "run" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(5));
  });
});

function BatchHarness() {
  const batches = useEvalBatches(OWNER_KIND, OWNER_ID);
  const dashboard = useEvalDashboard();
  const start = useStartEvalBatch();

  return (
    <div>
      <div data-testid="batches-count">{batches.data?.length ?? 0}</div>
      <div data-testid="dashboard-count">{dashboard.data?.length ?? 0}</div>
      <button onClick={() => start.mutate({ owner_kind: OWNER_KIND, owner_id: OWNER_ID })}>start</button>
    </div>
  );
}

describe("useStartEvalBatch invalidation set (T8 Acceptance)", () => {
  it("a started batch refetches BOTH this owner's batch history and the dashboard", async () => {
    renderWithClient(<BatchHarness />);

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2)); // batches + dashboard, both mounted
    expect(batchesCallCount).toBe(1);
    expect(dashboardCallCount).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "start" }));

    await waitFor(() => expect(batchesCallCount).toBe(2));
    await waitFor(() => expect(dashboardCallCount).toBe(2));
  });
});

function SingleRunHarness() {
  const batches = useEvalBatches(OWNER_KIND, OWNER_ID);
  const dashboard = useEvalDashboard();
  const run = useRunEvalCase(OWNER_KIND, OWNER_ID);

  return (
    <div>
      <div data-testid="batches-count">{batches.data?.length ?? 0}</div>
      <div data-testid="dashboard-count">{dashboard.data?.length ?? 0}</div>
      <button onClick={() => run.mutate("case-1")}>run</button>
    </div>
  );
}

describe("useRunEvalCase invalidation set (single runs are a batch of 1)", () => {
  it("a single-case run refetches the batch history and the dashboard, not just the case list", async () => {
    // The server persists a batch of 1 for a single-case run (owner decision,
    // 2026-08-29), so the run lands in `recent_batches` and moves the headline
    // metrics exactly like a set run. Invalidating only the case list — what
    // this hook did while single runs wrote no batch row — left the dashboard
    // showing stale numbers until an unrelated refetch.
    renderWithClient(<SingleRunHarness />);

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(batchesCallCount).toBe(1);
    expect(dashboardCallCount).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "run" }));

    await waitFor(() => expect(batchesCallCount).toBe(2));
    await waitFor(() => expect(dashboardCallCount).toBe(2));
  });
});

/** Mutable stub state for the eval-draft endpoint: how many times it was hit,
    and the decision the "server" would stamp on the next response. */
let draftCallCount = 0;
let currentDecision: "accepted" | "dismissed" = "accepted";

function DraftHarness() {
  const [enabled, setEnabled] = useState(false);
  const draft = useFindingEvalDraft("finding-1", { enabled });

  return (
    <div>
      <div data-testid="draft-name">{draft.data?.name ?? "not-fetched"}</div>
      <button onClick={() => setEnabled(true)}>activate</button>
    </div>
  );
}

describe("useFindingEvalDraft activate-on-demand gate (AC-2/AC-3 must gate the click before this fires)", () => {
  it("does not fetch until enabled, then fetches exactly once", async () => {
    renderWithClient(<DraftHarness />);

    expect(getMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "activate" }));

    expect(await screen.findByText("From finding: leaked key")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith("/findings/finding-1/eval-draft");
  });
});

/** Drives the reported sequence: accept -> open draft -> revert -> dismiss ->
    open draft. `decidedAs` is what the real FindingCard derives from
    `accepted_at`/`dismissed_at`. */
function DecisionHarness() {
  const [decision, setDecision] = useState<"accepted" | "dismissed" | null>(null);
  const draft = useFindingEvalDraft("finding-1", {
    enabled: decision !== null,
    decidedAs: decision,
  });

  return (
    <div>
      <div data-testid="polarity">{draft.data?.seeded_from ?? "none"}</div>
      <button
        onClick={() => {
          currentDecision = "accepted";
          setDecision("accepted");
        }}
      >
        accept
      </button>
      <button onClick={() => setDecision(null)}>revert</button>
      <button
        onClick={() => {
          currentDecision = "dismissed";
          setDecision("dismissed");
        }}
      >
        dismiss
      </button>
    </div>
  );
}

/* These three render under the APP's query defaults, not the file's shared
   `renderWithClient` — the defect only exists inside `staleTime`, where a
   cached entry is served without a refetch, so a test client with the default
   `staleTime: 0` would refetch on every remount and hide it. Mirrors
   `lib/providers.tsx`. */
function renderDecisionHarness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <DecisionHarness />
    </QueryClientProvider>,
  );
}

describe("useFindingEvalDraft is keyed by the DECISION, not the finding id alone", () => {
  it("accept → revert → dismiss refetches and yields a dismissed draft, never the cached accepted one", async () => {
    renderDecisionHarness();

    fireEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => expect(screen.getByTestId("polarity")).toHaveTextContent("accepted"));
    expect(draftCallCount).toBe(1);

    // Revert: the query goes inactive. Its accepted-key entry stays in cache —
    // that entry is what used to be re-served below.
    fireEvent.click(screen.getByRole("button", { name: "revert" }));
    fireEvent.click(screen.getByRole("button", { name: "dismiss" }));

    // The mutation this kills: `queryKey: ["eval-draft", findingId]`. With the
    // decision missing from the key this stays "accepted" forever (well inside
    // the app's 30s staleTime) and the editor opens a POSITIVE banner for a
    // dismissed finding.
    await waitFor(() => expect(screen.getByTestId("polarity")).toHaveTextContent("dismissed"));
    expect(draftCallCount).toBe(2);
  });

  it("re-deciding the SAME way reuses the cached entry rather than refetching", async () => {
    // The key must discriminate by decision, not defeat caching outright.
    renderDecisionHarness();

    fireEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => expect(screen.getByTestId("polarity")).toHaveTextContent("accepted"));
    expect(draftCallCount).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "revert" }));
    fireEvent.click(screen.getByRole("button", { name: "accept" }));

    await waitFor(() => expect(screen.getByTestId("polarity")).toHaveTextContent("accepted"));
    expect(draftCallCount).toBe(1);
  });

  it("an undecided finding never fetches — its null decision is a key of its own", () => {
    renderDecisionHarness();

    expect(screen.getByTestId("polarity")).toHaveTextContent("none");
    expect(draftCallCount).toBe(0);
  });
});
