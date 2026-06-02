import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBrief } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import blastMessages from "../../../../../../../../messages/en/blast.json";

const BRIEF: PrBrief = {
  intent: { intent: "Add rate limiting to the public API.", in_scope: ["ratelimit mw"], out_of_scope: ["auth"] },
  blast: {
    changed_symbols: [{ name: "rateLimit", file: "src/mw/ratelimit.ts", kind: "function" }],
    downstream: [],
    summary: "1 changed symbol, no downstream callers.",
  },
  risks: {
    risks: [
      {
        kind: "security",
        title: "Possible secret in diff",
        explanation: "Looks like a hard-coded key.",
        severity: "high",
        file_refs: ["src/mw/ratelimit.ts"],
      },
    ],
  },
  history: {
    history: [
      {
        pr_number: 12,
        title: "Earlier ratelimit tweak",
        merged_at: "2024-01-01T00:00:00.000Z",
        author: "octocat",
        files_overlap: ["src/mw/ratelimit.ts"],
        notes: "Touches 1 of the same file(s).",
      },
    ],
  },
};

vi.mock("../../../../../../../lib/hooks/brief", () => ({
  usePrBrief: () => ({ data: BRIEF, isLoading: false, isError: false, error: undefined }),
}));

import { PrBriefCard } from "./PrBriefCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages, blast: blastMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PrBriefCard (smoke)", () => {
  it("renders translated block titles + risk + history", () => {
    renderWithIntl(<PrBriefCard prId="pr1" />);
    expect(screen.getByText("Intent")).toBeInTheDocument();
    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    expect(screen.getByText("Risks")).toBeInTheDocument();
    expect(screen.getByText("PR history")).toBeInTheDocument();
    expect(screen.getByText("Possible secret in diff")).toBeInTheDocument();
    expect(screen.getByText("Earlier ratelimit tweak")).toBeInTheDocument();
    expect(screen.getByText("1 overlap")).toBeInTheDocument();
  });
});
