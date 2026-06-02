import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useAgentSkills: () => ({ data: [] }),
  useSetAgentSkills: () => ({ mutate: vi.fn() }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));
vi.mock("../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({
    data: [
      { id: "s1", name: "pr-quality-rubric", description: "rubric", type: "rubric", source: "manual", body: "", enabled: true, version: 1, evidence_files: null },
    ],
  }),
}));
// The Evals/Stats/CI tabs render real feature components (A4/A5) that use their
// own React Query hooks — covered by their own smoke tests. Stub them here (at
// their CURRENT module paths) so this editor-shell smoke test stays focused.
vi.mock("../AgentEvalsTab", () => ({ default: () => <div>eval-cases-tab</div> }));
vi.mock("../AgentStatsTab", () => ({ default: () => <div>per-agent-stats-tab</div> }));
vi.mock("../AgentCiTab", () => ({ default: () => <div>ci-deploy-tab</div> }));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the 5 tabs and the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    for (const t of ["Config", "Skills", "Evals", "Stats", "CI"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });

  it("switches to the Skills tab via onTab and renders skill rows", () => {
    const onTab = vi.fn();
    const { rerender } = renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={onTab} />);
    fireEvent.click(screen.getByText("Skills"));
    expect(onTab).toHaveBeenCalledWith("skills");
    rerender(
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        <AgentEditor agent={AGENT} tab="skills" onTab={onTab} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
  });

  it("Evals/Stats/CI tabs render their owning agents' feature components", () => {
    const { rerender } = renderWithIntl(<AgentEditor agent={AGENT} tab="evals" onTab={() => {}} />);
    expect(screen.getByText("eval-cases-tab")).toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        <AgentEditor agent={AGENT} tab="stats" onTab={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("per-agent-stats-tab")).toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        <AgentEditor agent={AGENT} tab="ci" onTab={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("ci-deploy-tab")).toBeInTheDocument();
  });
});
