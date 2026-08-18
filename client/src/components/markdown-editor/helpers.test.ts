import { describe, it, expect } from "vitest";
import { estimateTokens, lineNumbers, skillFileName } from "./helpers";

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
