/**
 * formatCostUsd carries a product rule, not just a display choice: "—" means we
 * have no cost for a run, "$0.00" means the run genuinely was free (the price
 * book lists free models at 0). Conflating the two would tell a user a paid
 * review cost nothing, so both directions are pinned here.
 */
import { describe, it, expect } from "vitest";
import { formatCostUsd, formatTokenCount, EMPTY } from "./format";

describe("formatCostUsd", () => {
  it("renders each cost band the way the design does", () => {
    // One rule (4dp, trim trailing zeros, 2dp floor) has to cover three orders
    // of magnitude — these are the exact values from the mockups.
    expect(formatCostUsd(0.0013)).toBe("$0.0013"); // flash model, small diff
    expect(formatCostUsd(0.014)).toBe("$0.014");
    expect(formatCostUsd(0.06)).toBe("$0.06"); // whole cents still read as money
    expect(formatCostUsd(0.003)).toBe("$0.003");
  });

  it("distinguishes 'no data' from 'free'", () => {
    expect(formatCostUsd(null)).toBe(EMPTY);
    expect(formatCostUsd(undefined)).toBe(EMPTY);
    expect(formatCostUsd(NaN)).toBe(EMPTY);
    expect(formatCostUsd(0)).toBe("$0.00");
  });

  it("never rounds a real cost down to a free-looking $0.0000", () => {
    expect(formatCostUsd(0.00002)).toBe("<$0.0001");
  });

  it("keeps dollars readable above $1", () => {
    expect(formatCostUsd(1.5)).toBe("$1.50");
    expect(formatCostUsd(12.3456)).toBe("$12.3456");
  });
});

describe("formatTokenCount", () => {
  it("separates thousands with spaces, not commas", () => {
    expect(formatTokenCount(9119)).toBe("9 119");
    expect(formatTokenCount(150)).toBe("150");
    expect(formatTokenCount(1234567)).toBe("1 234 567");
  });
});
