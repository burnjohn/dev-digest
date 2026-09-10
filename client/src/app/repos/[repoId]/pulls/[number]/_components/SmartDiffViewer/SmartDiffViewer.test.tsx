import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@/lib/types";
import type { FindingRecord, SmartDiffGroup } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const FILES: PrFile[] = [
  {
    path: "src/middleware/ratelimit.ts",
    additions: 30,
    deletions: 0,
    patch: "@@ -1,2 +1,3 @@\n+const a = 1;\n+const b = 2;\n context;",
  },
  {
    path: "package-lock.json",
    additions: 92,
    deletions: 24,
    patch: "@@ -1,1 +1,1 @@\n+lockfile change",
  },
];

const GROUPS: SmartDiffGroup[] = [
  {
    role: "core",
    files: [
      {
        path: "src/middleware/ratelimit.ts",
        pseudocode_summary: null,
        additions: 30,
        deletions: 0,
        finding_lines: [2],
      },
    ],
  },
  {
    role: "boilerplate",
    files: [
      {
        path: "package-lock.json",
        pseudocode_summary: null,
        additions: 92,
        deletions: 24,
        finding_lines: [],
      },
    ],
  },
];

const FINDINGS: FindingRecord[] = [
  {
    id: "finding-1",
    file: "src/middleware/ratelimit.ts",
    start_line: 2,
    end_line: 2,
  } as FindingRecord,
];

describe("SmartDiffViewer", () => {
  it("renders groups in core, wiring, boilerplate order", () => {
    renderWithIntl(<SmartDiffViewer files={FILES} groups={GROUPS} />);
    const headings = screen.getAllByText(/Core logic|Boilerplate/);
    expect(headings[0]).toHaveTextContent("Core logic");
    expect(headings[1]).toHaveTextContent("Boilerplate");
  });

  it("keeps a boilerplate file collapsed by default even though it's small", () => {
    renderWithIntl(<SmartDiffViewer files={FILES} groups={GROUPS} />);
    expect(screen.queryByText("lockfile change")).not.toBeInTheDocument();
  });

  it("calls onSelectFinding with the file's earliest finding when a findings badge is clicked", () => {
    const onSelectFinding = vi.fn();
    renderWithIntl(
      <SmartDiffViewer
        files={FILES}
        groups={GROUPS}
        findings={FINDINGS}
        onSelectFinding={onSelectFinding}
      />,
    );
    const badge = screen.getByText(/finding/i);
    fireEvent.click(badge);
    expect(onSelectFinding).toHaveBeenCalledWith("finding-1");
  });

  it("collapses and re-expands a whole group when its header is clicked", () => {
    renderWithIntl(<SmartDiffViewer files={FILES} groups={GROUPS} />);
    const header = screen.getByRole("button", { name: "Core logic" });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("src/middleware/ratelimit.ts")).not.toBeInTheDocument();
    // Other groups are unaffected.
    expect(screen.getByText("package-lock.json")).toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
  });

  it("renders nothing when there are no groups", () => {
    const { container } = renderWithIntl(<SmartDiffViewer files={FILES} groups={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("skips a group's file entry that has no matching entry in files, without crashing", () => {
    const groupsWithMissingFile: SmartDiffGroup[] = [
      {
        role: "core",
        files: [
          {
            path: "src/does-not-exist.ts",
            pseudocode_summary: null,
            additions: 1,
            deletions: 0,
            finding_lines: [],
          },
        ],
      },
    ];
    renderWithIntl(<SmartDiffViewer files={FILES} groups={groupsWithMissingFile} />);
    expect(screen.queryByText("src/does-not-exist.ts")).not.toBeInTheDocument();
  });

  it("does not call onSelectFinding when the findings badge is clicked but no findings prop was passed", () => {
    const onSelectFinding = vi.fn();
    renderWithIntl(
      <SmartDiffViewer files={FILES} groups={GROUPS} onSelectFinding={onSelectFinding} />,
    );
    const badge = screen.getByText(/finding/i);
    fireEvent.click(badge);
    expect(onSelectFinding).not.toHaveBeenCalled();
  });

  it("renders the wiring group between core and boilerplate", () => {
    const groupsWithWiring: SmartDiffGroup[] = [
      GROUPS[0]!,
      {
        role: "wiring",
        files: [
          {
            path: "src/index.ts",
            pseudocode_summary: null,
            additions: 1,
            deletions: 0,
            finding_lines: [],
          },
        ],
      },
      GROUPS[1]!,
    ];
    const filesWithWiring: PrFile[] = [
      ...FILES,
      { path: "src/index.ts", additions: 1, deletions: 0, patch: "@@ -1,0 +1,1 @@\n+export {};" },
    ];
    renderWithIntl(<SmartDiffViewer files={filesWithWiring} groups={groupsWithWiring} />);
    const headings = screen.getAllByText(/Core logic|Wiring|Boilerplate/);
    expect(headings.map((h) => h.textContent)).toEqual(["Core logic", "Wiring", "Boilerplate"]);
  });
});
