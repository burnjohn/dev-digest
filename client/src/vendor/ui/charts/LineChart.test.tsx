import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { LineChart } from "./LineChart";

// jsdom's `getBoundingClientRect()` always returns an all-zero rect, so
// Recharts' `ResponsiveContainer` (which measures itself off that rect) would
// otherwise settle on 0x0 and render nothing to assert on. Stub a real size
// for the duration of this file only.
let originalGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect;

beforeEach(() => {
  originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function stubGetBoundingClientRect(this: Element) {
    return {
      width: 400,
      height: 160,
      top: 0,
      left: 0,
      right: 400,
      bottom: 160,
      x: 0,
      y: 0,
      toJSON() {
        return this;
      },
    } as DOMRect;
  };
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

describe("LineChart", () => {
  it("renders a null in the middle of a series as a gap, not a plotted 0", () => {
    const { container } = render(
      <LineChart
        series={[{ name: "recall", color: "#3366ff", data: [0.7, 0.75, null, 0.8, 0.82] }]}
        w={400}
        h={160}
      />,
    );
    const path = container.querySelector('path.recharts-line-curve[stroke="#3366ff"]');
    expect(path).not.toBeNull();
    const d = path!.getAttribute("d") ?? "";
    // A bridged (connectNulls) or coerced-to-0 line draws as a single unbroken
    // subpath — exactly one "M". An actual gap forces d3 to lift the pen and
    // start a second subpath, so the null is provable from the `d` string
    // itself rather than a screenshot.
    expect(d.match(/M/g)?.length ?? 0).toBeGreaterThan(1);
  });

  it("distinguishes two series by dash pattern, not only by color", () => {
    const { container } = render(
      <LineChart
        series={[
          { name: "recall", color: "#3366ff", data: [0.7, 0.75, 0.8] },
          { name: "precision", color: "#33cc66", data: [0.65, 0.7, 0.75], dash: "4 4" },
        ]}
        w={400}
        h={160}
      />,
    );
    const solid = container.querySelector('path.recharts-line-curve[stroke="#3366ff"]');
    const dashed = container.querySelector('path.recharts-line-curve[stroke="#33cc66"]');
    expect(solid).not.toBeNull();
    expect(dashed).not.toBeNull();
    expect(solid).not.toHaveAttribute("stroke-dasharray");
    expect(dashed).toHaveAttribute("stroke-dasharray", "4 4");
  });
});
