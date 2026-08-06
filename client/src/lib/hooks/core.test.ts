import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useAddRepo } from "./core";

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
