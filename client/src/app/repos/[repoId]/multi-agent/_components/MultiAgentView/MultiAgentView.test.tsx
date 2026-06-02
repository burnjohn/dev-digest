import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRun } from "@devdigest/shared/contracts/observability";
import messages from "../../../../../../../messages/en/runs.json";
import { MultiAgentView } from "./MultiAgentView";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

const RUN: MultiAgentRun = {
  id: "mar1",
  pr_id: "pr1",
  pr_number: 482,
  ran_at: new Date().toISOString(),
  agent_count: 2,
  total_duration_ms: 15600,
  total_cost_usd: 0.11,
  columns: [
    {
      run_id: "r1",
      agent_id: "a1",
      agent_name: "Security",
      provider: "openai",
      model: "gpt-4.1",
      status: "done",
      verdict: "request_changes",
      score: 38,
      summary: "Two critical exposures. Block.",
      duration_ms: 8200,
      cost_usd: 0.06,
      findings: [
        { id: "f1", severity: "CRITICAL", category: "security", title: "Hardcoded secret", file: "src/config.ts", start_line: 11, kind: "finding" },
      ],
    },
    {
      run_id: "r2",
      agent_id: "a2",
      agent_name: "Performance",
      provider: "openai",
      model: "gpt-4.1",
      status: "done",
      verdict: "comment",
      score: 64,
      summary: "N+1 will bite under the limiter.",
      duration_ms: 7400,
      cost_usd: 0.05,
      findings: [
        { id: "f2", severity: "SUGGESTION", category: "perf", title: "Pipeline Redis calls", file: "src/ratelimit.ts", start_line: 27, kind: "finding" },
      ],
    },
  ],
  conflicts: [
    {
      file: "src/ratelimit.ts",
      line: 28,
      title: "Magic number 3600",
      takes: [
        { agent_id: "a1", persona: "Security", verdict: "ignored", note: "Not a security concern." },
        { agent_id: "a2", persona: "Performance", verdict: "SUGGESTION", note: "Extract for readability." },
      ],
    },
  ],
};

describe("A5 Multi-Agent Review (smoke)", () => {
  it("renders N agent columns + conflicts in columns view", () => {
    renderWithIntl(<MultiAgentView run={RUN} view="columns" />);
    expect(screen.getAllByText("Security").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Performance").length).toBeGreaterThan(0);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    // conflict section
    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();
    expect(screen.getByText("Magic number 3600")).toBeInTheDocument();
    expect(screen.getByText("did not flag")).toBeInTheDocument();
  });

  it("renders per-agent tabs in tabs view", () => {
    renderWithIntl(<MultiAgentView run={RUN} view="tabs" selectedAgent={0} />);
    expect(screen.getByText("Two critical exposures. Block.")).toBeInTheDocument();
  });

  it("hides columns when onlyConflicts is on", () => {
    renderWithIntl(<MultiAgentView run={RUN} view="columns" onlyConflicts />);
    // The finding mini-card title should not be present when columns are hidden.
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    expect(screen.getByText("Magic number 3600")).toBeInTheDocument();
  });
});
