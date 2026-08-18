import { describe, it, expect } from "vitest";
import type { ConventionCandidate } from "@devdigest/shared";
import { buildSkillBody, defaultSkillName, slugifyRule } from "./helpers";

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  category: "naming",
  rule: "Always use async/await instead of .then() chains.",
  evidence_path: "src/api/users.ts",
  evidence_start_line: 23,
  evidence_end_line: 31,
  evidence_snippet: "const user = await db.users.find(id);",
  confidence: 0.91,
  accepted: true,
};

describe("slugifyRule", () => {
  it("kebab-cases the first few words of a rule", () => {
    expect(slugifyRule("Always use async/await instead of .then() chains."))
      .toBe("always-use-asyncawait-instead-of-then");
  });

  it("falls back to a generic heading when the rule has no usable words", () => {
    expect(slugifyRule("!!! ???")).toBe("rule");
  });
});

describe("defaultSkillName", () => {
  it("derives '<repo>-conventions' from an owner/repo full name", () => {
    expect(defaultSkillName("acme/payments-api")).toBe("payments-api-conventions");
  });

  it("falls back to 'repo-conventions' when there is no active repo", () => {
    expect(defaultSkillName(null)).toBe("repo-conventions");
    expect(defaultSkillName(undefined)).toBe("repo-conventions");
  });
});

describe("buildSkillBody", () => {
  it("renders a heading, an intro, and one section per candidate", () => {
    const body = buildSkillBody("payments-api-conventions", [CANDIDATE]);
    expect(body).toContain("# payments-api-conventions");
    expect(body).toContain("## always-use-asyncawait-instead-of-then");
    expect(body).toContain(CANDIDATE.rule);
    expect(body).toContain("Detected in `src/api/users.ts:23-31`:");
    expect(body).toContain(CANDIDATE.evidence_snippet);
  });

  it("renders one section per candidate, in order", () => {
    const second: ConventionCandidate = {
      ...CANDIDATE,
      id: "c2",
      rule: "Redis access goes through src/lib/redis.ts singleton.",
      evidence_path: "src/lib/redis.ts",
      evidence_start_line: 1,
      evidence_end_line: 9,
    };
    const body = buildSkillBody("payments-api-conventions", [CANDIDATE, second]);
    expect(body.indexOf(CANDIDATE.rule)).toBeLessThan(body.indexOf(second.rule));
    expect(body).toContain("Detected in `src/lib/redis.ts:1-9`:");
  });

  it("renders just the heading and intro for an empty bundle", () => {
    const body = buildSkillBody("empty-conventions", []);
    expect(body).toContain("# empty-conventions");
    expect(body).not.toContain("##");
  });
});
