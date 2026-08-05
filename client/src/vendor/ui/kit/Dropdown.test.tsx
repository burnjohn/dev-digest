import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Dropdown } from "./Dropdown";

afterEach(cleanup);

describe("Dropdown — items path (existing consumers)", () => {
  it("is closed by default and opens the item list on trigger click", () => {
    render(
      <Dropdown
        trigger={<button>Menu</button>}
        items={[{ label: "Run all" }, { divider: true }, { label: "Configure…", muted: true }]}
      />,
    );
    expect(screen.queryByText("Run all")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Menu"));
    expect(screen.getByText("Run all")).toBeInTheDocument();
    expect(screen.getByText("Configure…")).toBeInTheDocument();
  });

  it("calls the item's onClick and closes the menu", () => {
    const onClick = vi.fn();
    render(<Dropdown trigger={<button>Menu</button>} items={[{ label: "Run all", onClick }]} />);
    fireEvent.click(screen.getByText("Menu"));
    fireEvent.click(screen.getByText("Run all"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Run all")).not.toBeInTheDocument();
  });
});

describe("Dropdown — children path (findings popover)", () => {
  it("renders children instead of items when both would apply", () => {
    render(
      <Dropdown trigger={<button>Menu</button>} items={[{ label: "Should not render" }]}>
        <div>Custom content</div>
      </Dropdown>,
    );
    fireEvent.click(screen.getByText("Menu"));
    expect(screen.getByText("Custom content")).toBeInTheDocument();
    expect(screen.queryByText("Should not render")).not.toBeInTheDocument();
  });

  it("calls onOpenChange with the new open state on toggle", () => {
    const onOpenChange = vi.fn();
    render(
      <Dropdown trigger={<button>Menu</button>} onOpenChange={onOpenChange}>
        <div>Custom content</div>
      </Dropdown>,
    );
    fireEvent.click(screen.getByText("Menu"));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText("Menu"));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("closes and reports onOpenChange(false) on an outside click", () => {
    const onOpenChange = vi.fn();
    render(
      <div>
        <Dropdown trigger={<button>Menu</button>} onOpenChange={onOpenChange}>
          <div>Custom content</div>
        </Dropdown>
        <button>Outside</button>
      </div>,
    );
    fireEvent.click(screen.getByText("Menu"));
    expect(screen.getByText("Custom content")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("Outside"));
    expect(screen.queryByText("Custom content")).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
