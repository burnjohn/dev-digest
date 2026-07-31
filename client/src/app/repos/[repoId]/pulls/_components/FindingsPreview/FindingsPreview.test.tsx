import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { FindingRecord } from "@devdigest/shared";
import { FindingsPreview } from "./FindingsPreview";

afterEach(cleanup);

const mk = (o: Partial<FindingRecord>): FindingRecord => ({
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  rationale: "A secret is committed.",
  suggestion: null,
  confidence: 0.98,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
  ...o,
});

describe("FindingsPreview", () => {
  it("renders the count header and one row per finding", () => {
    render(
      <FindingsPreview
        findings={[
          mk({}),
          mk({ id: "f2", severity: "WARNING", title: "N+1 query", file: "src/api/users.ts" }),
        ]}
      />,
    );
    expect(screen.getByText(/2 FINDINGS/)).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText(/src\/config\.ts:12/)).toBeInTheDocument();
  });

  it('appends "IN THIS RUN" when inThisRun is set', () => {
    render(<FindingsPreview findings={[mk({})]} inThisRun />);
    expect(screen.getByText(/1 FINDINGS IN THIS RUN/)).toBeInTheDocument();
  });

  it("shows an empty state for no findings", () => {
    render(<FindingsPreview findings={[]} />);
    expect(screen.getByText("No findings.")).toBeInTheDocument();
  });
});
