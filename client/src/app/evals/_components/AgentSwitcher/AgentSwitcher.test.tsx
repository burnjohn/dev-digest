import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { EvalAgentSummary } from "@devdigest/shared";
import evalsMessages from "../../../../../messages/en/evals.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { AgentSwitcher } from "./AgentSwitcher";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ evals: evalsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function makeSummary(overrides: Partial<EvalAgentSummary> = {}): EvalAgentSummary {
  return {
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    model: "gpt-4.1",
    latest_batch: null,
    latest_version: null,
    sparkline_points: [],
    case_count: 3,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("AgentSwitcher", () => {
  it("shows the active agent's name in the trigger", () => {
    renderWithIntl(<AgentSwitcher agentId="ag1" agents={[makeSummary()]} />);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
  });

  it("selecting a different agent navigates via router.push, no full reload (AC-16)", async () => {
    const user = userEvent.setup();
    const agents = [makeSummary(), makeSummary({ agent_id: "ag2", agent_name: "Style Reviewer" })];
    renderWithIntl(<AgentSwitcher agentId="ag1" agents={agents} />);

    await user.click(screen.getByText("Security Reviewer"));
    await user.click(screen.getByText("Style Reviewer"));

    expect(push).toHaveBeenCalledWith("/evals/ag2");
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("selecting the currently active agent does not navigate", async () => {
    const user = userEvent.setup();
    renderWithIntl(<AgentSwitcher agentId="ag1" agents={[makeSummary()]} />);

    // Open the dropdown via the trigger, then click the (only, active) item.
    const triggerLabels = screen.getAllByText("Security Reviewer");
    await user.click(triggerLabels[0]!);
    const itemLabels = screen.getAllByText("Security Reviewer");
    await user.click(itemLabels[itemLabels.length - 1]!);

    expect(push).not.toHaveBeenCalled();
  });
});
