import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import messages from "../../../messages/en/github-tokens.json";
import { GitHubTokenPicker } from "./GitHubTokenPicker";

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
  {
    id: "t2",
    workspace_id: "w",
    label: "personal",
    github_login: "anton",
    configured: true,
    repo_count: 0,
    created_at: "",
    last_validated_at: null,
  },
];

function renderPicker(props: Partial<React.ComponentProps<typeof GitHubTokenPicker>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ "github-tokens": messages }}>
        <GitHubTokenPicker value={null} onChange={() => {}} {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(tokens), { status: 200 })),
  );
});

describe("GitHubTokenPicker", () => {
  it("lists the saved tokens and reports the chosen one", async () => {
    const onChange = vi.fn();
    renderPicker({ onChange });
    fireEvent.click(await screen.findByRole("button"));
    fireEvent.click(await screen.findByText("personal"));
    expect(onChange).toHaveBeenCalledWith("t2");
  });

  it("shows the selected token's label", async () => {
    renderPicker({ value: "t1" });
    await waitFor(() => expect(screen.getByText("work")).toBeInTheDocument());
  });

  it("reveals the inline create form and posts a new token", async () => {
    renderPicker();
    fireEvent.click(await screen.findByRole("button"));
    // The vendor Dropdown keys items by array index (kit/Dropdown.tsx), so
    // "+ New token" sits at index 0 until the async token fetch resolves and
    // shifts it past the loaded tokens — reusing that DOM node for the first
    // token in the process. Wait for the fetch to settle (proven by a token
    // label rendering) before targeting "+ New token" with a fresh query, or
    // the click can land on a node that has since been repurposed.
    await screen.findByText("work");
    fireEvent.click(screen.getByText(/new token/i));
    expect(await screen.findByPlaceholderText(/label/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ghp_/i)).toBeInTheDocument();
  });

  it("saves a new token via POST and selects it through onChange", async () => {
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
      if (init?.method === "POST" && String(url).endsWith("/github-tokens")) {
        return new Response(JSON.stringify(created), { status: 201 });
      }
      return new Response(JSON.stringify(tokens), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const onChange = vi.fn();
    renderPicker({ onChange });
    fireEvent.click(await screen.findByRole("button"));
    await screen.findByText("work");
    fireEvent.click(screen.getByText(/new token/i));

    fireEvent.change(await screen.findByPlaceholderText(/label/i), {
      target: { value: "ci" },
    });
    fireEvent.change(screen.getByPlaceholderText(/ghp_/i), {
      target: { value: "ghp_secret" },
    });
    fireEvent.click(screen.getByText(/save token/i));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("t3"));
    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({
      label: "ci",
      token: "ghp_secret",
    });
  });
});
