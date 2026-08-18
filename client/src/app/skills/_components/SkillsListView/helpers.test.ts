import { describe, it, expect } from "vitest";
import type { Skill } from "@devdigest/shared";
import { estimateTokens, filterSkills, isUntrusted, toPercent } from "./helpers";

const skill = (over: Partial<Skill> = {}): Skill => ({
  id: "s1",
  name: "pr-quality-rubric",
  description: "Use when scoring a PR.",
  type: "rubric",
  source: "manual",
  body: "# Rubric",
  enabled: true,
  version: 1,
  evidence_files: null,
  ...over,
});

describe("filterSkills", () => {
  it("matches name, description and type, case-insensitively", () => {
    const skills = [
      skill(),
      skill({
        id: "s2",
        name: "secret-gate",
        type: "security",
        description: "Use when a diff touches config.",
      }),
    ];
    expect(filterSkills(skills, "SECRET").map((s) => s.id)).toEqual(["s2"]);
    expect(filterSkills(skills, "scoring").map((s) => s.id)).toEqual(["s1"]);
    expect(filterSkills(skills, "security").map((s) => s.id)).toEqual(["s2"]);
  });

  it("returns everything for a blank query", () => {
    const skills = [skill()];
    expect(filterSkills(skills, "  ")).toHaveLength(1);
  });
});

describe("isUntrusted", () => {
  it("flags skills that came from outside the workspace", () => {
    expect(isUntrusted({ source: "community" })).toBe(true);
    expect(isUntrusted({ source: "imported_url" })).toBe(true);
  });

  it("does NOT flag extracted skills — they come from the user's own repo", () => {
    expect(isUntrusted({ source: "extracted" })).toBe(false);
    expect(isUntrusted({ source: "manual" })).toBe(false);
  });
});

describe("estimateTokens", () => {
  it("matches reviewer-core's ceil(chars / 4), so the two never disagree", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("toPercent", () => {
  it("rounds a 0..1 ratio to a whole percent", () => {
    expect(toPercent(0.735)).toBe(74);
    expect(toPercent(1)).toBe(100);
    expect(toPercent(0)).toBe(0);
  });
});
