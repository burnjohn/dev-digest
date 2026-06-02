import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/eval.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../../../../eval/_components/EvalDashboard", () => ({
  EvalDashboard: () => <div>eval-dashboard</div>,
}));

const CASES = [
  {
    id: "c1", workspace_id: "w1", owner_kind: "agent", owner_id: "a1", name: "stripe-key-leak",
    last_run: { pass: true, recall: 0.9 },
  },
];

vi.mock("../../../../../lib/hooks/eval", () => ({
  useEvalCases: () => ({ data: CASES, isLoading: false }),
  useRunEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEvalCase: () => ({ mutate: vi.fn() }),
}));

import { AgentEvalsTab } from "./AgentEvalsTab";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("AgentEvalsTab (smoke)", () => {
  it("renders the cases heading + an eval case row", () => {
    renderWithIntl(<AgentEvalsTab agentId="a1" />);
    expect(screen.getByText("Eval cases")).toBeInTheDocument();
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText(/passed/)).toBeInTheDocument();
  });
});
