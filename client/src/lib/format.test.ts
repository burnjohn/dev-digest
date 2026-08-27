import { describe, expect, it } from "vitest";
import { formatCost, formatTokenFlow } from "./format";

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

describe("formatTokenFlow", () => {
  it("renders — only when BOTH counts are missing", () => {
    expect(formatTokenFlow(null, null)).toBe("—");
    expect(formatTokenFlow(undefined, undefined)).toBe("—");
    // One side known is still worth showing — the run happened.
    expect(formatTokenFlow(8200, null)).toBe("8.2K→—");
  });

  it("abbreviates thousands to one decimal and trims a trailing .0", () => {
    expect(formatTokenFlow(8200, 1300)).toBe("8.2K→1.3K");
    // 12_000 → "12K", never "12.0K" — the trim is the point.
    expect(formatTokenFlow(12000, 2000)).toBe("12K→2K");
  });

  it("leaves counts under 1000 unabbreviated, and keeps a real zero", () => {
    expect(formatTokenFlow(940, 12)).toBe("940→12");
    expect(formatTokenFlow(0, 0)).toBe("0→0");
  });
});
