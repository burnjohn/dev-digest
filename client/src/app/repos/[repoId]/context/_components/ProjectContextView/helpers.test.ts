import { describe, it, expect } from "vitest";
import type { ContextDocument } from "@devdigest/shared";
import { sortByPath, totalTokens } from "./helpers";

const doc = (path: string, token_estimate: number): ContextDocument => ({
  path,
  content: null,
  size: 100,
  updated_at: null,
  type: "docs",
  token_estimate,
  oversized: false,
  source: "repo",
  used_by_agents: 0,
  used_by_disabled_skill_only: 0,
});

describe("sortByPath", () => {
  it("orders by repository-relative path and never mutates its input", () => {
    const input = [doc("specs/b.md", 1), doc("docs/a.md", 1), doc("insights/c.md", 1)];
    const sorted = sortByPath(input);

    expect(sorted.map((d) => d.path)).toEqual(["docs/a.md", "insights/c.md", "specs/b.md"]);
    // Mutation would make the page's row order depend on render count.
    expect(input.map((d) => d.path)).toEqual(["specs/b.md", "docs/a.md", "insights/c.md"]);
  });
});

describe("totalTokens", () => {
  it("sums every listed document's estimate", () => {
    expect(totalTokens([doc("a.md", 42), doc("b.md", 900), doc("c.md", 8)])).toBe(950);
  });

  it("is 0 for an empty listing, so the footer never renders NaN", () => {
    expect(totalTokens([])).toBe(0);
  });

  it("sums the WHOLE listing, not a subset — a zero-token document still counts", () => {
    // Guards the mutation "filter out empty documents before summing", which a
    // naive `.filter(d => d.token_estimate).reduce(...)` would introduce and
    // which no total-only assertion above would catch.
    expect(totalTokens([doc("a.md", 0), doc("b.md", 5)])).toBe(5);
  });
});
