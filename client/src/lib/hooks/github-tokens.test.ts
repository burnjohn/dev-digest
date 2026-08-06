import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useGitHubTokens, useAssignRepoToken } from "./github-tokens";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("github token hooks", () => {
  it("useGitHubTokens fetches the list", async () => {
    const rows = [{ id: "t1", label: "work", github_login: "octocat", configured: true, repo_count: 1 }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })),
    );
    const { result } = renderHook(() => useGitHubTokens(), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0]!.label).toBe("work");
  });

  it("useAssignRepoToken PATCHes the repo token route", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "r1", github_token_id: "t2" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAssignRepoToken(), { wrapper });
    await result.current.mutateAsync({ repoId: "r1", githubTokenId: "t2" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/repos/r1/github-token");
    expect(init!.method).toBe("PATCH");
    expect(JSON.parse(String(init!.body))).toEqual({ github_token_id: "t2" });
  });
});
