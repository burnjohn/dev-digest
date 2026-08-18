import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillStats, SkillVersion } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../lib/toast";

const updateSkill = vi.fn();
const deleteSkill = vi.fn();

const VERSIONS: SkillVersion[] = [
  { skill_id: "s1", version: 2, body: "# Rubric v2", created_at: "2026-08-01T00:00:00Z" },
  { skill_id: "s1", version: 1, body: "# Rubric v1", created_at: "2026-07-01T00:00:00Z" },
];

const STATS: SkillStats = {
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
  findings_by_category: [{ category: "security", count: 8 }],
};

vi.mock("../../../../lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: updateSkill, isPending: false }),
  useDeleteSkill: () => ({ mutate: deleteSkill, isPending: false }),
  useSkillVersions: () => ({ data: VERSIONS, isLoading: false, isError: false, refetch: vi.fn() }),
  useSkillStats: () => ({ data: STATS, isLoading: false, isError: false, refetch: vi.fn() }),
  useSkillAgentIds: () => ({ data: { agent_ids: ["ag1"] } }),
}));

vi.mock("../../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: [{ id: "ag1", name: "Security Reviewer" }] }),
}));

import { SkillDetail } from "./SkillDetail";

afterEach(() => {
  cleanup();
  updateSkill.mockClear();
  deleteSkill.mockClear();
});

const SKILL: Skill = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "Use when scoring a PR.",
  type: "rubric",
  source: "manual",
  body: "# Rubric\n\nScore honestly.",
  enabled: true,
  version: 2,
  evidence_files: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("SkillDetail", () => {
  it("renders the header with type and version badges", () => {
    // Rendered on the Preview tab rather than Config: Config's own type
    // <select> has a "rubric" option, which would collide with the header's
    // type badge text.
    renderWithIntl(<SkillDetail skill={SKILL} tab="preview" onTab={() => {}} />);
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
  });

  it("shows a disabled badge for a disabled skill", () => {
    renderWithIntl(<SkillDetail skill={{ ...SKILL, enabled: false }} tab="preview" onTab={() => {}} />);
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("defaults to the Config tab", () => {
    renderWithIntl(<SkillDetail skill={SKILL} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("renders the Preview tab's rendered body", () => {
    renderWithIntl(<SkillDetail skill={SKILL} tab="preview" onTab={() => {}} />);
    expect(screen.getByText("Rendered as the reviewing agent receives it.")).toBeInTheDocument();
    expect(screen.getByText("Score honestly.")).toBeInTheDocument();
  });

  it("renders the Evals placeholder", () => {
    renderWithIntl(<SkillDetail skill={SKILL} tab="evals" onTab={() => {}} />);
    expect(screen.getByText("Evals arrive with their own lesson")).toBeInTheDocument();
  });

  it("renders the Stats tiles", () => {
    renderWithIntl(<SkillDetail skill={SKILL} tab="stats" onTab={() => {}} />);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    // MetricCard renders the value and the "%" suffix as sibling text nodes,
    // not one concatenated string.
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("PULL FREQUENCY")).toBeInTheDocument();
  });

  it("renders the Versions list with the current one marked", () => {
    renderWithIntl(<SkillDetail skill={SKILL} tab="versions" onTab={() => {}} />);
    // "v2" appears twice: once in the detail header (always rendered) and once
    // in its own Versions row.
    expect(screen.getAllByText("v2")).toHaveLength(2);
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("current")).toBeInTheDocument();
  });

  it("calls onTab when a different tab is clicked", () => {
    const onTab = vi.fn();
    renderWithIntl(<SkillDetail skill={SKILL} tab="config" onTab={onTab} />);
    fireEvent.click(screen.getByText("Stats"));
    expect(onTab).toHaveBeenCalledWith("stats");
  });
});
