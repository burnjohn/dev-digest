/* Modal.test.tsx — the first test under src/vendor/**.
   NOTE: this repo's lane is `userEvent.setup()` per `react-testing-library`, but
   `@testing-library/user-event` is not a dependency of `client/` (not in
   package.json, not in the lockfile, not installed) and adding it means editing
   both — a Tier A path an implementer may not touch (docs/plans/README.md
   "Protected paths", row `package.json`/lockfile: "A [parent session]
   `pnpm install` step"). Every interaction below is therefore driven through
   `fireEvent`, which needs no extra dependency; see the implementer's report for
   the recommendation to the parent session. */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal";

function Harness({ open }: { open: boolean }) {
  return (
    <div>
      <button type="button">Outside</button>
      {open && (
        <Modal title="Example Title" onClose={() => {}}>
          <button type="button">Body</button>
        </Modal>
      )}
    </div>
  );
}

describe("Modal", () => {
  it("names the dialog from title, and falls back to no name when none is given", () => {
    const { unmount } = render(
      <Modal title="Example Title" onClose={() => {}}>
        <p>Body content</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Example Title" })).toBeInTheDocument();
    unmount();

    render(
      <Modal onClose={() => {}}>
        <p>Untitled body</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-labelledby");
  });

  it("sets overscroll-behavior: contain on the scrolling body", () => {
    render(
      <Modal title="Example Title" onClose={() => {}}>
        <p>Body content</p>
      </Modal>,
    );
    const scrollingBody = screen.getByText("Body content").parentElement;
    expect(scrollingBody?.style.overscrollBehavior).toBe("contain");
  });

  it("invokes onClose on Escape when present, and does nothing without one", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal title="Example Title" onClose={onClose}>
        <button type="button">Body</button>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <Modal title="Example Title">
        <button type="button">Body</button>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus in on mount, cycles Tab/Shift+Tab within the dialog, and restores focus on unmount", () => {
    const { rerender } = render(<Harness open={false} />);
    const outside = screen.getByRole("button", { name: "Outside" });
    outside.focus();
    expect(outside).toHaveFocus();

    rerender(<Harness open={true} />);
    const close = screen.getByRole("button", { name: "Close" });
    const body = screen.getByRole("button", { name: "Body" });
    expect(close).toHaveFocus();

    // Tab from the last focusable wraps back to the first.
    body.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    // Shift+Tab from the first focusable wraps to the last.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(body).toHaveFocus();

    rerender(<Harness open={false} />);
    expect(outside).toHaveFocus();
  });
});
