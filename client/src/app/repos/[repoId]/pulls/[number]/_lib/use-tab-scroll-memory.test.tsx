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

/** REQ-36: mirrors `page.tsx`'s real shape, where the sentinel is absent on
 * the FIRST commit (the `isLoading` skeleton renders no sentinel at all) and
 * appears only once `mountSentinel` flips true (the success branch) — the
 * case the plain `Harness` above, which always mounts the sentinel, cannot
 * express. */
function DelayedHarness({ tab, mountSentinel }: { tab: string; mountSentinel: boolean }) {
  const sentinelRef = useTabScrollMemory(tab);
  return (
    <div data-testid="scroll-container" style={{ overflowY: "auto" }}>
      {mountSentinel && (
        <div ref={sentinelRef} data-testid="sentinel">
          tab body: {tab}
        </div>
      )}
    </div>
  );
}

/** REQ-37: mirrors the real bug's ordering — a tab switch's browser-driven
 * `scrollTop` clamp for the outgoing tab's now-unmounted content fires
 * BEFORE this hook's own restore effect runs. A `useLayoutEffect` declared
 * BEFORE the `useTabScrollMemory` call registers first (same-component
 * effects fire in declaration order), and — like every layout effect in the
 * tree — it completes before React flushes ANY passive effect, so
 * `activeTabRef` (updated in a plain `useEffect`) is still stale when it
 * fires the simulated clamp's "scroll" event. That is the only way to
 * reproduce the real ordering under RTL's synchronous `act()`, which
 * otherwise flushes every effect (including the passive one) before a
 * `fireEvent.scroll` called from the test body could ever observe a stale
 * `activeTabRef`. */
function ClampHarness({ tab, clampTo }: { tab: string; clampTo: number | null }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const prevTabRef = React.useRef(tab);
  React.useLayoutEffect(() => {
    if (clampTo != null && prevTabRef.current !== tab && containerRef.current) {
      // The mutation this simulates: the outgoing tab's taller content
      // unmounts and the browser clamps `scrollTop`, dispatching a "scroll"
      // event before this hook's own restore effect (registered below) runs.
      containerRef.current.scrollTop = clampTo;
      containerRef.current.dispatchEvent(new Event("scroll", { bubbles: false }));
    }
    prevTabRef.current = tab;
  });
  const sentinelRef = useTabScrollMemory(tab);
  return (
    <div ref={containerRef} data-testid="scroll-container" style={{ overflowY: "auto" }}>
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

  it("REQ-36: still resolves and restores the offset when the sentinel is absent on the first render and only appears on a rerender", () => {
    // First commit: no sentinel at all — mirrors page.tsx's `isLoading`
    // branch, where `findScrollContainer(null)` used to silently return
    // `document.scrollingElement` and cache that wrong answer forever.
    const { getByTestId, rerender } = render(<DelayedHarness tab="diff" mountSentinel={false} />);
    const container = getByTestId("scroll-container");

    // Success branch lands: the sentinel mounts for the first time.
    rerender(<DelayedHarness tab="diff" mountSentinel={true} />);

    container.scrollTop = 640;
    fireEvent.scroll(container);

    rerender(<DelayedHarness tab="findings" mountSentinel={true} />);
    rerender(<DelayedHarness tab="diff" mountSentinel={true} />);

    expect(container.scrollTop).toBe(640);
  });

  it("REQ-37: a tab switch's clamp does not overwrite the outgoing tab's remembered offset, and a genuine scroll after the switch settles is still recorded", () => {
    const { getByTestId, rerender } = render(<ClampHarness tab="diff" clampTo={null} />);
    const container = getByTestId("scroll-container");

    container.scrollTop = 2400;
    fireEvent.scroll(container);

    // Switch away: the "findings" tab has no remembered offset, so the
    // hook's own restore would write 0 — and, under today's code, the
    // browser-clamp simulation below (which fires BEFORE that restore, same
    // as the real bug) writes that same 0 under "diff" via the stale
    // `activeTabRef`, instead of under "findings" where it belongs. Under
    // today's code, the final assertion below reads 0 instead of 2400.
    rerender(<ClampHarness tab="findings" clampTo={0} />);

    // A genuine user scroll on "findings", once the switch has settled
    // (the layout effect has already lowered `switchingRef`), is still
    // recorded normally.
    container.scrollTop = 300;
    fireEvent.scroll(container);

    rerender(<ClampHarness tab="diff" clampTo={null} />);
    expect(container.scrollTop).toBe(2400);

    rerender(<ClampHarness tab="findings" clampTo={null} />);
    expect(container.scrollTop).toBe(300);
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
