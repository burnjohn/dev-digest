import { describe, it, expect } from "vitest";
import type { SkillSummary, SkillVersion } from "@devdigest/shared";
import { approxTokens, diffLines, diffStat, filterSkills, isThirdParty, versionDeltas } from "./helpers";

const skill = (over: Partial<SkillSummary> = {}): SkillSummary => ({
  id: "s1",
  name: "no-then-chains",
  description: "When you see a .then chain, ask for async/await.",
  type: "convention",
  source: "manual",
  body: "# Rule\nUse async/await.",
  enabled: true,
  version: 2,
  evidence_files: null,
  used_by: 2,
  ...over,
});

const SKILLS = [
  skill(),
  skill({
    id: "s2",
    name: "lethal-trifecta",
    description: "When private data, untrusted input and an exfil path meet, flag it.",
    type: "security",
    source: "imported_url",
  }),
];

describe("filterSkills", () => {
  it("matches on name, description and type", () => {
    expect(filterSkills(SKILLS, "trifecta").map((s) => s.id)).toEqual(["s2"]);
    expect(filterSkills(SKILLS, "async/await").map((s) => s.id)).toEqual(["s1"]);
    expect(filterSkills(SKILLS, "security").map((s) => s.id)).toEqual(["s2"]);
  });

  it("treats a blank query as no filter", () => {
    expect(filterSkills(SKILLS, "   ")).toHaveLength(2);
  });
});

describe("isThirdParty", () => {
  it("is true for anything not written in this editor", () => {
    expect(isThirdParty({ source: "manual" })).toBe(false);
    expect(isThirdParty({ source: "extracted" })).toBe(false);
    expect(isThirdParty({ source: "imported_url" })).toBe(true);
    expect(isThirdParty({ source: "community" })).toBe(true);
  });
});

describe("approxTokens", () => {
  it("uses the same chars/4 heuristic the server falls back to", () => {
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("abcd")).toBe(1);
    expect(approxTokens("abcde")).toBe(2);
  });
});

describe("diffLines", () => {
  it("marks added, removed and unchanged lines", () => {
    expect(diffLines("a\nb\nc", "a\nB\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
    ]);
  });

  it("keeps a common prefix and suffix instead of rewriting the whole body", () => {
    const lines = diffLines("intro\nold\nend", "intro\nnew one\nnew two\nend");
    expect(lines.filter((l) => l.kind === "same").map((l) => l.text)).toEqual(["intro", "end"]);
    expect(lines.filter((l) => l.kind === "add").map((l) => l.text)).toEqual(["new one", "new two"]);
    expect(lines.filter((l) => l.kind === "remove").map((l) => l.text)).toEqual(["old"]);
  });

  it("handles a pure insertion and a pure deletion", () => {
    expect(diffStat("a", "a\nb")).toEqual({ added: 1, removed: 0 });
    expect(diffStat("a\nb", "a")).toEqual({ added: 0, removed: 1 });
    expect(diffStat("same", "same")).toEqual({ added: 0, removed: 0 });
  });
});

describe("versionDeltas", () => {
  const version = (v: number, body: string): SkillVersion => ({
    skill_id: "s1",
    version: v,
    body,
    created_at: "2026-08-05T10:00:00.000Z",
  });

  it("summarises each version against the one before it, newest first", () => {
    const rows = versionDeltas([
      version(1, "line one"),
      version(2, "line one\nline two"),
      version(3, "line one\nline two\nline three"),
    ]);

    expect(rows.map((r) => r.version.version)).toEqual([3, 2, 1]);
    expect(rows[0]).toMatchObject({ added: 1, removed: 0, isFirst: false });
    expect(rows[1]).toMatchObject({ added: 1, removed: 0, isFirst: false });
    // The oldest has nothing to compare against, so it reports its own size.
    expect(rows[2]).toMatchObject({ added: 1, isFirst: true });
  });

  it("does not care what order the API returned them in", () => {
    const rows = versionDeltas([version(2, "a\nb"), version(1, "a")]);
    expect(rows.map((r) => r.version.version)).toEqual([2, 1]);
  });

  it("pairs each row with the next-older snapshot so the diff has a left side", () => {
    const rows = versionDeltas([version(1, "a"), version(2, "a\nb"), version(3, "a\nb\nc")]);
    expect(rows.map((r) => r.previous?.version)).toEqual([2, 1, undefined]);
  });

  it("pairs by position, not by version-1, so a gap in the numbers still diffs", () => {
    // A missing v2 must not leave v3 without a left side to diff against.
    const rows = versionDeltas([version(1, "a"), version(3, "a\nc")]);
    expect(rows[0]!.previous?.version).toBe(1);
    expect(rows[0]).toMatchObject({ added: 1, removed: 0 });
  });
});
