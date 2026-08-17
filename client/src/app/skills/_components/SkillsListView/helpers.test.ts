import { describe, it, expect } from "vitest";
import { filterSkills } from "./helpers";
import type { SkillListItem } from "@devdigest/shared";

describe("filterSkills", () => {
  const base: Omit<SkillListItem, "id" | "name" | "description" | "type"> = {
    source: "manual",
    body: "SECRET BODY TEXT",
    enabled: true,
    version: 1,
    evidence_files: null,
    used_by: 0,
  };
  const skills: SkillListItem[] = [
    { ...base, id: "1", name: "uncovered-branch-gate", description: "Flags branches", type: "rubric" },
    { ...base, id: "2", name: "flaky-test-patterns", description: "Sleeps and clocks", type: "custom" },
  ];

  it("returns everything for a blank query", () => {
    expect(filterSkills(skills, "  ")).toHaveLength(2);
  });

  it("matches name, description and type", () => {
    expect(filterSkills(skills, "BRANCH")).toHaveLength(1);
    expect(filterSkills(skills, "clocks")).toHaveLength(1);
    expect(filterSkills(skills, "rubric")).toHaveLength(1);
  });

  it("does NOT match on the body — an invisible match reads as a broken filter", () => {
    expect(filterSkills(skills, "SECRET BODY")).toEqual([]);
  });
});
