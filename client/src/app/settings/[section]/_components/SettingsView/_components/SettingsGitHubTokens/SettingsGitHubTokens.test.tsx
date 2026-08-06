import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import messages from "../../../../../../../../messages/en/github-tokens.json";
import commonMessages from "../../../../../../../../messages/en/common.json";
import { SettingsGitHubTokens } from "./SettingsGitHubTokens";

const tokens = [
  {
    id: "t1",
    workspace_id: "w",
    label: "work",
    github_login: "octocat",
    configured: true,
    repo_count: 2,
    created_at: "",
    last_validated_at: null,
  },
  {
    id: "t2",
    workspace_id: "w",
    label: "broken",
    github_login: null,
    configured: false,
    repo_count: 0,
    created_at: "",
    last_validated_at: null,
  },
];

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ "github-tokens": messages, common: commonMessages }}
      >
        <SettingsGitHubTokens />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("SettingsGitHubTokens", () => {
  it("lists tokens with their GitHub login and repo count", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(tokens), { status: 200 })));
    renderView();
    await waitFor(() => expect(screen.getByText("work")).toBeInTheDocument());
    expect(screen.getByText("@octocat")).toBeInTheDocument();
    expect(screen.getByText(/2 repos/i)).toBeInTheDocument();
  });

  it("shows 'No value stored' for a token with no working value", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(tokens), { status: 200 })));
    renderView();
    await waitFor(() => expect(screen.getByText("broken")).toBeInTheDocument());
    expect(screen.getByText("No value stored")).toBeInTheDocument();
  });

  it("renames a token via PATCH", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ ...tokens[0], label: "work-renamed" }), { status: 200 });
      }
      return new Response(JSON.stringify(tokens), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderView();
    await screen.findByText("work");

    fireEvent.click(screen.getAllByText(/rename/i)[0]!);
    const input = await screen.findByDisplayValue("work");
    fireEvent.change(input, { target: { value: "work-renamed" } });
    fireEvent.click(screen.getByText(/^save$/i));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH");
      expect(patchCall).toBeDefined();
      expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
        label: "work-renamed",
      });
    });
  });

  it("warns about orphaned repos before confirming delete, then deletes", async () => {
    // Single-token fixture — with two rows on screen, both carry a "Delete"
    // button and the assertions below can't tell them apart.
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Response(JSON.stringify({ deleted: "t1", orphaned_repos: 2 }), { status: 200 });
      }
      return new Response(JSON.stringify([tokens[0]]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderView();
    await screen.findByText("work");

    fireEvent.click(screen.getAllByText(/delete/i)[0]!);
    expect(await screen.findByText(/2 repositories/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/^delete$/i));
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "DELETE");
      expect(del).toBeDefined();
      expect(String(del![0])).toContain("/github-tokens/t1");
    });
  });

  it("creates a token via POST", async () => {
    const created = {
      id: "t3",
      workspace_id: "w",
      label: "ci",
      github_login: "cibot",
      configured: true,
      repo_count: 0,
      created_at: "",
      last_validated_at: null,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify(created), { status: 201 });
      }
      return new Response(JSON.stringify(tokens), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderView();
    await screen.findByText("work");

    fireEvent.click(screen.getByText(/new token/i));
    fireEvent.change(await screen.findByPlaceholderText(/label/i), { target: { value: "ci" } });
    fireEvent.change(screen.getByPlaceholderText(/ghp_/i), { target: { value: "ghp_secret" } });
    fireEvent.click(screen.getByText(/^save token$/i));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
        label: "ci",
        token: "ghp_secret",
      });
    });
  });
});
