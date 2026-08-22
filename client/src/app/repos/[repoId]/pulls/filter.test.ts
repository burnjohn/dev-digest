import { describe, it, expect } from "vitest";
import type { PrMeta } from "@/lib/types";
import { filterAndSortPulls, prListCounts } from "./filter";

/** Minimal PrMeta factory — fills required contract fields, override what matters. */
function makePr(over: Partial<PrMeta> & { number: number }): PrMeta {
  return {
    title: `PR ${over.number}`,
    author: "octocat",
    branch: "feature",
    base: "main",
    head_sha: "deadbeef",
    additions: 0,
    deletions: 0,
    files_count: 0,
    status: "needs_review",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  } as PrMeta;
}

const pulls: PrMeta[] = [
  makePr({ number: 1, title: "Add login", status: "needs_review", updated_at: "2026-06-01T00:00:00Z" }),
  makePr({ number: 2, title: "Fix logout", status: "reviewed", updated_at: "2026-06-03T00:00:00Z" }),
  makePr({ number: 3, title: "Stale work", status: "stale", updated_at: "2026-06-02T00:00:00Z" }),
  makePr({ number: 42, title: "Merged thing", status: "merged", updated_at: "2026-05-01T00:00:00Z" }),
];

describe("filterAndSortPulls", () => {
  it("filters by status; 'all' keeps everything", () => {
    expect(filterAndSortPulls(pulls, { status: "reviewed", query: "", sort: "newest" }).map((p) => p.number)).toEqual([2]);
    expect(filterAndSortPulls(pulls, { status: "all", query: "", sort: "newest" })).toHaveLength(4);
  });

  it("matches the query against title (case-insensitive) or #number", () => {
    expect(filterAndSortPulls(pulls, { status: "all", query: "LOGOUT", sort: "newest" }).map((p) => p.number)).toEqual([2]);
    expect(filterAndSortPulls(pulls, { status: "all", query: "42", sort: "newest" }).map((p) => p.number)).toEqual([42]);
    expect(filterAndSortPulls(pulls, { status: "all", query: "  log ", sort: "newest" }).map((p) => p.number).sort()).toEqual([1, 2]);
  });

  it("sorts by updated_at: newest-first by default, oldest ascending", () => {
    expect(filterAndSortPulls(pulls, { status: "all", query: "", sort: "newest" }).map((p) => p.number)).toEqual([2, 3, 1, 42]);
    expect(filterAndSortPulls(pulls, { status: "all", query: "", sort: "oldest" }).map((p) => p.number)).toEqual([42, 1, 3, 2]);
  });

  it("does not mutate the input array", () => {
    const before = pulls.map((p) => p.number);
    filterAndSortPulls(pulls, { status: "all", query: "", sort: "oldest" });
    expect(pulls.map((p) => p.number)).toEqual(before);
  });
});

describe("prListCounts", () => {
  it("counts open (needs_review|reviewed|stale) and needs_review separately", () => {
    expect(prListCounts(pulls)).toEqual({ openCount: 3, needsReviewCount: 1 });
  });
});
