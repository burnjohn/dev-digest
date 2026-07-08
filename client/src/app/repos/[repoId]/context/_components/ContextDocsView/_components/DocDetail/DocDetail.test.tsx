import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import type { ContextDocument } from "@devdigest/shared";
import contextMessages from "../../../../../../../../../messages/en/context.json";

const saveDoc = vi.fn();
const deleteDoc = vi.fn();
let contentData = { path: "specs/x.md", content: "clone body", source: "clone" as ContextDocument["source"] };

vi.mock("@/lib/hooks/context-docs", () => ({
  useContextDocContent: () => ({ data: contentData, isLoading: false, isError: false }),
  useSaveContextDoc: () => ({ mutate: saveDoc, isPending: false }),
  useDeleteContextDoc: () => ({ mutate: deleteDoc, isPending: false }),
}));

import { DocDetail } from "./DocDetail";

afterEach(() => {
  cleanup();
  saveDoc.mockClear();
  deleteDoc.mockClear();
  contentData = { path: "specs/x.md", content: "clone body", source: "clone" };
  vi.restoreAllMocks();
});

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

function Harness(props: {
  selectedPath: string;
  doc?: ContextDocument;
  seed?: { path: string; body: string };
}) {
  const t = useTranslations("context");
  return (
    <DocDetail
      t={t}
      repoId="repo1"
      selectedPath={props.selectedPath}
      doc={props.doc}
      seed={props.seed}
      onSaved={() => {}}
      onDeleted={() => {}}
    />
  );
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("DocDetail", () => {
  it("switches from Preview to Edit mode, exposing an editable textarea (AC-23)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness selectedPath="specs/x.md" doc={doc({ path: "specs/x.md" })} />);

    // Preview mode: no textbox initially.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("Save calls the mutation with the edited text and the doc's path (AC-24)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness selectedPath="specs/x.md" doc={doc({ path: "specs/x.md" })} />);

    await user.click(screen.getByRole("tab", { name: "Edit" }));
    const box = screen.getByRole("textbox");
    await user.clear(box);
    await user.type(box, "new content");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saveDoc).toHaveBeenCalledWith(
      { path: "specs/x.md", body: "new content" },
      expect.anything(),
    );
  });

  it("hides the Delete button for a pure clone-sourced document (AC-34)", () => {
    renderWithIntl(<Harness selectedPath="specs/x.md" doc={doc({ path: "specs/x.md", source: "clone" })} />);
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("shows Delete for an overlay-only doc and calls the delete mutation with its path (AC-34)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderWithIntl(
      <Harness selectedPath="docs/up.md" doc={doc({ path: "docs/up.md", source: "overlay-only" })} />,
    );

    const del = screen.getByRole("button", { name: "Delete" });
    await user.click(del);
    expect(deleteDoc).toHaveBeenCalledWith({ path: "docs/up.md" }, expect.anything());
  });

  it("requires a non-empty path before saving a new document", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness selectedPath="" seed={{ path: "", body: "hello" }} />);

    await user.click(screen.getByRole("button", { name: "Save" }));
    // Empty path → validation message shown, mutation NOT called.
    expect(saveDoc).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter a path under a configured folder/)).toBeInTheDocument();
  });
});
