import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import type { ContextDocument } from "@/lib/types";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import contextMessages from "../../../../../../../../messages/en/context.json";

// `@testing-library/user-event` is NOT a client/ dependency (see `package.json`
// — only `@testing-library/react` + `jest-dom`), so this file uses `fireEvent`
// throughout, mirroring `SkillsTab.test.tsx` (the prior art this tab mirrors)
// rather than the react-testing-library skill's usual preference.

// ---- Fixtures -------------------------------------------------------------

function doc(path: string, tokenEstimate: number, overrides: Partial<ContextDocument> = {}): ContextDocument {
  return {
    path,
    content: null,
    size: 100,
    updated_at: null,
    type: path.startsWith("specs/") ? "specs" : path.startsWith("insights/") ? "insights" : "docs",
    token_estimate: tokenEstimate,
    oversized: false,
    source: "repo",
    used_by_agents: 0,
    used_by_disabled_skill_only: 0,
    ...overrides,
  };
}

// Four documents; the server has beta/alpha attached in that (non-alphabetical)
// order, so "attached first, in STORED order, then the rest by path" is a real
// assertion. `gamma` is oversized (unattachable); `delta` is a large, unattached
// document used by the over-window-warning tests.
const DOCS: ContextDocument[] = [
  doc("docs/alpha.md", 100),
  doc("docs/beta.md", 200),
  doc("specs/gamma.md", 50, { oversized: true }),
  doc("insights/delta.md", 5000),
];
const ATTACHED = ["docs/beta.md", "docs/alpha.md"];

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
  skill_count: 0,
  enabled: true,
  version: 1,
};

// ---- Mocks ------------------------------------------------------------
// Mirrors `SkillsTab.test.tsx`: the hooks a real backend would drive are
// replaced with static fixtures, and the write itself is a spy so a test can
// assert on WHAT was posted without a network or a query client.

const mockSave = vi.fn();
const mockFlush = vi.fn();
let capturedOnError: ((message: string, revertTo: string[]) => void) | undefined;
let contextLength: number | null | undefined = 128_000;
const attachedPaths = ATTACHED;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "repo-1", setRepoId: vi.fn(), repos: [], activeRepo: null, reposLoaded: true }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useProviderModels: () => ({
    data: [{ id: "gpt-4.1", provider: "openai", contextLength }],
  }),
}));

