import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { SkillCard } from "./SkillCard";

afterEach(cleanup);

const SKILL: Skill = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "Use when scoring a PR.",
  type: "rubric",
  source: "manual",
  body: "# Rubric",
  enabled: true,
  version: 5,
  evidence_files: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ skills: messages }}>{ui}</NextIntlClientProvider>);
}

describe("SkillCard", () => {
  it("renders the name, description and type/source badges", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("Use when scoring a PR.")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("badges a skill from an untrusted source as needing vetting", () => {
    renderWithIntl(<SkillCard skill={{ ...SKILL, source: "community" }} />);
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
  });

  it("does not show the vetting badge for a manually-authored skill", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });

  it("fires onClick when the row is clicked", () => {
    const onClick = vi.fn();
    renderWithIntl(<SkillCard skill={SKILL} onClick={onClick} />);
    fireEvent.click(screen.getByText("pr-quality-rubric"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("fires onToggle without also firing onClick", () => {
    const onClick = vi.fn();
    const onToggle = vi.fn();
    renderWithIntl(<SkillCard skill={SKILL} onClick={onClick} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders no usage footer when the skill has never been used", () => {
    renderWithIntl(<SkillCard skill={SKILL} />);
    expect(screen.queryByText(/agent/)).not.toBeInTheDocument();
  });

  it("renders the usage footer once the skill is attached and has run", () => {
    renderWithIntl(
      <SkillCard skill={{ ...SKILL, used_by_agents: 3, pull_rate: 0.71, accept_rate: 0.744 }} />,
    );
    expect(screen.getByText("3 agents · 71% pull · 74% accept")).toBeInTheDocument();
  });

  it("shows only the pieces of the footer that are known", () => {
    // Attached, but no runs yet — pull_rate/accept_rate are null, not 0.
    renderWithIntl(<SkillCard skill={{ ...SKILL, used_by_agents: 1, pull_rate: null, accept_rate: null }} />);
    expect(screen.getByText("1 agent")).toBeInTheDocument();
  });
});
