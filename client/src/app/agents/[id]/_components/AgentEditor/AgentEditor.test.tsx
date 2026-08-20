import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import { ToastProvider } from "../../../../../lib/toast";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate, isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

import { AgentEditor } from "./AgentEditor";

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function withIntl(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>
  );
}

function renderWithIntl(ui: React.ReactElement) {
  return render(withIntl(ui));
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });

  it("does not expose or persist the legacy review strategy", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);

    expect(screen.queryByText("Review strategy")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Save agent"));

    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate.mock.calls[0]![0].patch).not.toHaveProperty("strategy");
  });

  it("discards unsaved edits and shows the new agent's config when switching agents", () => {
    const view = renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);

    const nameInput = screen.getByDisplayValue("Security Reviewer");
    fireEvent.change(nameInput, { target: { value: "Edited but unsaved" } });
    expect(screen.getByDisplayValue("Edited but unsaved")).toBeInTheDocument();

    const other: Agent = { ...AGENT, id: "ag2", name: "Perf Reviewer", description: "Latency" };
    view.rerender(withIntl(<AgentEditor agent={other} tab="config" onTab={() => {}} />));

    expect(screen.getByDisplayValue("Perf Reviewer")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Edited but unsaved")).not.toBeInTheDocument();
  });
});
