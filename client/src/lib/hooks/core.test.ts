import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { waitFor } from "@testing-library/react";
import { useAddRepo, usePullByNumber } from "./core";

/** Hands back the QueryClient too so a test can spy on `invalidateQueries` —
    proving WHICH keys a mutation invalidates, not just that the request went out. */
function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

function invalidatedKeys(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] } | undefined)?.queryKey ?? []);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useAddRepo", () => {
  /**
   * Binding a token at creation (or re-adding an already-tracked repo with a
   * NEW token — RepoService.add's dedupe path assigns rather than no-op'ing,
   * see the final-review fix) changes that token's `repo_count`, the same
   * "badge lies until a refetch happens" class of bug the sibling token
   * mutations already guard against.
   */
  it("invalidates both repos and github-tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ id: "r1", full_name: "acme/api", github_token_id: "t1" }),
            { status: 201 },
          ),
      ),
    );
    const { qc, Wrapper } = makeWrapper();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useAddRepo(), { wrapper: Wrapper });
    await result.current.mutateAsync({ url: "https://github.com/acme/api", githubTokenId: "t1" });
    const keys = invalidatedKeys(spy);
    expect(keys).toContainEqual(["repos"]);
    expect(keys).toContainEqual(["github-tokens"]);
  });
});

describe("usePullByNumber", () => {
  const PR = {
    id: "pr-uuid-1",
    number: 42,
    title: "Add feature",
    body: "",
    status: "needs_review",
    files: [],
    files_count: 0,
    commits: [],
    head_sha: "abc",
  };

  it("fetches the PR via the by-number route", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(PR), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePullByNumber("repo1", 42), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/repos/repo1/pulls/number/42");
    expect(result.current.data!.id).toBe("pr-uuid-1");
  });

  it("seeds the id-keyed pull-detail cache with the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(PR), { status: 200 })),
    );
    const { qc, Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePullByNumber("repo1", 42), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(qc.getQueryData(["pull", "pr-uuid-1"])).toMatchObject({ id: "pr-uuid-1", number: 42 });
  });

  it("stays disabled for a non-numeric PR number", () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePullByNumber("repo1", Number("abc")), {
      wrapper: Wrapper,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });
});
