import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import messages from "../../../../../../../messages/en/github-tokens.json";
import { RepoSettingsView } from "./RepoSettingsView";

const repoNoToken = {
  id: "r1",
  workspace_id: "w",
  owner: "acme",
  name: "api",
  full_name: "acme/api",
  default_branch: "main",
  clone_path: null,
  last_polled_at: null,
  created_by: null,
  github_token_id: null,
  github_token_label: null,
};

const repoWithToken = {
  ...repoNoToken,
  github_token_id: "t1",
  github_token_label: "work",
};

const tokens = [
  {
    id: "t1",
    workspace_id: "w",
    label: "work",
    github_login: "octocat",
    configured: true,
    repo_count: 1,
    created_at: "",
    last_validated_at: null,
  },
];

function renderView(repoId = "r1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ "github-tokens": messages }}>
        <RepoSettingsView repoId={repoId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

function mockFetch(repos: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      new Response(JSON.stringify(String(url).includes("/github-tokens") ? tokens : repos), {
        status: 200,
      }),
    ),
  );
}

describe("RepoSettingsView", () => {
  beforeEach(() => {
    mockFetch([repoNoToken]);
  });

  it("shows the repo identity", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("acme/api")).toBeInTheDocument());
  });

  it("warns when the repo has no token assigned", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText(/no token assigned/i)).toBeInTheDocument());
  });

  it("does not show the warning or a Test button once a token is assigned", async () => {
    mockFetch([repoWithToken]);
    renderView();
    await waitFor(() => expect(screen.getByText("acme/api")).toBeInTheDocument());
    expect(screen.queryByText(/no token assigned/i)).not.toBeInTheDocument();
    expect(screen.getByText(/test access to this repo/i)).toBeInTheDocument();
  });

  it("probes access via POST /repos/:id/test-access with no body", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/test-access")) {
        expect(init?.body).toBeUndefined();
        return new Response(
          JSON.stringify({ ok: true, login: "octocat", message: "Looks good, octocat" }),
          { status: 200 },
        );
      }
      if (String(url).includes("/github-tokens")) {
        return new Response(JSON.stringify(tokens), { status: 200 });
      }
      return new Response(JSON.stringify([repoWithToken]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderView();
    fireEvent.click(await screen.findByText(/test access to this repo/i));
    await screen.findByText("Looks good, octocat");
  });
});
