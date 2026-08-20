import { describe, it, expect } from "vitest";
import type { ConventionCandidate, ConventionStatus } from "@devdigest/shared";
import {
  confidenceColor,
  countByStatus,
  evidenceLabel,
  filterCandidates,
  githubEvidenceUrl,
} from "./helpers";

const c = (
  id: string,
  status: ConventionStatus,
  confidence: number,
): ConventionCandidate => ({
  id,
  repo_id: "r1",
  category: "general",
  rule: `rule ${id}`,
  rationale: null,
  evidence_path: "a.ts",
  evidence_line: 1,
  evidence_snippet: "x",
  confidence,
  status,
  created_at: null,
});

const LIST = [
  c("a", "pending", 0.5),
  c("b", "accepted", 0.95),
  c("c", "pending", 0.8),
  c("d", "rejected", 0.7),
];

describe("filterCandidates", () => {
  it("shows one triage state at a time, highest confidence first", () => {
    expect(filterCandidates(LIST, "pending").map((x) => x.id)).toEqual(["c", "a"]);
    expect(filterCandidates(LIST, "accepted").map((x) => x.id)).toEqual(["b"]);
    expect(filterCandidates(LIST, "rejected").map((x) => x.id)).toEqual(["d"]);
  });

  it("`all` keeps every state, still sorted by confidence", () => {
    expect(filterCandidates(LIST, "all").map((x) => x.id)).toEqual(["b", "c", "d", "a"]);
  });

  it("does not sort the caller's array in place", () => {
    const input = [...LIST];
    filterCandidates(input, "all");
    expect(input.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("countByStatus", () => {
  it("counts each state and the total", () => {
    expect(countByStatus(LIST)).toEqual({ pending: 2, accepted: 1, rejected: 1, all: 4 });
  });
});

describe("confidenceColor", () => {
  it("uses the same bands as the confidence dot", () => {
    expect(confidenceColor(0.91)).toBe("var(--ok)");
    expect(confidenceColor(0.7)).toBe("var(--warn)");
    expect(confidenceColor(0.4)).toBe("var(--text-muted)");
  });
});

describe("evidenceLabel", () => {
  it("appends the line only when there is one", () => {
    expect(evidenceLabel("src/a.ts", 23)).toBe("src/a.ts:23");
    expect(evidenceLabel("src/a.ts", null)).toBe("src/a.ts");
  });
});

describe("githubEvidenceUrl", () => {
  it("deep-links the exact line on the repo's default branch", () => {
    expect(githubEvidenceUrl("acme/payments-api", "main", "src/api/users.ts", 23)).toBe(
      "https://github.com/acme/payments-api/blob/main/src/api/users.ts#L23",
    );
  });

  it("drops the anchor when the evidence has no line", () => {
    expect(githubEvidenceUrl("acme/payments-api", "main", "src/api/users.ts", null)).toBe(
      "https://github.com/acme/payments-api/blob/main/src/api/users.ts",
    );
  });

  it("falls back to HEAD when the repo declares no default branch", () => {
    expect(githubEvidenceUrl("acme/api", "", "a.ts", 1)).toContain("/blob/HEAD/a.ts#L1");
  });

  it("encodes each path segment without escaping the separators", () => {
    expect(githubEvidenceUrl("acme/api", "main", "src/app/[repoId]/page.tsx", 4)).toBe(
      "https://github.com/acme/api/blob/main/src/app/%5BrepoId%5D/page.tsx#L4",
    );
  });

  it("returns null when the repo is unknown, so the UI shows text not a dead link", () => {
    expect(githubEvidenceUrl(undefined, "main", "a.ts", 1)).toBeNull();
    expect(githubEvidenceUrl("acme/api", "main", "", 1)).toBeNull();
  });
});
