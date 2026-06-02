import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SmartDiff, PrFile } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../components/diff-viewer", () => ({
  DiffViewer: () => <div data-testid="diff-viewer" />,
}));

import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [{ path: "src/app.ts", additions: 10, deletions: 2, finding_lines: [3] }],
    },
  ],
  split_suggestion: {
    too_big: true,
    total_lines: 500,
    proposed_splits: [{ name: "core changes", files: ["src/app.ts"] }],
  },
};

const FILES: PrFile[] = [{ path: "src/app.ts", additions: 10, deletions: 2, patch: null }];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SmartDiffViewer (smoke)", () => {
  it("renders the split nudge + a role group", () => {
    renderWithIntl(<SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} />);
    expect(screen.getByText("This PR is large (500 changed lines)")).toBeInTheDocument();
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByTestId("diff-viewer")).toBeInTheDocument();
  });
});
