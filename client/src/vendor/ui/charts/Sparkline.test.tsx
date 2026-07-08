import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

afterEach(() => {
  cleanup();
});

describe("Sparkline", () => {
  it("renders a path with no NaN coordinates for a 2+ point series", () => {
    const { container } = render(<Sparkline data={[0.7, 0.9]} />);
    const path = container.querySelector("path");
    const circle = container.querySelector("circle");

    expect(path).not.toBeNull();
    expect(path!.getAttribute("d")).not.toMatch(/NaN/);
    expect(circle!.getAttribute("cx")).not.toBe("NaN");
    expect(circle!.getAttribute("cy")).not.toBe("NaN");
  });

  it("renders a single visible dot with no NaN coordinates for a 1-point series (agent's first eval batch)", () => {
    const { container } = render(<Sparkline data={[0.8]} />);
    const svg = container.querySelector("svg");
    const circle = container.querySelector("circle");
    const path = container.querySelector("path");

    expect(svg).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/NaN/);

    // No path is rendered for a single point (nothing to connect); the dot
    // alone represents the series.
    expect(path).toBeNull();

    expect(circle).not.toBeNull();
    const cx = Number(circle!.getAttribute("cx"));
    const cy = Number(circle!.getAttribute("cy"));
    expect(Number.isNaN(cx)).toBe(false);
    expect(Number.isNaN(cy)).toBe(false);
  });

  it("returns null for an empty series", () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
