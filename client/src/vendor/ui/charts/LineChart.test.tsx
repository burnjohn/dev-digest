/* Recharts only renders a <Tooltip>'s content on a hover jsdom can't
   simulate (it drives Recharts' own mouse-tracking over a measured SVG
   canvas — see the LineChart.tsx comment on ChartTooltip), so this renders
   the tooltip content directly with a synthetic payload instead. */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ChartTooltip } from "./LineChart";

afterEach(cleanup);

const PAYLOAD = [
  { name: "Recall", value: 0.8, color: "red", payload: { i: 2, __version: 7, __cost: 0.125 } },
  { name: "Precision", value: 0.6, color: "blue", payload: { i: 2, __version: 7, __cost: 0.125 } },
];

describe("ChartTooltip", () => {
  it("renders nothing when inactive", () => {
    const { container } = render(<ChartTooltip active={false} payload={PAYLOAD} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no payload", () => {
    const { container } = render(<ChartTooltip active payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the point's version, cost, and each series' percentage", () => {
    render(<ChartTooltip active payload={PAYLOAD} />);
    expect(screen.getByText(/v7/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.125/)).toBeInTheDocument();
    expect(screen.getByText("Recall: 80%")).toBeInTheDocument();
    expect(screen.getByText("Precision: 60%")).toBeInTheDocument();
  });

  it("falls back to a dash for a point with no version or cost", () => {
    render(
      <ChartTooltip
        active
        payload={[{ name: "Recall", value: 0.5, color: "red", payload: { i: 0, __version: null, __cost: null } }]}
      />,
    );
    expect(screen.getByText("— · —")).toBeInTheDocument();
  });
});
