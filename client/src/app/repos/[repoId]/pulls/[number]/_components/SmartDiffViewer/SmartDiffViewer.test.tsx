import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SmartDiff } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import messages from "../../../../../../../../messages/en/smartDiff.json";
// FileCard (rendered under SmartDiffViewer) reads the `shell` namespace for
// its "no diff text" empty state.
import shellMessages from "../../../../../../../../messages/en/shell.json";

let smartDiff: SmartDiff | undefined;

vi.mock("@/lib/hooks/reviews", () => ({
  useSmartDiff: () => ({ data: smartDiff, isLoading: false, error: null }),
}));

import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

// jsdom has no layout, so scrollIntoView doesn't exist — stub it so the
// "jump to finding" click handler doesn't throw, and so we can assert it ran.
const scrollIntoView = vi.fn();
beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

const CORE_PATCH = "@@ -8,1 +10,1 @@\n+business logic line";

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/a.ts",
          pseudocode_summary: null,
          additions: 250, // > AUTO_EXPAND_MAX_LINES, so it starts collapsed
          deletions: 0,
          findings: [{ line: 10, severity: "CRITICAL" }],
        },
      ],
    },
    {
      role: "wiring",
      files: [
        { path: "vitest.config.ts", pseudocode_summary: null, additions: 2, deletions: 0, findings: [] },
      ],
    },
    {
      role: "boilerplate",
      files: [
        { path: "pnpm-lock.yaml", pseudocode_summary: null, additions: 3, deletions: 0, findings: [] },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 255, proposed_splits: [] },
};

const REAL_FILES: PrFile[] = [
  { path: "src/a.ts", additions: 250, deletions: 0, patch: CORE_PATCH },
  { path: "vitest.config.ts", additions: 2, deletions: 0, patch: "@@ -1,1 +1,2 @@\n+export default {}" },
  { path: "pnpm-lock.yaml", additions: 3, deletions: 0, patch: "@@ -1,1 +1,3 @@\n+lockfileVersion: 6" },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ smartDiff: messages, shell: shellMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SmartDiffViewer", () => {
  it("renders groups in core → wiring → boilerplate order", () => {
    smartDiff = SMART_DIFF;
    const { container } = renderWithIntl(<SmartDiffViewer prId="pr1" files={REAL_FILES} />);
    const text = container.textContent ?? "";
    const coreIdx = text.indexOf("Core logic");
    const wiringIdx = text.indexOf("Wiring");
    const boilerplateIdx = text.indexOf("Boilerplate");
    expect(coreIdx).toBeGreaterThanOrEqual(0);
    expect(coreIdx).toBeLessThan(wiringIdx);
    expect(wiringIdx).toBeLessThan(boilerplateIdx);
  });

  it("starts the boilerplate group collapsed", () => {
    smartDiff = SMART_DIFF;
    renderWithIntl(<SmartDiffViewer prId="pr1" files={REAL_FILES} />);
    const boilerplateHeader = screen.getByRole("button", { name: /Boilerplate/ });
    expect(boilerplateHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();

    fireEvent.click(boilerplateHeader);
    expect(boilerplateHeader).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });

  it("shows the findings count + severity badge on a file with findings", () => {
    smartDiff = SMART_DIFF;
    renderWithIntl(<SmartDiffViewer prId="pr1" files={REAL_FILES} />);
    expect(screen.getByText("1 findings")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("L10")).toBeInTheDocument();
  });

  it("clicking a finding scrolls to + highlights the line and expands the file if collapsed", () => {
    smartDiff = SMART_DIFF;
    renderWithIntl(<SmartDiffViewer prId="pr1" files={REAL_FILES} />);

    // src/a.ts is a `core` file with 250 additions ⇒ starts collapsed.
    expect(screen.queryByText("business logic line")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("L10"));

    // Auto-expanded: the line is now rendered.
    expect(screen.getByText("business logic line")).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
