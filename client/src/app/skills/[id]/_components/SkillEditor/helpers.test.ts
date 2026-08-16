import { describe, it, expect } from "vitest";
import { estimateTokens, lineNumbers, skillFileName } from "./helpers";
import { filterSkills } from "../../../_components/SkillsListView/helpers";
import type { SkillListItem } from "@devdigest/shared";

describe("estimateTokens", () => {
  it("is 0 for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("never reports 0 for non-empty text", () => {
    expect(estimateTokens("a")).toBe(1);
  });

  it("scales at roughly 4 characters per token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("lineNumbers", () => {
  it("gives a single line for empty text, matching the textarea", () => {
    expect(lineNumbers("")).toEqual([1]);
  });

  it("counts lines, not newlines", () => {
    expect(lineNumbers("a\nb\nc")).toEqual([1, 2, 3]);
  });

  it("counts the empty line after a trailing newline", () => {
    expect(lineNumbers("a\n")).toEqual([1, 2]);
  });
});

describe("skillFileName", () => {
  it("appends .md", () => {
    expect(skillFileName("no-then-chains")).toBe("no-then-chains.md");
  });

  it("falls back for a blank name so the strip is never just '.md'", () => {
    expect(skillFileName("")).toBe("untitled.md");
  });
});

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
