/**
 * ContextTab — the skill editor's `Context` tab (SPEC-01 T10).
 *
 * Per `client/INSIGHTS.md` 2026-08-09 the mock point is the hook boundary,
 * never global `fetch` — `useContextDocuments`, `useContextAttachment`,
 * `useContextAutosave`, `useContextPreview` and `useActiveRepo` are all
 * mocked, matching `SkillsTab.test.tsx`'s pattern one level up.
 *
 * `@testing-library/user-event` is NOT a `client/` dependency (checked:
 * absent from `package.json` and the lockfile), so this file uses
 * `fireEvent` throughout — the same tool every other test in this package
 * uses, `SkillsTab.test.tsx` included. See `Notes for the integrator`.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDocument, Skill } from "@devdigest/shared";
import contextMessages from "../../../../../../../../messages/en/context.json";
import skillsMessages from "../../../../../../../../messages/en/skills.json";

const save = vi.fn();
const flush = vi.fn();
const docsRefetch = vi.fn();
const attachRefetch = vi.fn();

const useContextDocumentsSpy = vi.fn();
const useContextAttachmentSpy = vi.fn();
const useContextAutosaveSpy = vi.fn();
const useContextPreviewSpy = vi.fn();

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "repo-1",
    setRepoId: vi.fn(),
    repos: [],
    activeRepo: null,
    reposLoaded: true,
  }),
}));

vi.mock("@/lib/hooks/context", () => ({
  useContextDocuments: (repoId: string | null) => useContextDocumentsSpy(repoId),
  useContextAttachment: (ownerType: string, ownerId: string, repoId: string) =>
    useContextAttachmentSpy(ownerType, ownerId, repoId),
  useContextAutosave: (opts: unknown) => useContextAutosaveSpy(opts),
  useContextPreview: (repoId: string | null, path: string | null) =>
    useContextPreviewSpy(repoId, path),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  save.mockClear();
  flush.mockClear();
  docsRefetch.mockClear();
  attachRefetch.mockClear();
  useContextDocumentsSpy.mockReset();
  useContextAttachmentSpy.mockReset();
  useContextAutosaveSpy.mockReset();
  useContextPreviewSpy.mockReset();
});

const SKILL = { id: "sk1", name: "security-review", version: 1 } as Skill;

const doc = (path: string, overrides: Partial<ContextDocument> = {}): ContextDocument => ({
  path,
  content: null,
  size: 100,
  updated_at: "2026-08-01T00:00:00.000Z",
  type: "specs",
  token_estimate: 10,
  oversized: false,
  source: "repo",
  used_by_agents: 0,
  used_by_disabled_skill_only: 0,
  ...overrides,
});

// Attached in a NON-alphabetical order, so "attached first, in attach order"
// is a real assertion rather than an accident of sorting.
const DOCS: ContextDocument[] = [
  doc("docs/api.md", { type: "docs", token_estimate: 50 }),
  doc("specs/security-baseline.md", { type: "specs", token_estimate: 30 }),
  doc("specs/huge.md", { type: "specs", token_estimate: 999, oversized: true }),
];

function mockLoaded(attachedPaths = ["docs/api.md", "specs/security-baseline.md"]) {
  useContextDocumentsSpy.mockReturnValue({
    data: { documents: DOCS, total: DOCS.length, bounded: false, bound: 5000 },
    isLoading: false,
    isError: false,
    error: null,
    refetch: docsRefetch,
  });
  useContextAttachmentSpy.mockReturnValue({
    data: { repo_id: "repo-1", paths: attachedPaths },
    isLoading: false,
    isError: false,
    error: null,
    refetch: attachRefetch,
  });
  useContextAutosaveSpy.mockReturnValue({ save, flush, isSaving: false });
  useContextPreviewSpy.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

function renderTab() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ context: contextMessages, skills: skillsMessages }}
    >
      <ContextTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

/** The rows, in DOM order. */
function rowNames(): string[] {
  return screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
}