vi.mock("@/lib/hooks/context", () => ({
  useContextDocuments: () => ({
    data: { documents: DOCS, total: DOCS.length, bounded: false, bound: 5000 },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useContextAttachment: () => ({
    data: { repo_id: "repo-1", paths: attachedPaths },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useContextAutosave: (options: { onError?: (message: string, revertTo: string[]) => void }) => {
    capturedOnError = options.onError;
    return { save: mockSave, flush: mockFlush, isSaving: false };
  },
  useContextPreview: () => ({
    data: { path: "docs/alpha.md", content: "# Alpha\nsome content", size: 20, updated_at: null },
    isLoading: false,
    isError: false,
  }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  mockSave.mockClear();
  mockFlush.mockClear();
  capturedOnError = undefined;
  contextLength = 128_000;
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, context: contextMessages }}>
      <ContextTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

/** The rows, in DOM order. */
function rowNames(): string[] {
  return screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
}

/** The paths posted by the most recent save. */
function lastPosted(): string[] {
  return mockSave.mock.calls.at(-1)?.[0] as string[];
}

function stubDataTransfer() {
  return {
    setData: vi.fn(),
    getData: vi.fn(),
    setDragImage: vi.fn(),
    effectAllowed: "none",
    dropEffect: "none",
  };
}

function dragFrom(source: Element, to: number, dataTransfer = stubDataTransfer()) {
  const rows = screen.getAllByRole("listitem");
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(rows[to]!, { dataTransfer });
  fireEvent.drop(rows[to]!, { dataTransfer });
  return dataTransfer;
}

function dragRow(from: number, to: number) {
  return dragFrom(screen.getAllByRole("listitem")[from]!, to);
}

describe("ContextTab", () => {
  it("lists attached documents first, in STORED order, then the rest by path", () => {
    renderTab();
    const names = rowNames();
    expect(names[0]).toContain("beta.md");
    expect(names[1]).toContain("alpha.md");
    expect(names[2]).toContain("delta.md"); // insights/ < specs/
    expect(names[3]).toContain("gamma.md");
  });

  it("heads with the attached-of-total count (REQ-15)", () => {
    renderTab();
    expect(screen.getByText("Project context — 2 of 4 attached")).toBeInTheDocument();
  });

  it("shows a per-row estimate for every row and a summed footer estimate over attached rows only (REQ-6 / REQ-15)", () => {
    renderTab();
    // Per row: alpha (100) and delta (5000) are each rendered once — the footer
    // sums only attached (beta 200 + alpha 100 = 300), a number no single row shows.
    expect(screen.getByText("100t")).toBeInTheDocument();
    expect(screen.getByText("5000t")).toBeInTheDocument();
    expect(screen.getByText("300t")).toBeInTheDocument();
  });

  it("has no Save control — the checkbox itself is the write (REQ-12)", () => {
    renderTab();
    expect(screen.queryByRole("button", { name: /^save/i })).not.toBeInTheDocument();
  });

  it("toggling attaches/detaches with no further action, and leaves every row at its index (REQ-12 / REQ-14)", () => {
    renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "alpha.md" }));
    expect(lastPosted()).toEqual(["docs/beta.md"]);
    // Row order is untouched by the toggle.
    const names = rowNames();
    expect(names[0]).toContain("beta.md");
    expect(names[1]).toContain("alpha.md");
    expect(names[2]).toContain("delta.md");
    expect(names[3]).toContain("gamma.md");
  });

  it("an oversized document cannot be attached — its checkbox stays unchecked and inert (T6 note)", () => {
    renderTab();
    const gamma = screen.getByRole("checkbox", { name: "gamma.md" });
    expect(gamma).not.toBeChecked();
    fireEvent.click(gamma);
    expect(gamma).not.toBeChecked();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("filters rows by path, case-insensitively, without changing any attached state (REQ-17)", () => {
    renderTab();
    fireEvent.change(screen.getByLabelText("Filter documents…"), { target: { value: "GAMMA" } });
    expect(rowNames()).toHaveLength(1);
    expect(rowNames()[0]).toContain("gamma.md");
    fireEvent.change(screen.getByLabelText("Filter documents…"), { target: { value: "" } });
    expect(screen.getByRole("checkbox", { name: "beta.md" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "alpha.md" })).toBeChecked();
  });

  it("dragging a row onto another reorders and saves the complete new order (REQ-11)", () => {
    renderTab();
    dragRow(1, 0); // alpha onto beta
    expect(lastPosted()).toEqual(["docs/alpha.md", "docs/beta.md"]);
    expect(rowNames()[0]).toContain("alpha.md");
    expect(rowNames()[1]).toContain("beta.md");
  });

  it("the keyboard reorder produces the identical order a drag would (REQ-36)", () => {
    renderTab();
    const handle = screen.getByRole("button", { name: /^Reorder alpha\.md/ });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(lastPosted()).toEqual(["docs/alpha.md", "docs/beta.md"]);
    expect(rowNames()[0]).toContain("alpha.md");
  });

  it("arrowing past a boundary writes nothing", () => {
    renderTab();
    const handle = screen.getByRole("button", { name: /^Reorder beta\.md/ });
    fireEvent.keyDown(handle, { key: "ArrowUp" }); // beta is already first
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("moving a row past an unattached one without changing prompt order writes nothing", () => {
    renderTab();
    // alpha (row 1) onto gamma (row 3, unattached) — beta/alpha stay in the
    // same relative sequence, so the assembled prompt is untouched.
    dragRow(1, 3);
    expect(mockSave).not.toHaveBeenCalled();
    expect(rowNames()[3]).toContain("alpha.md");
  });

  it("names the drag grip and the Preview control accessibly (REQ-36 / REQ-43)", () => {
    renderTab();
    expect(screen.getByRole("button", { name: /Reorder beta\.md — position 1 of 2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reorder gamma\.md — attach it first/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview beta.md" })).toBeInTheDocument();
  });

  it("hides the decorative grip and filter icons from the accessibility tree without erasing their controls' names (REQ-43)", () => {
    renderTab();
    // The grip button already carries its own `gripAriaLabel` — its icon is
    // purely decorative and must not be announced a second time.
    const grip = screen.getByRole("button", { name: /Reorder beta\.md — position 1 of 2/ });
    expect(grip.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // The filter input carries its own aria-label — the search icon beside it
    // is decorative, and the input must still be reachable by that label.
    const filterInput = screen.getByLabelText("Filter documents…");
    expect(filterInput).toBeInTheDocument();
    const searchIcon = filterInput.parentElement?.querySelector("svg");
    expect(searchIcon).toHaveAttribute("aria-hidden", "true");
  });

  it("opens a labelled Preview control that shows the document's content", () => {
    renderTab();
    const previewBtn = within(screen.getAllByRole("listitem")[1]!).getByRole("button", { name: /^Preview/ });
    fireEvent.click(previewBtn);
    expect(screen.getByText("SERIALIZES AS")).toBeInTheDocument();
    expect(screen.getByText(/some content/)).toBeInTheDocument();
  });

  it("warns above 25% of the model's context window, naming both numbers, without touching the attachment set (REQ-16 / REQ-42)", () => {
    contextLength = 1000; // 25% = 250 tokens; beta(200)+alpha(100) = 300 attached
    renderTab();
    const warning = screen.getByText(/over 25% of this model's 1000-token context window/);
    expect(warning.closest('[aria-live="polite"]')).toBeTruthy();
    // Still exactly the two originally-attached documents.
    expect(screen.getByRole("checkbox", { name: "beta.md" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "gamma.md" })).not.toBeChecked();
  });

  it("shows no warning when the model's context window is unknown, even far over budget", () => {
    contextLength = null;
    renderTab();
    expect(screen.queryByText(/context window/)).not.toBeInTheDocument();
  });

  it("announces a failed write and reverts the displayed attachment set, not the row order (REQ-35)", () => {
    renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "alpha.md" })); // → optimistic: only beta attached
    expect(screen.getByRole("checkbox", { name: "alpha.md" })).not.toBeChecked();

    // Not a user event — the write's own failure callback, invoked directly.
    act(() => capturedOnError?.("network blip", ATTACHED)); // server never applied it — revert to the original set
    expect(screen.getByText(/Couldn.t save your context attachments — network blip/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "alpha.md" })).toBeChecked();
    // Row order is untouched by the revert.
    expect(rowNames()[0]).toContain("beta.md");
    expect(rowNames()[1]).toContain("alpha.md");
  });
});
