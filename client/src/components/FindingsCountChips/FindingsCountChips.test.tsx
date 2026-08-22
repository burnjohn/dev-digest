import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FindingsCountChips } from "./FindingsCountChips";
import { countBySeverity, totalCount } from "./helpers";

afterEach(cleanup);

describe("FindingsCountChips", () => {
  it("renders only the severities with count > 0, in severity order", () => {
    const { container } = render(
      <FindingsCountChips counts={{ CRITICAL: 2, WARNING: 0, SUGGESTION: 3 }} />,
    );
    // WARNING (0) is omitted → only two chips.
    const chips = container.querySelectorAll("span[title]");
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveAttribute("title", "2 critical");
    expect(chips[1]).toHaveAttribute("title", "3 suggestion");
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders nothing when all severities are zero", () => {
    const { container } = render(
      <FindingsCountChips counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("countBySeverity / totalCount", () => {
  it("groups findings and ignores unknown severities", () => {
    const counts = countBySeverity([
      { severity: "CRITICAL" },
      { severity: "CRITICAL" },
      { severity: "WARNING" },
      { severity: "INFO" }, // ignored
    ]);
    expect(counts).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 0 });
    expect(totalCount(counts)).toBe(3);
  });
});
