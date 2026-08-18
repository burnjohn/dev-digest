import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillStats } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";

let stats: SkillStats | undefined;

vi.mock("../../../../../../lib/hooks/skills", () => ({
  useSkillStats: () => ({ data: stats, isLoading: false, isError: false, refetch: vi.fn() }),
  useSkillAgentIds: () => ({ data: { agent_ids: ["ag1", "ag2"] } }),
}));

vi.mock("../../../../../../lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [
      { id: "ag1", name: "Security Reviewer" },
      { id: "ag2", name: "Performance Reviewer" },
    ],
  }),
}));

import { StatsTab } from "./StatsTab";

afterEach(cleanup);

const SKILL: Skill = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "Use when scoring a PR.",
  type: "rubric",
  source: "manual",
  body: "# Rubric",
  enabled: true,
  version: 1,
  evidence_files: null,
};

const BASE_STATS: SkillStats = {
  skill_id: "s1",
  skill_name: "pr-quality-rubric",
  window_days: 30,
  used_by_agents: 2,
  runs_with_skill: 5,
  runs_total: 10,
  pull_rate: 0.5,
  findings_total: 8,
  accepted: 4,
  dismissed: 2,
  pending: 2,
  accept_rate: 4 / 6,
  findings_by_category: [
    { category: "security", count: 5 },
    { category: "bug", count: 3 },
  ],
};

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ skills: messages }}>{ui}</NextIntlClientProvider>);
}

describe("StatsTab", () => {
  it("renders the tile values and labels", () => {
    stats = BASE_STATS;
    renderWithIntl(<StatsTab skill={SKILL} />);
    expect(screen.getByText("USED BY")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("PULL FREQUENCY")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("FINDINGS (30D)")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    // Accept rate renders inside the CircularScore ring, rounded to a percent.
    expect(screen.getByText("67")).toBeInTheDocument();
  });

  it("shows — instead of NaN when a skill has never run", () => {
    stats = {
      ...BASE_STATS,
      runs_with_skill: 0,
      runs_total: 0,
      pull_rate: null,
      findings_total: 0,
      accepted: 0,
      dismissed: 0,
      pending: 0,
      accept_rate: null,
      findings_by_category: [],
    };
    renderWithIntl(<StatsTab skill={SKILL} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2); // pull rate + accept rate
    expect(screen.getByText("No findings yet in this window.")).toBeInTheDocument();
  });

  it("lists the agents using this skill, cross-referenced by name", () => {
    stats = BASE_STATS;
    renderWithIntl(<StatsTab skill={SKILL} />);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Performance Reviewer")).toBeInTheDocument();
    expect(screen.getAllByText("Open")).toHaveLength(2);
  });

  it("renders the findings-by-category legend with real counts", () => {
    stats = BASE_STATS;
    renderWithIntl(<StatsTab skill={SKILL} />);
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
