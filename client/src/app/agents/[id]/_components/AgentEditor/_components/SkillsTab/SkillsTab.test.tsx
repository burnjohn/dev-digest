import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillDetail, SkillSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";
import { ToastProvider } from "../../../../../../../lib/toast";
import { buildRows, countActive, detachRow, moveRow, toPayload, toggleRow } from "./helpers";

const setSkills = vi.fn();

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentSkills: () => ({ data: LINKED, isLoading: false, isError: false }),
  useSetAgentSkills: () => ({ mutate: setSkills, isPending: false }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SkillsTab } from "./SkillsTab";

const skill = (id: string, name: string, over: Partial<SkillSummary> = {}): SkillSummary => ({
  id,
  name,
  description: `${name} description`,
  type: "rubric",
  source: "manual",
  body: `# ${name}`,
  enabled: true,
  version: 1,
  evidence_files: null,
  used_by: 1,
  ...over,
});

const SKILLS: SkillSummary[] = [
  skill("s1", "alpha"),
  skill("s2", "beta"),
  skill("s3", "gamma"),
  skill("s4", "delta", { enabled: false }),
];

const LINKED: AgentSkillDetail[] = [
  { ...skill("s1", "alpha"), order: 0, link_enabled: true },
  { ...skill("s2", "beta"), order: 1, link_enabled: false },
];

const AGENT: Agent = {
  id: "ag1",
  name: "Test Quality Reviewer",
  description: "Reviews tests",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "Review the tests.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>
        <SkillsTab agent={AGENT} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => setSkills.mockClear());

describe("SkillsTab helpers", () => {
  it("puts linked skills first in link order, then the rest alphabetically", () => {
    const rows = buildRows(SKILLS, LINKED);
    expect(rows.map((r) => r.name)).toEqual(["alpha", "beta", "delta", "gamma"]);
    expect(rows[0]).toMatchObject({ linked: true, enabled: true });
    // Attached but switched off — still linked, so it keeps its position.
    expect(rows[1]).toMatchObject({ linked: true, enabled: false });
    expect(rows[2]).toMatchObject({ linked: false, enabled: false });
  });

  it("counts only skills that would actually reach the prompt", () => {
    const rows = buildRows(SKILLS, [
      { ...skill("s1", "alpha"), order: 0, link_enabled: true },
      // Linked and switched on, but the skill itself is globally disabled.
      { ...skill("s4", "delta", { enabled: false }), order: 1, link_enabled: true },
    ]);
    expect(countActive(rows)).toBe(1);
  });

  it("checking an unlinked skill attaches it; unchecking keeps it attached", () => {
    const rows = buildRows(SKILLS, LINKED);
    expect(toggleRow(rows, "s3", true).find((r) => r.id === "s3")).toMatchObject({
      linked: true,
      enabled: true,
    });
    expect(toggleRow(rows, "s1", false).find((r) => r.id === "s1")).toMatchObject({
      linked: true,
      enabled: false,
    });
  });

  it("detaching drops the skill from the payload entirely", () => {
    const rows = detachRow(buildRows(SKILLS, LINKED), "s1");
    expect(toPayload(rows).map((p) => p.skill_id)).toEqual(["s2"]);
  });

  it("moveRow reorders and is a no-op at the edges", () => {
    const rows = buildRows(SKILLS, LINKED);
    expect(moveRow(rows, 1, 0).map((r) => r.name)).toEqual(["beta", "alpha", "delta", "gamma"]);
    expect(moveRow(rows, 0, -1)).toBe(rows);
  });

  it("the payload carries only attached skills, in row order, with their switch", () => {
    expect(toPayload(buildRows(SKILLS, LINKED))).toEqual([
      { skill_id: "s1", enabled: true },
      { skill_id: "s2", enabled: false },
    ]);
  });
});

describe("SkillsTab", () => {
  it("lists every workspace skill and counts the active ones", () => {
    renderTab();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("gamma")).toBeInTheDocument();
    // 1 of 4: beta is attached-but-off, gamma/delta are unattached.
    expect(screen.getByText("1 of 4 enabled")).toBeInTheDocument();
  });

  it("ticking a skill saves the whole ordered set with that skill attached", () => {
    renderTab();
    const row = screen.getByTestId("skill-row-gamma");
    fireEvent.click(within(row).getByRole("checkbox"));

    expect(setSkills).toHaveBeenCalledTimes(1);
    expect(setSkills.mock.calls[0]![0]).toEqual({
      agentId: "ag1",
      skills: [
        { skill_id: "s1", enabled: true },
        { skill_id: "s2", enabled: false },
        { skill_id: "s3", enabled: true },
      ],
    });
  });

  it("moving a skill up saves the new order", () => {
    renderTab();
    const row = screen.getByTestId("skill-row-beta");
    fireEvent.click(within(row).getByLabelText("Move beta up"));

    expect(setSkills.mock.calls[0]![0].skills).toEqual([
      { skill_id: "s2", enabled: false },
      { skill_id: "s1", enabled: true },
    ]);
  });

  it("detaching a skill removes it from the saved set", () => {
    renderTab();
    const row = screen.getByTestId("skill-row-alpha");
    fireEvent.click(within(row).getByLabelText("Detach alpha"));

    expect(setSkills.mock.calls[0]![0].skills).toEqual([{ skill_id: "s2", enabled: false }]);
  });

  it("hides the reorder controls while a filter is applied", () => {
    renderTab();
    expect(screen.getByLabelText("Move beta up")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter skills…"), { target: { value: "alph" } });
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Move alpha down")).not.toBeInTheDocument();
  });
});