/** The paths posted by the most recent autosave call. */
function lastSaved(): string[] {
  return save.mock.calls.at(-1)?.[0] as string[];
}

/**
 * jsdom implements no `DataTransfer`, so every drag test has to carry its
 * own. It is not decoration: `dragstart` MUST write to it (Firefox aborts a
 * drag that doesn't) and `dragover` MUST set `dropEffect`, and a stub is the
 * only way this suite can see either happen.
 */
function stubDataTransfer() {
  return {
    setData: vi.fn(),
    getData: vi.fn(),
    setDragImage: vi.fn(),
    effectAllowed: "none",
    dropEffect: "none",
  };
}

/** Drag `source` onto row `to`, via the same dataTransfer the browser would reuse. */
function dragFrom(source: Element, to: number, dataTransfer = stubDataTransfer()) {
  const rows = screen.getAllByRole("listitem");
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(rows[to]!, { dataTransfer });
  fireEvent.drop(rows[to]!, { dataTransfer });
  return dataTransfer;
}

/** Drag row `from` onto row `to` (indices into the rendered list). */
function dragRow(from: number, to: number) {
  return dragFrom(screen.getAllByRole("listitem")[from]!, to);
}

describe("ContextTab — states (REQ-34)", () => {
  it("shows a loading indicator ending in '…' while the queries are pending", () => {
    useContextDocumentsSpy.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch: docsRefetch });
    useContextAttachmentSpy.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch: attachRefetch });
    renderTab();
    expect(screen.getByText("Loading project context…")).toBeInTheDocument();
  });

  it("shows a named empty state when the repo has no documents", () => {
    useContextDocumentsSpy.mockReturnValue({
      data: { documents: [], total: 0, bounded: false, bound: 5000 },
      isLoading: false,
      isError: false,
      error: null,
      refetch: docsRefetch,
    });
    useContextAttachmentSpy.mockReturnValue({
      data: { repo_id: "repo-1", paths: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: attachRefetch,
    });
    useContextAutosaveSpy.mockReturnValue({ save, flush, isSaving: false });
    renderTab();
    expect(screen.getByText("No project context documents yet")).toBeInTheDocument();
  });

  it("shows an error naming the failure, with a working retry", () => {
    useContextDocumentsSpy.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("network down"),
      refetch: docsRefetch,
    });
    useContextAttachmentSpy.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: attachRefetch });
    renderTab();
    expect(screen.getByText(/Couldn.t load project context — network down/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(docsRefetch).toHaveBeenCalledTimes(1);
  });
});

describe("ContextTab — rows, attachment and order (REQ-6, REQ-14, REQ-15)", () => {
  it("heads with the attached count and lists attached docs first, in attach order", () => {
    mockLoaded();
    renderTab();
    expect(screen.getByText("Project context to use — 2 attached")).toBeInTheDocument();
    const names = rowNames();
    expect(names[0]).toContain("api.md");
    expect(names[1]).toContain("security-baseline.md");
    expect(names[2]).toContain("huge.md");
  });

  it("checks exactly the attached documents, each with its own token estimate", () => {
    mockLoaded();
    renderTab();
    expect(screen.getByRole("checkbox", { name: "docs/api.md" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "specs/huge.md" })).not.toBeChecked();
    expect(screen.getByText("50t")).toBeInTheDocument();
    expect(screen.getByText("30t")).toBeInTheDocument();
  });

  it("sums ONLY the attached documents' tokens in the footer estimate", () => {
    mockLoaded();
    renderTab();
    // 50 (docs/api.md) + 30 (specs/security-baseline.md); the oversized,
    // unattached 999-token doc is excluded.
    expect(screen.getByText("80t")).toBeInTheDocument();
  });

  it("has no Save control — toggling saves immediately", () => {
    mockLoaded();
    renderTab();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "docs/api.md" }));
    expect(save).toHaveBeenCalled();
  });

  it("attaching a row persists the complete ordered set with no further action", () => {
    mockLoaded(["docs/api.md"]);
    renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "specs/security-baseline.md" }));
    expect(lastSaved()).toEqual(["docs/api.md", "specs/security-baseline.md"]);
  });

  it("unchecking a row leaves it at its own index — it does not fall to the bottom", () => {
    mockLoaded();
    renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "docs/api.md" }));
    expect(lastSaved()).toEqual(["specs/security-baseline.md"]);
    expect(rowNames()[0]).toContain("api.md"); // row stays put
  });

  it("an oversized document's checkbox is inert — clicking it changes nothing", () => {
    mockLoaded();
    renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "specs/huge.md" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "specs/huge.md" })).not.toBeChecked();
    expect(screen.getByText("Oversized")).toBeInTheDocument();
  });
});

