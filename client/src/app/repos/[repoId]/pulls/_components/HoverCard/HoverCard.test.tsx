import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { HoverCard } from "./HoverCard";

afterEach(cleanup);

describe("HoverCard", () => {
  it("mounts content on hover and unmounts after leaving", async () => {
    const { container } = render(
      <HoverCard trigger={<span>counts</span>}>
        <div>popover body</div>
      </HoverCard>,
    );
    const wrapper = container.firstChild as HTMLElement;

    // Closed initially — content is not mounted (so a data-fetch child won't fire).
    expect(screen.queryByText("popover body")).toBeNull();

    fireEvent.mouseEnter(wrapper);
    expect(screen.getByText("popover body")).toBeInTheDocument();

    fireEvent.mouseLeave(wrapper);
    await waitFor(() => expect(screen.queryByText("popover body")).toBeNull());
  });
});
