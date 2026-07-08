import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDocument, ContextFolders } from "@devdigest/shared";
import contextMessages from "../../../../../../../messages/en/context.json";

// ---- Mocks -----------------------------------------------------------------

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/repo-not-found", () => ({
  RepoNotFound: () => <div>Repo not found</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "repo1", full_name: "acme/widgets" },
    repos: [{ id: "repo1", full_name: "acme/widgets" }],
    reposLoaded: true,
  }),
  useRepoNotFound: () => false,
}));

let docsData: ContextDocument[] | undefined = [];
let contentData = { path: "specs/invariant.md", content: "# Invariant\n\nDo not do the bad thing.", source: "clone" as const };
const setContextFolders = vi.fn();
const saveDoc = vi.fn();
const deleteDoc = vi.fn();
let folders: ContextFolders = { folders: ["specs", "docs", "insights"] };

vi.mock("@/lib/hooks/context-docs", () => ({
  useContextDocs: () => ({ data: docsData, isLoading: false, isError: false, refetch: vi.fn() }),
  useContextFolders: () => ({ data: folders, isLoading: false }),
  useSetContextFolders: () => ({ mutate: setContextFolders, isPending: false }),
  useContextDocContent: () => ({ data: contentData, isLoading: false, isError: false }),
  useSaveContextDoc: () => ({ mutate: saveDoc, isPending: false }),
  useDeleteContextDoc: () => ({ mutate: deleteDoc, isPending: false }),
}));

import { ContextDocsView } from "./ContextDocsView";

afterEach(() => {
  cleanup();
  setContextFolders.mockClear();
  saveDoc.mockClear();
  deleteDoc.mockClear();
  docsData = [];
  folders = { folders: ["specs", "docs", "insights"] };
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function doc(partial: Partial<ContextDocument> & { path: string }): ContextDocument {
  return {
    category: partial.path.split("/")[0] ?? "specs",
    token_count: 0,
    used_by_agents: 0,
    coverage: 0,
    source: "clone",
    ...partial,
  };
}

describe("ContextDocsView — two-panel Project Context page", () => {
  it("renders the empty state when the API returns no documents (AC-18)", () => {
    docsData = [];
    renderWithIntl(<ContextDocsView repoId="repo1" />);
    expect(screen.getByText("No context documents yet")).toBeInTheDocument();
  });

  it("selecting a list row renders its content inline in the detail panel (AC-22)", async () => {
    docsData = [doc({ path: "specs/invariant.md", token_count: 128, used_by_agents: 2, coverage: 50 })];
    const user = userEvent.setup();
    renderWithIntl(<ContextDocsView repoId="repo1" />);

    // Select the document from the left list.
    await user.click(screen.getByRole("button", { name: /specs\/invariant\.md/ }));

    // Detail panel renders the (markdown) effective content inline — no modal.
    expect(await screen.findByText("Invariant")).toBeInTheDocument();
    expect(screen.getByText("Do not do the bad thing.")).toBeInTheDocument();
  });

  it("shows a coverage ring for the selected document (AC-28/AC-29)", async () => {
    docsData = [doc({ path: "specs/invariant.md", used_by_agents: 2, coverage: 50 })];
    const user = userEvent.setup();
    renderWithIntl(<ContextDocsView repoId="repo1" />);
    await user.click(screen.getByRole("button", { name: /specs\/invariant\.md/ }));
    // CircularScore renders the coverage number as text.
    expect(await screen.findByText("Coverage")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("saves the folder configuration via the PUT endpoint when a folder is added", async () => {
    docsData = [];
    const user = userEvent.setup();
    renderWithIntl(<ContextDocsView repoId="repo1" />);
    await user.type(screen.getByPlaceholderText("e.g. adr"), "adr");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(setContextFolders).toHaveBeenCalledWith(["specs", "docs", "insights", "adr"]);
  });

  it("exposes the add / upload / refresh toolbar (AC-32)", () => {
    docsData = [doc({ path: "specs/a.md" })];
    renderWithIntl(<ContextDocsView repoId="repo1" />);
    expect(screen.getByRole("button", { name: "New document" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload markdown" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });
});
