import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, ContextDocument, AgentContextDocLink } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";

// ---- Mocks -----------------------------------------------------------------

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "repo1",
    activeRepo: { id: "repo1", full_name: "acme/widgets" },
    repos: [{ id: "repo1", full_name: "acme/widgets" }],
    reposLoaded: true,
  }),
}));

const DOCS: ContextDocument[] = [
  { path: "specs/invariant.md", category: "specs", token_count: 40, used_by_agents: 1, coverage: 50, source: "clone" },
  { path: "docs/architecture.md", category: "docs", token_count: 120, used_by_agents: 0, coverage: 0, source: "clone" },
];

let linkedLinks: AgentContextDocLink[] = [{ owner_id: "ag1", path: "specs/invariant.md", order: 0 }];

const setAgentContextDocs = vi.fn();

vi.mock("@/lib/hooks/context-docs", () => ({
  useContextDocs: () => ({ data: DOCS, isLoading: false }),
  useAgentContextDocs: () => ({ data: linkedLinks, isLoading: false }),
  useSetAgentContextDocs: () => ({ mutate: setAgentContextDocs, isPending: false }),
  useContextDocContent: () => ({ data: { path: "x", content: "x", source: "clone" }, isLoading: false, isError: false }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  setAgentContextDocs.mockClear();
  linkedLinks = [{ owner_id: "ag1", path: "specs/invariant.md", order: 0 }];
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

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function rowFor(path: string): HTMLElement {
  return screen.getByText(path).closest("[draggable]") as HTMLElement;
}

describe("ContextTab — unified checkbox picker (v2 redesign)", () => {
  it("attaches a document via its checkbox, appending it to document_paths in order", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ContextTab agent={AGENT} />);

    // docs/architecture.md is unchecked — toggling attaches it.
    await user.click(within(rowFor("docs/architecture.md")).getByRole("checkbox"));

    expect(setAgentContextDocs).toHaveBeenCalledWith(["specs/invariant.md", "docs/architecture.md"]);
  });

  it("detaches a document by unchecking its checkbox", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ContextTab agent={AGENT} />);

    // specs/invariant.md is checked — toggling detaches it.
    await user.click(within(rowFor("specs/invariant.md")).getByRole("checkbox"));

    expect(setAgentContextDocs).toHaveBeenCalledWith([]);
  });

  it("only renders drag handles / reorder controls on attached (checked) rows", () => {
    renderWithIntl(<ContextTab agent={AGENT} />);
    const attached = rowFor("specs/invariant.md");
    const unattached = rowFor("docs/architecture.md");
    expect(attached.getAttribute("draggable")).toBe("true");
    expect(unattached.getAttribute("draggable")).toBe("false");
    expect(within(attached).queryByRole("button", { name: "Move down" })).toBeInTheDocument();
    expect(within(unattached).queryByRole("button", { name: "Move down" })).not.toBeInTheDocument();
  });

  it("reorders attached documents via move-down, persisting the new order", async () => {
    linkedLinks = [
      { owner_id: "ag1", path: "specs/invariant.md", order: 0 },
      { owner_id: "ag1", path: "docs/architecture.md", order: 1 },
    ];
    const user = userEvent.setup();
    renderWithIntl(<ContextTab agent={AGENT} />);

    await user.click(within(rowFor("specs/invariant.md")).getByRole("button", { name: "Move down" }));

    expect(setAgentContextDocs).toHaveBeenCalledWith(["docs/architecture.md", "specs/invariant.md"]);
  });

  it("shows an 'X of Y attached' header pill", () => {
    renderWithIntl(<ContextTab agent={AGENT} />);
    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument();
  });

  it("updates the live serialization preview token total when the linked set changes (AC-9)", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithIntl(<ContextTab agent={AGENT} />);

    await user.click(screen.getByRole("button", { name: /Serialization preview/i }));
    expect(screen.getByText("Total: 40 tokens")).toBeInTheDocument();

    linkedLinks = [
      { owner_id: "ag1", path: "specs/invariant.md", order: 0 },
      { owner_id: "ag1", path: "docs/architecture.md", order: 1 },
    ];
    rerender(
      <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages }}>
        <ContextTab agent={AGENT} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByText("Total: 160 tokens")).toBeInTheDocument();
  });
});
