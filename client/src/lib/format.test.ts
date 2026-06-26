import { describe, it, expect } from "vitest";
import { formatCost } from "./format";

/**
 * formatCost — the display formatter for the cost badge (PR list column,
 * run history card, trace stats panel). Uses Intl.NumberFormat en-US USD
 * with min 2 / max 4 fraction digits.
 */

describe("formatCost", () => {
  it("returns '—' for null", () => {
    expect(formatCost(null)).toBe("—");
  });

  it("returns '—' for undefined", () => {
    expect(formatCost(undefined)).toBe("—");
  });

  it("formats zero as $0.00 (minimum 2 fraction digits)", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("formats a typical small run cost with up to 4 fraction digits", () => {
    expect(formatCost(0.0013)).toBe("$0.0013");
  });

  it("formats a larger cost with exactly 2 fraction digits", () => {
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("caps at 4 fraction digits, rounding as needed", () => {
    // 5th decimal gets rounded — result is $0.0013 (no 5th digit shown)
    expect(formatCost(0.00131)).toBe("$0.0013");
  });

  it("formats cost below the 4-digit precision floor as $0.00", () => {
    // 0.000001 rounds to 0.0000 which collapses to $0.00
    expect(formatCost(0.000001)).toBe("$0.00");
  });

  it("includes the dollar sign and uses en-US formatting", () => {
    expect(formatCost(1234.5)).toMatch(/^\$1,234\.5/);
  });
});
