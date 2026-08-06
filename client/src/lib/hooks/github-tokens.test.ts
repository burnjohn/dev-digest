import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useGitHubTokens,
  useAssignRepoToken,
  useDeleteGitHubToken,
  usePatchGitHubToken,
  useTestRepoAccess,
} from "./github-tokens";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

/**
 * Same as `wrapper`, but hands back the QueryClient instance too so a test
 * can spy on `invalidateQueries` — proving WHICH keys a mutation invalidates,
 * not just that the request went out.
 */
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

  // ---- Invalidation: the "badge lies until a refetch happens" class of bug ----
  // Each of these proves BOTH keys are invalidated, not merely that the
  // request succeeded — a stale-badge regression would still pass every
  // other test here (the mutation and its response are unaffected) while
  // silently dropping one of these two calls.

  it("useDeleteGitHubToken invalidates both github-tokens and repos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ deleted: "t1", orphaned_repos: 1 }), { status: 200 })),
    );
    const { qc, Wrapper } = makeWrapper();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteGitHubToken(), { wrapper: Wrapper });
    await result.current.mutateAsync("t1");
    const keys = invalidatedKeys(spy);
    expect(keys).toContainEqual(["github-tokens"]);
    expect(keys).toContainEqual(["repos"]);
  });

  it("usePatchGitHubToken invalidates both github-tokens and repos (renamed label may be stale on repos)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: "t1", label: "renamed", configured: true }), { status: 200 }),
      ),
    );
    const { qc, Wrapper } = makeWrapper();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => usePatchGitHubToken(), { wrapper: Wrapper });
    await result.current.mutateAsync({ id: "t1", label: "renamed" });
    const keys = invalidatedKeys(spy);
    expect(keys).toContainEqual(["github-tokens"]);
    expect(keys).toContainEqual(["repos"]);
  });

  it("useAssignRepoToken invalidates both repos and github-tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "r1", github_token_id: "t2" }), { status: 200 })),
    );
    const { qc, Wrapper } = makeWrapper();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useAssignRepoToken(), { wrapper: Wrapper });
    await result.current.mutateAsync({ repoId: "r1", githubTokenId: "t2" });
    const keys = invalidatedKeys(spy);
    expect(keys).toContainEqual(["repos"]);
    expect(keys).toContainEqual(["github-tokens"]);
  });

  // ---- The no-token rule: the entire reason /repos/:id/test-access exists ----

  it("useTestRepoAccess sends no body and no token value — the server resolves its own stored token", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true, login: "octocat", message: "ok" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useTestRepoAccess(), { wrapper });
    await result.current.mutateAsync("r1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/repos/r1/test-access");
    expect(init!.method).toBe("POST");
    expect(init!.body).toBeUndefined();
    // No content-type header either: api.ts only sets it when a body is present,
    // so its absence is itself proof no JSON payload (and thus no token) was sent.
    expect((init!.headers as Record<string, string> | undefined)?.["content-type"]).toBeUndefined();
  });
});
