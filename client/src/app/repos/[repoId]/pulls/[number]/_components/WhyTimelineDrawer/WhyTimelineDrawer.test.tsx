import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { WhyTimeline } from "@devdigest/shared/contracts/why";
import messages from "../../../../../../../../messages/en/brief.json";

const TIMELINE: WhyTimeline = {
  file: "src/mw/ratelimit.ts",
  line: 23,
  blame: {
    sha: "abcdef1234567890",
    summary: "Add rate limiting (#42)",
    author: "octocat",
    date: "2024-01-02",
    pr_number: 42,
    is_blame_head: true,
  },
  events: [],
  summary: "src/mw/ratelimit.ts:23 was last shaped by 'Add rate limiting' by octocat (PR #42).",
};

vi.mock("../../../../../../../lib/hooks/brief", () => ({
  usePrWhy: () => ({ data: TIMELINE, isLoading: false, isError: false, error: undefined }),
}));
vi.mock("@devdigest/ui", async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...actual,
    Drawer: ({ children, title, subtitle }: { children: React.ReactNode; title: React.ReactNode; subtitle: React.ReactNode }) => (
      <div>
        <div>{title}</div>
        <div>{subtitle}</div>
        {children}
      </div>
    ),
  };
});

import { WhyTimelineDrawer } from "./WhyTimelineDrawer";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("WhyTimelineDrawer (smoke)", () => {
  it("returns null when there is no location", () => {
    const { container } = renderWithIntl(
      <WhyTimelineDrawer prId="pr1" location={null} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the blame event + title when a location is set", () => {
    renderWithIntl(
      <WhyTimelineDrawer prId="pr1" location={{ file: "src/mw/ratelimit.ts", line: 23 }} onClose={() => {}} />,
    );
    expect(screen.getByText("git-why")).toBeInTheDocument();
    expect(screen.getByText("Add rate limiting (#42)")).toBeInTheDocument();
    expect(screen.getByText("blame")).toBeInTheDocument();
  });
});
