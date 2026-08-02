import { describe, it, expect } from "vitest";
import { formatCost, formatTokens } from "./cost";

describe("formatCost", () => {
  it('renders unknown cost as "—", never $0.00', () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
    expect(formatCost(Number.NaN)).toBe("—");
  });

  it("renders a genuinely free run as $0.00", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("keeps two significant digits below a dollar", () => {
    expect(formatCost(0.0013)).toBe("$0.0013");
    expect(formatCost(0.014)).toBe("$0.014");
    expect(formatCost(0.06)).toBe("$0.06");
    expect(formatCost(0.5)).toBe("$0.50");
  });

  it("uses cents at or above a dollar", () => {
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(12.345)).toBe("$12.35");
  });
});

describe("formatTokens", () => {
  it("sums in and out with thousands separators", () => {
    expect(formatTokens(8000, 1119)).toBe("9,119");
  });

  it("treats missing counts as zero", () => {
    expect(formatTokens(null, undefined)).toBe("0");
  });
});
