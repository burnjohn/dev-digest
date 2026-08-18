import { describe, it, expect } from "vitest";
import type { AgentSkillLink, Skill } from "@devdigest/shared";
import { arrangeSkills, attachedIdsInOrder, filterSkills, moveItem } from "./helpers";

/**
 * The Skills tab's ordering logic. Drag interactions themselves are close to
 * untestable under jsdom, so this is where the behaviour that matters — what
 * order the prompt blocks end up in — is actually pinned.
 */

const skill = (id: string, name: string, over: Partial<Skill> = {}): Skill => ({
  id,
  name,
  description: `Use when ${name}.`,
  type: "rubric",
  source: "manual",
  body: `# ${name}`,
  enabled: true,
  version: 1,
  evidence_files: null,
  ...over,
});

const link = (skill_id: string, order: number): AgentSkillLink => ({
  agent_id: "ag1",
  skill_id,
  order,
});

describe("arrangeSkills", () => {
  it("puts attached skills first in link order, then the rest alphabetically", () => {
    const skills = [skill("a", "alpha"), skill("b", "bravo"), skill("c", "charlie"), skill("d", "delta")];
    const links = [link("c", 0), link("a", 1)];
    expect(arrangeSkills(skills, links).map((s) => s.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("sorts alphabetically when nothing is attached", () => {
    const skills = [skill("c", "charlie"), skill("a", "alpha")];
    expect(arrangeSkills(skills, []).map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("ignores a link whose skill no longer exists", () => {
    // A deleted skill cascades out of agent_skills, but a cached link list can
    // still name it for one render.
    const skills = [skill("a", "alpha")];
    expect(arrangeSkills(skills, [link("gone", 0), link("a", 1)]).map((s) => s.id)).toEqual(["a"]);
  });

  it("respects link order even when it disagrees with the alphabet", () => {
    const skills = [skill("a", "alpha"), skill("z", "zulu")];
    expect(arrangeSkills(skills, [link("z", 0), link("a", 1)]).map((s) => s.id)).toEqual(["z", "a"]);
  });
});

describe("moveItem", () => {
  it("moves an item down", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("moves an item up", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("returns the same array for a no-op or an out-of-range index", () => {
    const list = ["a", "b"];
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, -1, 0)).toBe(list);
    expect(moveItem(list, 0, 5)).toBe(list);
  });

  it("does not mutate the input", () => {
    const list = ["a", "b", "c"];
    moveItem(list, 0, 2);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("attachedIdsInOrder", () => {
  it("keeps only attached skills, in visual order", () => {
    const ordered = [skill("c", "charlie"), skill("a", "alpha"), skill("b", "bravo")];
    expect(attachedIdsInOrder(ordered, new Set(["a", "c"]))).toEqual(["c", "a"]);
  });

  it("is empty when nothing is attached — a valid payload that detaches everything", () => {
    expect(attachedIdsInOrder([skill("a", "alpha")], new Set())).toEqual([]);
  });

  it("picks up a skill dragged above the attached ones before it is ticked", () => {
    // Drag-then-tick has to land the skill where the user dropped it, not at the
    // end — this is why order is computed from the visual list, not the links.
    const ordered = [skill("new", "new-rule"), skill("a", "alpha")];
    expect(attachedIdsInOrder(ordered, new Set(["a", "new"]))).toEqual(["new", "a"]);
  });
});

describe("filterSkills", () => {
  it("matches name, description and type, case-insensitively", () => {
    const skills = [
      skill("a", "secret-gate", { type: "security" }),
      skill("b", "rubric-one", { description: "Use when scoring." }),
    ];
    expect(filterSkills(skills, "SECURITY").map((s) => s.id)).toEqual(["a"]);
    expect(filterSkills(skills, "scoring").map((s) => s.id)).toEqual(["b"]);
    expect(filterSkills(skills, "   ")).toHaveLength(2);
  });
});
