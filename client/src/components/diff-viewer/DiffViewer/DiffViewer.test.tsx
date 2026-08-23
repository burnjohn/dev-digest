import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { DiffViewer } from ".";
import { FileCard } from "../FileCard";
import type { DiffAnnotationApi, DiffLineAnnotation } from "../annotations";
import type { DiffCommentApi } from "../comments";
import type { PrFile } from "@/lib/types";
import shellMessages from "../../../../messages/en/shell.json";

afterEach(cleanup);

const bigPatch = [
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
].join("\n");

const smallFile: PrFile = {
  path: "src/middleware/ratelimit.ts",
  additions: 2,
  deletions: 1,
  patch: bigPatch,
};

function withProvider(children: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>
      <div data-theme="dark">{children}</div>
    </NextIntlClientProvider>
  );
}

function renderViewer(files: PrFile[], annotations?: DiffAnnotationApi) {
  return render(withProvider(<DiffViewer files={files} annotations={annotations} />));
}

function noop(): DiffLineAnnotation | null {
  return null;
}

function noLineAnnotations(): DiffLineAnnotation[] {
  return [];
}

describe("DiffViewer — annotations slot (REQ-14, REQ-15, REQ-16, REQ-29)", () => {
  it("REQ-14: with no annotations, renders zero chips, zero left-bar accents, no header dot and no orphan list", () => {
    renderViewer([smallFile]);
    // no chip / header-indicator / orphan-item buttons anywhere (all three
    // share one conditional on `annotations` being present)
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
    const row = screen.getByText("const c = 4;").closest("div")!;
    expect(row).not.toHaveStyle({ borderLeftWidth: "3px" });
    expect(screen.getByText("const c = 4;")).toBeInTheDocument();
  });

  it("REQ-14/15 (rewritten): forLine renders one chip per finding on the matching line, none elsewhere, no ×N count", () => {
    const onClickA = vi.fn();
    const onClickB = vi.fn();
    const annotations: DiffAnnotationApi = {
      forLine: (path, newNo) =>
        path === smallFile.path && newNo === 3
          ? [
              { key: "chip-crit", severity: "CRITICAL", label: "blocker", title: "Blocker finding", onClick: onClickA },
              { key: "chip-warn", severity: "WARNING", label: "warning", title: "Warning finding", onClick: onClickB },
            ]
          : [],
      orphansFor: () => [],
      headerFor: noop,
    };
    renderViewer([smallFile], annotations);

    const critChip = screen.getByRole("button", { name: "Blocker finding" });
    const warnChip = screen.getByRole("button", { name: "Warning finding" });
    expect(critChip).toHaveTextContent("blocker");
    expect(critChip).not.toHaveTextContent("×");
    expect(warnChip).toHaveTextContent("warning");
    expect(warnChip).not.toHaveTextContent("×");
    expect(screen.getAllByRole("button")).toHaveLength(2);

    // both chips sit on the row for `const c = 4;` (newNo 3), not on `const a = 1;` (newNo 1)
    const targetRow = screen.getByText("const c = 4;").closest("div")!.parentElement!;
    expect(within(targetRow).getAllByRole("button")).toEqual([critChip, warnChip]);
    const otherRow = screen.getByText("const a = 1;").closest("div")!.parentElement!;
    expect(within(otherRow).queryByRole("button")).toBeNull();
  });

  it("REQ-15: clicking an on-line chip fires its own onClick, independent of sibling chips on the same line", () => {
    const onClick = vi.fn();
    const otherClick = vi.fn();
    const annotations: DiffAnnotationApi = {
      forLine: (_path, newNo) =>
        newNo === 3
          ? [
              { key: "chip-1", severity: "WARNING", label: "warning", title: "1 warning finding", onClick },
              { key: "chip-2", severity: "SUGGESTION", label: "suggestion", title: "1 suggestion finding", onClick: otherClick },
            ]
          : [],
      orphansFor: () => [],
      headerFor: noop,
    };
    renderViewer([smallFile], annotations);
    fireEvent.click(screen.getByRole("button", { name: "1 warning finding" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(otherClick).not.toHaveBeenCalled();
  });

  it("REQ-16: orphansFor renders two clickable entries under the file header", () => {
    const onClickA = vi.fn();
    const onClickB = vi.fn();
    const annotations: DiffAnnotationApi = {
      forLine: noLineAnnotations,
      orphansFor: (path) =>
        path === smallFile.path
          ? [
              { key: "o1", severity: "SUGGESTION", label: "not on a visible line", title: "Orphan A", onClick: onClickA },
              { key: "o2", severity: "WARNING", label: "not on a visible line", title: "Orphan B", onClick: onClickB },
            ]
          : [],
      headerFor: noop,
    };
    renderViewer([smallFile], annotations);
    const a = screen.getByRole("button", { name: "Orphan A" });
    const b = screen.getByRole("button", { name: "Orphan B" });
    expect(b).toBeInTheDocument();
    fireEvent.click(a);
    expect(onClickA).toHaveBeenCalledTimes(1);
    expect(onClickB).not.toHaveBeenCalled();
  });

  it("commenting still threads unchanged alongside annotations", () => {
    const commenting: DiffCommentApi = {
      comments: [],
      canComment: true,
      showComments: true,
      posting: false,
      onSubmit: vi.fn(),
    };
    render(
      withProvider(
        <DiffViewer files={[smallFile]} commenting={commenting} />
      )
    );
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
  });
});

describe("FileCard — defaultOpen override (REQ-3, REQ-29)", () => {
  it("REQ-29: a collapsed file (defaultOpen=false) still shows the header indicator, reachable without expanding", () => {
    const onClick = vi.fn();
    const annotations: DiffAnnotationApi = {
      forLine: noLineAnnotations,
      orphansFor: () => [],
      headerFor: (path) =>
        path === smallFile.path
          ? { key: "hdr", severity: "CRITICAL", label: "blocker", title: "Critical finding in this file", onClick }
          : null,
    };
    render(
      withProvider(
        <FileCard file={smallFile} annotations={annotations} defaultOpen={false} />
      )
    );
    // The card is collapsed: no rendered code lines.
    expect(screen.queryByText("const c = 4;")).not.toBeInTheDocument();
    // The mutation this catches: rendering headerFor only inside the open
    // branch — the indicator must be findable while still collapsed.
    const indicator = screen.getByRole("button", { name: "Critical finding in this file" });
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveTextContent("blocker");
  });

  it("defaultOpen={false} collapses a small file the AUTO_EXPAND seed would open", () => {
    render(withProvider(<FileCard file={smallFile} defaultOpen={false} />));
    expect(screen.queryByText("const c = 4;")).not.toBeInTheDocument();
  });

  it("defaultOpen={true} opens a huge file the AUTO_EXPAND seed would collapse", () => {
    const hugeFile: PrFile = { ...smallFile, additions: 4000, deletions: 1000 };
    render(withProvider(<FileCard file={hugeFile} defaultOpen={true} />));
    expect(screen.getByText("const c = 4;")).toBeInTheDocument();
  });
});
