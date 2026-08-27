/* brief.test.tsx — usePrBrief dedupe + useRecalculateBrief cache write (REQ-29).
   Mocks the `api` module (the hook boundary) with a real QueryClient, per
   client/INSIGHTS.md 2026-08-09 seed: tests never hit the network. */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import type { RiskBriefResponse } from "@devdigest/shared";
import { api } from "../api";
import { usePrBrief, useRecalculateBrief } from "./brief";

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

const postMock = api.post as unknown as Mock;

const PR_ID = "pr-1";

function briefFixture(what: string): RiskBriefResponse {
  return {
    pr_id: PR_ID,
    what,
    why: "because reasons",
    risk_level: "medium",
    risks: [],
    review_focus: [],
    sources: {
      intent: "used",
      blast: "used",
      pr_body: "used",
      linked_issue: "missing",
      file_list: "used",
      md_files: [],
    },
    model: "gpt-test",
    generated_at: "2026-08-26T00:00:00.000Z",
  };
}

beforeEach(() => {
  postMock.mockReset();
  postMock.mockResolvedValue(briefFixture("initial brief"));
});

afterEach(() => {
  cleanup();
});

/** Two independent consumers of `usePrBrief` for the SAME `prId`, mounted
    under one `QueryClient` — proves the shared query key dedupes the POST
    that both `PrBriefCard` and `ReviewFocusCard` would otherwise fire. */
function TwoCards({ prId }: { prId: string }) {
  const a = usePrBrief(prId);
  const b = usePrBrief(prId);
  return (
    <div>
      <div data-testid="card-a">{a.data?.what ?? "loading"}</div>
      <div data-testid="card-b">{b.data?.what ?? "loading"}</div>
    </div>
  );
}

/** Probe for `useRecalculateBrief` — fires the mutation and renders whatever
    is currently in the `["pr-brief", prId]` cache entry, so the test can
    assert the mutation writes into the SAME entry `usePrBrief` reads. */
function RecalculateProbe({ prId }: { prId: string }) {
  const brief = usePrBrief(prId);
  const recalc = useRecalculateBrief(prId);
  const qc = useQueryClient();
  return (
    <div>
      <div data-testid="what">{brief.data?.what ?? "loading"}</div>
      <div data-testid="cache-what">
        {(qc.getQueryData<RiskBriefResponse>(["pr-brief", prId])?.what) ?? "none"}
      </div>
      <button onClick={() => recalc.mutate()}>recalculate</button>
    </div>
  );
}

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return qc;
}

describe("usePrBrief dedupe", () => {
  it("two components mounting usePrBrief with the same prId issue exactly one api.post", async () => {
    renderWithClient(<TwoCards prId={PR_ID} />);

    await waitFor(() => expect(screen.getByTestId("card-a")).toHaveTextContent("initial brief"));
    await waitFor(() => expect(screen.getByTestId("card-b")).toHaveTextContent("initial brief"));

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith(`/pulls/${PR_ID}/brief`, {});
  });
});

describe("useRecalculateBrief (REQ-29)", () => {
  it("posts { force: true } and writes the response straight into the pr-brief cache entry, without a refetch", async () => {
    renderWithClient(<RecalculateProbe prId={PR_ID} />);

    // Initial get-or-create load.
    await waitFor(() => expect(screen.getByTestId("what")).toHaveTextContent("initial brief"));
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenNthCalledWith(1, `/pulls/${PR_ID}/brief`, {});

    postMock.mockResolvedValueOnce(briefFixture("recalculated brief"));

    fireEvent.click(screen.getByRole("button", { name: "recalculate" }));

    await waitFor(() =>
      expect(screen.getByTestId("cache-what")).toHaveTextContent("recalculated brief"),
    );

    // Exactly two POSTs total: the initial get-or-create + the recalculate.
    // If the mutation had gone through `invalidateQueries` instead of
    // `setQueryData`, a THIRD post (the refetch) would land here.
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postMock).toHaveBeenNthCalledWith(2, `/pulls/${PR_ID}/brief`, { force: true });

    // The query itself picked up the mutation's write too.
    await waitFor(() =>
      expect(screen.getByTestId("what")).toHaveTextContent("recalculated brief"),
    );
  });
});
