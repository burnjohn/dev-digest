import { describe, it, expect } from "vitest";
import type { EvalTrendSeriesPoint } from "@devdigest/shared";
import { sparkPointsFor } from "./spark";

function point(
  batchId: string,
  metric: EvalTrendSeriesPoint["metric"],
  value: number | null,
  finishedAt: string,
): EvalTrendSeriesPoint {
  return { metric, batch_id: batchId, finished_at: finishedAt, value };
}

describe("sparkPointsFor", () => {
  it("returns the recall series oldest-first, ignoring the other metrics", () => {
    const trend = [
      point("b1", "recall", 0.7, "2026-05-01T00:00:00.000Z"),
      point("b1", "precision", 0.99, "2026-05-01T00:00:00.000Z"),
      point("b2", "recall", 0.9, "2026-05-02T00:00:00.000Z"),
      point("b2", "citation_accuracy", 0.1, "2026-05-02T00:00:00.000Z"),
    ];

    expect(sparkPointsFor(trend, "recall")).toEqual([0.7, 0.9]);
  });

  it("orders by finished_at, not by the order the server happened to emit", () => {
    const trend = [
      point("b2", "recall", 0.9, "2026-05-02T00:00:00.000Z"),
      point("b1", "recall", 0.7, "2026-05-01T00:00:00.000Z"),
    ];

    expect(sparkPointsFor(trend, "recall")).toEqual([0.7, 0.9]);
  });

  it("drops an unmeasured batch rather than plotting it as 0", () => {
    // Plotting a null as 0 would draw a recall collapse that never happened.
    const trend = [
      point("b1", "recall", 0.8, "2026-05-01T00:00:00.000Z"),
      point("b2", "recall", null, "2026-05-02T00:00:00.000Z"),
      point("b3", "recall", 0.85, "2026-05-03T00:00:00.000Z"),
    ];

    expect(sparkPointsFor(trend, "recall")).toEqual([0.8, 0.85]);
  });

  it("keeps a real zero measurement", () => {
    const trend = [
      point("b1", "recall", 0, "2026-05-01T00:00:00.000Z"),
      point("b2", "recall", 0.5, "2026-05-02T00:00:00.000Z"),
    ];

    expect(sparkPointsFor(trend, "recall")).toEqual([0, 0.5]);
  });

  it("returns null below two points, so no line is drawn from a single run", () => {
    // `Sparkline` divides by `data.length - 1`, so one point yields NaN
    // coordinates and an invalid path.
    expect(sparkPointsFor([], "recall")).toBeNull();
    expect(sparkPointsFor([point("b1", "recall", 0.8, "2026-05-01T00:00:00.000Z")], "recall")).toBeNull();
    expect(
      sparkPointsFor(
        [
          point("b1", "recall", 0.8, "2026-05-01T00:00:00.000Z"),
          point("b2", "recall", null, "2026-05-02T00:00:00.000Z"),
        ],
        "recall",
      ),
    ).toBeNull();
  });

  it("selects the series named by the metric argument", () => {
    const trend = [
      point("b1", "recall", 0.1, "2026-05-01T00:00:00.000Z"),
      point("b1", "precision", 0.5, "2026-05-01T00:00:00.000Z"),
      point("b1", "citation_accuracy", 0.9, "2026-05-01T00:00:00.000Z"),
      point("b2", "recall", 0.2, "2026-05-02T00:00:00.000Z"),
      point("b2", "precision", 0.6, "2026-05-02T00:00:00.000Z"),
      point("b2", "citation_accuracy", 1, "2026-05-02T00:00:00.000Z"),
    ];

    expect(sparkPointsFor(trend, "recall")).toEqual([0.1, 0.2]);
    expect(sparkPointsFor(trend, "precision")).toEqual([0.5, 0.6]);
    expect(sparkPointsFor(trend, "citation_accuracy")).toEqual([0.9, 1]);
  });

  it("returns null when the window holds only other metrics", () => {
    expect(
      sparkPointsFor(
        [
          point("b1", "precision", 0.9, "2026-05-01T00:00:00.000Z"),
          point("b2", "precision", 0.8, "2026-05-02T00:00:00.000Z"),
        ],
        "recall",
      ),
    ).toBeNull();
  });
});
