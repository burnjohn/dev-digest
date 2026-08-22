import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { FindingsHoverCard } from "./FindingsHoverCard";

afterEach(cleanup);

function setup() {
  return render(
    <FindingsHoverCard anchor={<button>chips</button>} header="6 findings">
      <div>finding body</div>
    </FindingsHoverCard>,
  );
}

describe("FindingsHoverCard", () => {
  it("is closed until the anchor is hovered", () => {
    setup();
    expect(screen.queryByText("finding body")).not.toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByText("chips").parentElement!);
    expect(screen.getByText("6 findings")).toBeInTheDocument();
    expect(screen.getByText("finding body")).toBeInTheDocument();
  });

  it("stays open during the close delay (moving into the panel) and closes after", () => {
    vi.useFakeTimers();
    try {
      setup();
      const wrapper = screen.getByText("chips").parentElement!;
      fireEvent.mouseEnter(wrapper);
      fireEvent.mouseLeave(wrapper);
      // Re-enter before the delay elapses cancels the close.
      act(() => {
        vi.advanceTimersByTime(80);
      });
      fireEvent.mouseEnter(wrapper);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.getByText("finding body")).toBeInTheDocument();
      // Leaving and waiting out the delay closes it.
      fireEvent.mouseLeave(wrapper);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByText("finding body")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays open when scrolling inside the panel, closes on page scroll", () => {
    setup();
    fireEvent.mouseEnter(screen.getByText("chips").parentElement!);
    const panel = screen.getByText("6 findings").closest('[role="presentation"]')!;
    // Scrolling the panel's own list must NOT dismiss it.
    fireEvent.scroll(panel);
    expect(screen.getByText("finding body")).toBeInTheDocument();
    // Scrolling the page (target outside the panel) dismisses it.
    fireEvent.scroll(document);
    expect(screen.queryByText("finding body")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    setup();
    fireEvent.mouseEnter(screen.getByText("chips").parentElement!);
    expect(screen.getByText("finding body")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("finding body")).not.toBeInTheDocument();
  });
});
