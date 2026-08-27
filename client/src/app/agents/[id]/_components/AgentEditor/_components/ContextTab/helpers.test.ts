import { describe, it, expect } from "vitest";
import type { ContextDocument } from "@/lib/types";
import { isOverWindowThreshold, sumAttachedTokens } from "./helpers";

function doc(path: string, tokenEstimate: number, overrides: Partial<ContextDocument> = {}): ContextDocument {
  return {
    path,
    content: null,
    size: 100,
    updated_at: null,
    type: "docs",
    token_estimate: tokenEstimate,
    oversized: false,
    source: "repo",
    used_by_agents: 0,
    used_by_disabled_skill_only: 0,
    ...overrides,
  };
}

describe("sumAttachedTokens", () => {
  it("sums only the attached documents' estimates", () => {
    const all = [doc("a.md", 10), doc("b.md", 20), doc("c.md", 30)];
    expect(sumAttachedTokens(all, new Set(["a.md", "c.md"]))).toBe(40);
  });

  it("is zero when nothing is attached", () => {
    const all = [doc("a.md", 10)];
    expect(sumAttachedTokens(all, new Set())).toBe(0);
  });
});

describe("isOverWindowThreshold", () => {
  it("is false at or under 25% of the window", () => {
    expect(isOverWindowThreshold(32_000, 128_000)).toBe(false); // exactly 25%
    expect(isOverWindowThreshold(31_999, 128_000)).toBe(false);
  });

  it("is true once attached tokens exceed 25% of the window", () => {
    expect(isOverWindowThreshold(32_001, 128_000)).toBe(true);
  });

  it("is false when the context window is null or unknown — never a false warning", () => {
    expect(isOverWindowThreshold(1_000_000, null)).toBe(false);
    expect(isOverWindowThreshold(1_000_000, undefined)).toBe(false);
  });
});
