import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrDetail } from "@/lib/types";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: [{ id: "a1", name: "Security", model: "gpt-4.1", enabled: true }] }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../../../../../../../lib/hooks/multi-agent", () => ({
  useAgentRunEstimates: () => ({ data: [] }),
  useStartMultiAgentRun: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { PrDetailHeader } from "./PrDetailHeader";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const BASE_PR = {
  id: "pr-1",
  number: 482,
  title: "Add rate limiting",
  author: "marisa.koch",
  branch: "feat/rate-limit",
  base: "main",
  head_sha: "a1b2c3d4",
  additions: 42,
  deletions: 5,
  files_count: 3,
  status: "open",
  opened_at: null,
  updated_at: null,
  body: null,
  files: [],
  commits: [],
  linked_issue: null,
} as unknown as PrDetail;

describe("PrDetailHeader — no confidence badge (specs/05-intent-layer.md revision 2)", () => {
  it("renders the PR title/status without any Intent confidence badge, even when intent is populated", () => {
    renderWithIntl(
      <PrDetailHeader
        pr={{ ...BASE_PR, intent: "Adds rate limiting to the public API endpoints." } as PrDetail}
        prId="pr-1"
        repoId="repo-1"
        tab="overview"
        runsCount={0}
        onSetTab={() => {}}
        onRunStart={() => {}}
        onRunsStarted={() => {}}
      />,
    );
    expect(screen.getByText("Add rate limiting")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    // v1's confidence-colored "Intent: <level>" badge must be gone entirely —
    // no confidence value exists to color it by any more.
    expect(screen.queryByText(/Intent:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/high|medium|low/i)).not.toBeInTheDocument();
  });

  it("still shows no Intent badge when intent is absent (pre-review state)", () => {
    renderWithIntl(
      <PrDetailHeader
        pr={BASE_PR}
        prId="pr-1"
        repoId="repo-1"
        tab="overview"
        runsCount={0}
        onSetTab={() => {}}
        onRunStart={() => {}}
        onRunsStarted={() => {}}
      />,
    );
    expect(screen.queryByText(/Intent:/)).not.toBeInTheDocument();
  });
});

describe("PrDetailHeader — AC-68 resume affordance", () => {
  it("shows no multi-agent-results affordance when the PR has no multi-agent run", () => {
    renderWithIntl(
      <PrDetailHeader
        pr={BASE_PR}
        prId="pr-1"
        repoId="repo-1"
        tab="overview"
        runsCount={0}
        onSetTab={() => {}}
        onRunStart={() => {}}
        onRunsStarted={() => {}}
      />,
    );
    expect(screen.queryByText("Multi-agent results")).not.toBeInTheDocument();
  });

  it("shows a direct, navigation-only affordance when this PR already has a multi-agent run", () => {
    const onOpenMultiAgent = vi.fn();
    renderWithIntl(
      <PrDetailHeader
        pr={BASE_PR}
        prId="pr-1"
        repoId="repo-1"
        tab="overview"
        runsCount={0}
        onSetTab={() => {}}
        onRunStart={() => {}}
        onRunsStarted={() => {}}
        hasMultiAgentRun
        onOpenMultiAgent={onOpenMultiAgent}
      />,
    );
    const button = screen.getByText("Multi-agent results");
    button.click();
    expect(onOpenMultiAgent).toHaveBeenCalledTimes(1);
  });

});

describe("PrDetailHeader — Agent runs tab badge", () => {
  const header = (runsCount: number) => (
    <PrDetailHeader
      pr={BASE_PR}
      prId="pr-1"
      repoId="repo-1"
      tab="overview"
      runsCount={runsCount}
      onSetTab={() => {}}
      onRunStart={() => {}}
      onRunsStarted={() => {}}
    />
  );

  it("badges the tab with the number of runs, not the number of findings", () => {
    renderWithIntl(header(8));
    const tab = screen.getByText("Agent runs").closest("button")!;
    expect(tab).toHaveTextContent("8");
  });

  it("shows no badge when the PR has no runs yet", () => {
    renderWithIntl(header(0));
    const tab = screen.getByText("Agent runs").closest("button")!;
    expect(tab).not.toHaveTextContent(/\d/);
  });
});
