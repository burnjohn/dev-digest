import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { useTabScrollMemory } from "./use-tab-scroll-memory";

afterEach(cleanup);

// jsdom implements no layout: HTMLElement.prototype.scrollTop is a stub that
// always reads back 0, no matter what is assigned. Install a real, writable
// backing store for the duration of this file so scrollTop behaves like a
// browser's — this is what makes "assert the restored NUMBER" possible at all.
let scrollTopStore: WeakMap<HTMLElement, number>;
let originalScrollTop: PropertyDescriptor | undefined;

beforeEach(() => {
  scrollTopStore = new WeakMap();
  originalScrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      return scrollTopStore.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      scrollTopStore.set(this, value);
    },
  });
  // Run the hook's rAF throttle synchronously so a `fireEvent.scroll` is
  // reflected in the offsets map before the next assertion, with no fake
  // timers or extra `act()` ceremony needed.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  if (originalScrollTop) {
    Object.defineProperty(HTMLElement.prototype, "scrollTop", originalScrollTop);
  }
  vi.unstubAllGlobals();
});

/** Mirrors the real shape: a scrollable ancestor (stand-in for AppFrame's
 * `<main>`) with the hook's sentinel attached to the persistent tab-body div
 * that stays mounted across every tab switch. */
function Harness({ tab }: { tab: string }) {
  const sentinelRef = useTabScrollMemory(tab);
  return (
    <div data-testid="scroll-container" style={{ overflowY: "auto" }}>
      <div ref={sentinelRef} data-testid="sentinel">
        tab body: {tab}
      </div>
    </div>
  );
}

describe("useTabScrollMemory", () => {
  it("restores the Files-changed scroll offset after switching tabs away and back", () => {
    // The mutation this catches: removing the `useLayoutEffect` restore (or
    // keying the offsets map on something other than `activeTab`) makes this
    // assertion read 0 — the tab body is a fresh mount with no memory of
    // where the user scrolled to.
    const { getByTestId, rerender } = render(<Harness tab="diff" />);
    const container = getByTestId("scroll-container");

    container.scrollTop = 640;
    fireEvent.scroll(container);

    rerender(<Harness tab="findings" />);
    rerender(<Harness tab="diff" />);

    expect(container.scrollTop).toBe(640);
  });

  it("remembers two tabs' offsets independently", () => {
    const { getByTestId, rerender } = render(<Harness tab="diff" />);
    const container = getByTestId("scroll-container");

    container.scrollTop = 640;
    fireEvent.scroll(container);
    rerender(<Harness tab="findings" />);

    container.scrollTop = 120;
    fireEvent.scroll(container);
    rerender(<Harness tab="diff" />);

    expect(container.scrollTop).toBe(640);

    rerender(<Harness tab="findings" />);
    expect(container.scrollTop).toBe(120);
  });

  it("cleans up its scroll listener on unmount — no leak across tab switches", () => {
    const addSpy = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const removeSpy = vi.spyOn(HTMLElement.prototype, "removeEventListener");

    const { unmount } = render(<Harness tab="diff" />);
    expect(addSpy).toHaveBeenCalledWith("scroll", expect.any(Function));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
  });
});
