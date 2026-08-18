import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";
// SkillRow renders the skill TYPE from the `skills` namespace, so both are
// needed — otherwise next-intl falls back to the key path and the test still
// passes while the UI would show `skills.listItem.type.rubric`.
import skillMessages from "../../../../../../../../messages/en/skills.json";

const setSkills = vi.fn();

const SKILLS: Skill[] = [
  {
    id: "s1",
    name: "pr-quality-rubric",
    description: "Use when scoring a PR.",
    type: "rubric",
    source: "manual",
    body: "# Rubric",
    enabled: true,
    version: 1,
    evidence_files: null,
  },
  {
    id: "s2",
    name: "secret-leakage-gate",
    description: "Use when a diff touches config.",
    type: "security",
    source: "community",
    body: "# Gate",
    enabled: true,
    version: 2,
    evidence_files: null,
  },
  {
    id: "s3",
    name: "no-then-chains",
    description: "Use when a diff adds promise chains.",
    type: "convention",
    source: "manual",
    body: "# Chains",
    enabled: false,
    version: 1,
    evidence_files: null,
  },
];

const LINKS: AgentSkillLink[] = [{ agent_id: "ag1", skill_id: "s2", order: 0 }];

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentSkills: () => ({ data: LINKS }),
  useSetAgentSkills: () => ({ mutate: setSkills, isPending: false }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SkillsTab } from "./SkillsTab";

afterEach(() => {
  cleanup();
  setSkills.mockClear();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "sys",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

/** Visual row order, read off the list items. */
function rowNames(): string[] {
  return screen
    .getAllByRole("listitem")
    .map((row) => row.getAttribute("aria-label") ?? "");
}

/** Click the checkbox of the row for `name`. */
function tick(name: string) {
  const row = screen.getByRole("listitem", { name });
  fireEvent.click(within(row).getByRole("checkbox"));
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages, skills: skillMessages }}>
      <SkillsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

describe("SkillsTab", () => {
  it("lists every workspace skill and counts the attached ones", () => {
    renderTab();
    expect(screen.getByText("1 of 3 enabled")).toBeInTheDocument();
    expect(rowNames().sort()).toEqual(SKILLS.map((sk) => sk.name).sort());
  });

  it("renders the translated type label, not the raw enum", () => {
    renderTab();
    const row = screen.getByRole("listitem", { name: "secret-leakage-gate" });
    expect(within(row).getByText("security")).toBeInTheDocument();
  });

  it("shows the attached skill first, ahead of the alphabetical rest", () => {
    renderTab();
    // Rows are addressed as list items, not by matching their names anywhere in
    // the tree — the name also appears in the drag handle's label.
    expect(rowNames()).toEqual(["secret-leakage-gate", "no-then-chains", "pr-quality-rubric"]);
  });

  it("ticking a skill sends the new attached set in visual order", () => {
    renderTab();
    // s1 is last in the visual order, so attaching it must append it.
    tick("pr-quality-rubric");
    expect(setSkills).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["s2", "s1"] });
  });

  it("unticking the attached skill sends an empty set", () => {
    renderTab();
    tick("secret-leakage-gate");
    expect(setSkills).toHaveBeenCalledWith({ agentId: "ag1", skillIds: [] });
  });

  it("turns reordering off while a filter narrows the list", () => {
    renderTab();
    const handles = screen.getAllByRole("button", { name: /^Reorder / });
    expect(handles.every((h) => !(h as HTMLButtonElement).disabled)).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Filter skills…"), {
      target: { value: "secret" },
    });

    expect(screen.getByText("Clear the filter to reorder.")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /^Reorder / }).every((h) => (h as HTMLButtonElement).disabled),
    ).toBe(true);
  });
});
