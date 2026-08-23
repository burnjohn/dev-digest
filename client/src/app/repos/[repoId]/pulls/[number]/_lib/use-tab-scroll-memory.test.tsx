import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
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
});

afterEach(() => {
  if (originalScrollTop) {
    Object.defineProperty(HTMLElement.prototype, "scrollTop", originalScrollTop);
  }
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

/** Pins the real bug (docs/plans/04-smart-diff.md "REQ-24 / REQ-36 / REQ-37 —
 * status correction, 2026-08-22"): the browser clamps `scrollTop` when a
 * shorter tab's content mounts, and that clamp's own "scroll" event arrives
 * ASYNCHRONOUSLY — strictly after the render that swapped tabs has committed,
 * and after the test's `rerender()` call has already returned control. A
 * `useLayoutEffect` here mimics the clamp itself (mutating `scrollTop` once
 * the new, shorter content is in the DOM); `setTimeout` schedules the
 * "scroll" event on a later macrotask, which is the only way to reproduce
 * that ordering under RTL's synchronous `act()`. The mutation this test
 * pins: reading `scrollTop` in a `useLayoutEffect` on tab change instead of
 * during render would read this ALREADY-CLAMPED value — the layout effect
 * fires strictly after the render-phase snapshot the hook actually takes,
 * so only a render-phase read is guaranteed to see the outgoing tab's true,
 * pre-clamp offset. */
function AsyncClampHarness({ tab, clampTo }: { tab: string; clampTo: number | null }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const prevTabRef = React.useRef(tab);
  React.useLayoutEffect(() => {
    if (clampTo != null && prevTabRef.current !== tab && containerRef.current) {
      const el = containerRef.current;
      el.scrollTop = clampTo;
      setTimeout(() => {
        el.dispatchEvent(new Event("scroll", { bubbles: false }));
      }, 0);
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
    // The mutation this catches: removing the render-phase capture (or the
    // `useLayoutEffect` restore, or keying the offsets map on something
    // other than `activeTab`) makes this assertion read 0 — the tab body is
    // a fresh mount with no memory of where the user scrolled to.
    const { getByTestId, rerender } = render(<Harness tab="diff" />);
    const container = getByTestId("scroll-container");

    container.scrollTop = 640;

    rerender(<Harness tab="findings" />);
    rerender(<Harness tab="diff" />);

    expect(container.scrollTop).toBe(640);
  });

  it("remembers two tabs' offsets independently", () => {
    const { getByTestId, rerender } = render(<Harness tab="diff" />);
    const container = getByTestId("scroll-container");

    container.scrollTop = 640;
    rerender(<Harness tab="findings" />);

    container.scrollTop = 120;
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

    rerender(<DelayedHarness tab="findings" mountSentinel={true} />);
    rerender(<DelayedHarness tab="diff" mountSentinel={true} />);

    expect(container.scrollTop).toBe(640);
  });

  it("pins the async-clamp bug: an offset read during render survives a clamp whose scroll event arrives after rerender() returns", async () => {
    const { getByTestId, rerender } = render(<AsyncClampHarness tab="diff" clampTo={null} />);
    const container = getByTestId("scroll-container");

    container.scrollTop = 2400;

    // Switch away: the outgoing "diff" offset must be captured from the
    // render-phase snapshot, before the harness's own layout effect can
    // clamp `scrollTop` for the (empty, shorter) "findings" tab.
    rerender(<AsyncClampHarness tab="findings" clampTo={0} />);
    // Let the simulated async clamp's "scroll" event actually fire — it
    // must be a no-op: this hook registers no "scroll" listener at all.
    await new Promise((resolve) => setTimeout(resolve, 0));

    rerender(<AsyncClampHarness tab="diff" clampTo={null} />);
    expect(container.scrollTop).toBe(2400);
  });

  it("registers no scroll listener at all", () => {
    // Replaces a prior cleanup test that asserted `addEventListener` was
    // called `with("scroll", expect.any(Function))` — `expect.any(Function)`
    // made that assertion pass for ANY function, including one that did
    // nothing, so it never actually proved a listener was wired up. This
    // hook no longer listens for "scroll" at all: the offset comes from a
    // render-phase read, not an event.
    const addSpy = vi.spyOn(HTMLElement.prototype, "addEventListener");

    render(<Harness tab="diff" />);

    expect(addSpy).not.toHaveBeenCalledWith("scroll", expect.anything());
  });
});