describe("ContextTab — drag and keyboard reorder (REQ-11, REQ-36)", () => {
  it("dragging a row onto another reorders and saves the same order a keyboard shift would", () => {
    mockLoaded();
    renderTab();
    dragRow(1, 0); // specs/security-baseline.md above docs/api.md
    expect(lastSaved()).toEqual(["specs/security-baseline.md", "docs/api.md"]);
    expect(rowNames()[0]).toContain("security-baseline.md");
  });

  it("dropping onto an unattached row lands there — every row is a drop target", () => {
    mockLoaded();
    renderTab();
    dragRow(0, 2); // docs/api.md onto the unattached specs/huge.md
    expect(rowNames()[0]).toContain("security-baseline.md");
    expect(rowNames()[1]).toContain("huge.md");
    expect(rowNames()[2]).toContain("api.md");
  });

  it("writes to dataTransfer on dragstart — Firefox aborts a drag that doesn't", () => {
    mockLoaded();
    renderTab();
    const dt = dragRow(1, 0);
    expect(dt.setData).toHaveBeenCalledWith("text/plain", "specs/security-baseline.md");
    expect(dt.effectAllowed).toBe("move");
    expect(dt.dropEffect).toBe("move");
  });

  it("the grip reorders from the keyboard, producing the same saved order as the equivalent drag", () => {
    mockLoaded();
    renderTab();
    const handle = screen.getByRole("button", {
      name: /^Reorder specs\/security-baseline\.md/,
    });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(lastSaved()).toEqual(["specs/security-baseline.md", "docs/api.md"]);
  });
});

describe("ContextTab — accessible names (REQ-43)", () => {
  it("names the grip and the Preview affordance", () => {
    mockLoaded();
    renderTab();
    expect(
      screen.getByRole("button", { name: /Reorder docs\/api\.md — position 1 of 2/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview docs/api.md" })).toBeInTheDocument();
  });

  it("hides the decorative grip and filter icons from the accessibility tree without erasing their controls' names", () => {
    mockLoaded();
    renderTab();
    // The grip button already carries its own `gripAriaLabel` — its icon is
    // purely decorative and must not be announced a second time.
    const grip = screen.getByRole("button", { name: /Reorder docs\/api\.md — position 1 of 2/ });
    expect(grip.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // The filter input carries its own aria-label — the search icon beside it
    // is decorative, and the input must still be reachable by that label.
    const filterInput = screen.getByLabelText("Filter documents…");
    expect(filterInput).toBeInTheDocument();
    const searchIcon = filterInput.parentElement?.querySelector("svg");
    expect(searchIcon).toHaveAttribute("aria-hidden", "true");
  });
});

describe("ContextTab — the SERIALIZES AS preview (REQ-19)", () => {
  it("renders the literal '## Project context' heading, and never '## Project specifications'", () => {
    mockLoaded();
    renderTab();
    const label = screen.getByText("SERIALIZES AS");
    const box = label.parentElement!;
    expect(within(box).getByText(/## Project context/)).toBeInTheDocument();
    expect(screen.queryByText(/## Project specifications/)).not.toBeInTheDocument();
  });
});

describe("ContextTab — no editing affordances (REQ-46)", () => {
  it("renders no Edit toggle, + button, or new-folder button", () => {
    mockLoaded();
    renderTab();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new folder/i })).not.toBeInTheDocument();
  });
});
