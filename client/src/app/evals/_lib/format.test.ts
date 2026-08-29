import { describe, it, expect } from "vitest";
import {
  formatPercent,
  formatSignedPercentDelta,
  formatCost,
  formatSignedCost,
  formatPassRatio,
  formatBatchTimestamp,
} from "./format";

describe("formatPercent", () => {
  it("renders a fraction as a rounded percentage, and null as an em dash", () => {
    expect(formatPercent(0.823)).toBe("82%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("formatSignedPercentDelta", () => {
  it("signs a real change and renders a real zero-point delta plainly, but null stays an em dash", () => {
    expect(formatSignedPercentDelta(0.04)).toBe("+4%");
    expect(formatSignedPercentDelta(-0.02)).toBe("-2%");
    expect(formatSignedPercentDelta(0)).toBe("0%");
    // AC-71/AC-32: no preceding batch, or either side unmeasured — never a
    // signed zero standing in for "no comparison exists".
    expect(formatSignedPercentDelta(null)).toBe("—");
  });
});

describe("cost formatting", () => {
  it("formatCost keeps a two-decimal floor but does not ROUND a sub-cent batch away, null as an em dash", () => {
    expect(formatCost(0.2)).toBe("$0.20");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(null)).toBe("—");
    // The regression this replaced: a real gold-set batch costs a fraction of
    // a cent, and `toFixed(2)` rendered every one of them as an identical
    // `$0.00` — indistinguishable from free, and from each other.
    expect(formatCost(0.0010477256)).toBe("$0.001");
    expect(formatCost(0.00072958718)).toBe("$0.0007");
    expect(formatCost(0.0035932883)).toBe("$0.0036");
  });

  it("formatSignedCost signs a real change, zero renders unsigned, null stays an em dash", () => {
    expect(formatSignedCost(0.02)).toBe("+$0.02");
    expect(formatSignedCost(-0.01)).toBe("-$0.01");
    expect(formatSignedCost(0)).toBe("$0.00");
    expect(formatSignedCost(null)).toBe("—");
    // Same precision as `formatCost` — a delta between two sub-cent batches
    // must not collapse to a signless `$0.00`.
    expect(formatSignedCost(0.0026)).toBe("+$0.0026");
    expect(formatSignedCost(-0.0007)).toBe("-$0.0007");
  });
});

describe("formatPassRatio", () => {
  it("joins passed/total verbatim, including a 0-total case", () => {
    expect(formatPassRatio(17, 20)).toBe("17/20");
    expect(formatPassRatio(0, 0)).toBe("0/0");
  });
});

describe("formatBatchTimestamp", () => {
  it("formats the UTC components of the ISO string, independent of local timezone", () => {
    expect(formatBatchTimestamp("2026-05-29T09:14:00.000Z")).toBe("2026-05-29 09:14");
    expect(formatBatchTimestamp("2026-01-01T00:05:00.000Z")).toBe("2026-01-01 00:05");
  });
});
