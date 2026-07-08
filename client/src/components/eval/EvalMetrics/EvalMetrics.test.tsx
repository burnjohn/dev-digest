import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import agentsMessages from "../../../../messages/en/agents.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { EvalMetrics } from "./EvalMetrics";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("EvalMetrics", () => {
  it("clicking 'View full dashboard' navigates to the agent's dashboard detail page when agentId is provided", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <EvalMetrics
        recall={0.9}
        precision={0.85}
        citation={0.95}
        delta={undefined}
        tracesPassed={4}
        tracesTotal={5}
        agentId="ag1"
      />,
    );

    await user.click(screen.getByRole("button", { name: "View full dashboard" }));
    expect(push).toHaveBeenCalledWith("/evals/ag1");
  });

  it("falls back to the workspace-wide landing page when agentId is not provided", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <EvalMetrics recall={0.9} precision={0.85} citation={0.95} delta={undefined} tracesPassed={4} tracesTotal={5} />,
    );

    await user.click(screen.getByRole("button", { name: "View full dashboard" }));
    expect(push).toHaveBeenCalledWith("/evals");
  });
});
