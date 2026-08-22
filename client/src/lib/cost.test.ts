import { describe, it, expect } from "vitest";
import { formatCost } from "./cost";

describe("formatCost", () => {
  it("renders missing data as '—', never '$0.00'", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
  });

  it("renders a genuine zero (free model) as '$0.00'", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("widens precision for sub-cent runs", () => {
    expect(formatCost(0.0013)).toBe("$0.0013"); // < 0.01 → 4 dp
    expect(formatCost(0.014)).toBe("$0.014"); // ≥ 0.01 → 3 dp
  });

  it("uses 2 decimals at a dollar and above", () => {
    expect(formatCost(0.06)).toBe("$0.06");
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(12.345)).toBe("$12.35");
  });
});
