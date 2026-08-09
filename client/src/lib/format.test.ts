import { describe, expect, it } from "vitest";
import { formatCost } from "./format";

describe("formatCost", () => {
  it("renders — for null/undefined (never $0.00 for missing data)", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
  });

  it("keeps a real zero as $0.00", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("trims trailing zeros but keeps ≥ 2 decimals", () => {
    expect(formatCost(0.06)).toBe("$0.06");
    expect(formatCost(0.014)).toBe("$0.014");
    expect(formatCost(0.0013)).toBe("$0.0013");
  });
});
