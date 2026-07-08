import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import type { ContextDocument } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../../../messages/en/agents.json";

vi.mock("@/lib/hooks/context-docs", () => ({
  useContextDocContent: () => ({ data: { path: "x", content: "x", source: "clone" }, isLoading: false, isError: false }),
}));

import { ContextDocsList } from "./ContextDocsList";

const onSetLinked = vi.fn();

afterEach(() => {
  cleanup();
  onSetLinked.mockClear();
});

function d(path: string, tokens = 10): ContextDocument {
  return { path, category: path.split("/")[0] ?? "specs", token_count: tokens, used_by_agents: 0, coverage: 0, source: "clone" };
}

function Harness(props: { docs: ContextDocument[]; linkedPaths: string[] }) {
  const t = useTranslations("agents.context");
  return (
    <ContextDocsList
      t={t}
      repoId="repo1"
      repoLabel="acme/widgets"
      docs={props.docs}
      isLoadingDocs={false}
      linkedPaths={props.linkedPaths}
      isLoadingLinked={false}
      onSetLinked={onSetLinked}
      isSaving={false}
    />
  );
}

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

describe("ContextDocsList — unified checkbox list", () => {
  it("checking a row appends it to the linked paths", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness docs={[d("specs/a.md"), d("docs/b.md")]} linkedPaths={["specs/a.md"]} />);
    await user.click(within(rowFor("docs/b.md")).getByRole("checkbox"));
    expect(onSetLinked).toHaveBeenCalledWith(["specs/a.md", "docs/b.md"]);
  });

  it("unchecking a row filters it out", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness docs={[d("specs/a.md"), d("docs/b.md")]} linkedPaths={["specs/a.md"]} />);
    await user.click(within(rowFor("specs/a.md")).getByRole("checkbox"));
    expect(onSetLinked).toHaveBeenCalledWith([]);
  });

  it("only checked rows are draggable", () => {
    renderWithIntl(<Harness docs={[d("specs/a.md"), d("docs/b.md")]} linkedPaths={["specs/a.md"]} />);
    expect(rowFor("specs/a.md").getAttribute("draggable")).toBe("true");
    expect(rowFor("docs/b.md").getAttribute("draggable")).toBe("false");
  });

  it("shows the 'X of Y attached' header pill", () => {
    renderWithIntl(<Harness docs={[d("specs/a.md"), d("docs/b.md")]} linkedPaths={["specs/a.md"]} />);
    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument();
  });

  it("renders 'No documents in this repository' — never 'all linked' — for a zero-document repo", () => {
    renderWithIntl(<Harness docs={[]} linkedPaths={[]} />);
    expect(screen.getByText("No documents in this repository")).toBeInTheDocument();
    expect(screen.queryByText(/already linked/i)).not.toBeInTheDocument();
  });

  it("renders all rows checked with no 'all linked' text when every document is attached", () => {
    renderWithIntl(<Harness docs={[d("specs/a.md"), d("docs/b.md")]} linkedPaths={["specs/a.md", "docs/b.md"]} />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.every((b) => b.getAttribute("aria-checked") === "true")).toBe(true);
    expect(screen.queryByText(/already linked/i)).not.toBeInTheDocument();
  });
});
