"use client";

import React from "react";

/**
 * Restores the scroll offset of the PR-detail tab body across a tab switch.
 *
 * `page.tsx` renders each tab as `{tab === "diff" && <DiffTab/>}`, so switching
 * away unmounts the tab body outright and switching back is a fresh mount —
 * `scrollTop` starts at 0 with no memory of where the user was (REQ-24,
 * docs/plans/04-smart-diff.md §5.6). Fixing that by threading a scroll-container
 * ref out of `vendor/ui/shell/AppFrame` was rejected there: `AppFrame` is a
 * design-system primitive rendered by every page and is hand-maintained
 * (outside `scripts/sync-vendor.sh`'s reach), so a single page's bug is not
 * worth a repo-wide, unchecked edit. This hook instead finds the real scroll
 * container itself and never touches `AppFrame`.
 *
 * Usage: attach the returned ref to the tab-body wrapper `<div>` that stays
 * mounted across every tab switch (it must NOT be inside the conditionally
 * rendered tab content, or there is nothing left to resolve the container
 * from). The container is found by walking up from that node to the nearest
 * ancestor whose computed `overflowY` is `auto` or `scroll` — in this app
 * that is `<main>` in `vendor/ui/shell/AppFrame.tsx` (client/INSIGHTS.md,
 * 2026-08-17) — falling back to `document.scrollingElement`.
 *
 * A `Map<tab, scrollTop>` is kept in a ref (not state — this must never
 * trigger a render) and is updated on every real scroll event, rAF-throttled.
 * On every `activeTab` change the remembered offset for the new tab is
 * written back in a `useLayoutEffect`, i.e. before paint, so there is no
 * visible jump-to-top-then-snap-back.
 *
 * REQ-36: `page.tsx` renders the sentinel only inside its success branch, so
 * the FIRST commit (the `isLoading` skeleton) has no sentinel at all. The
 * returned ref is therefore a CALLBACK ref, not a plain `useRef` object — a
 * plain ref never triggers a re-render when it attaches, so an effect keyed
 * off `activeTab` alone would resolve the scroll container against `null`
 * on that first commit (silently falling back to `document.scrollingElement`,
 * which never scrolls in this shell) and then cache that wrong answer
 * forever behind the `if (!containerRef.current)` guard. Routing the
 * sentinel through `useState` gives both effects below a real dependency —
 * `sentinelEl` — so they re-run and resolve the REAL ancestor once the
 * sentinel actually mounts, however many renders later that is.
 */
export function useTabScrollMemory(activeTab: string): React.RefCallback<HTMLDivElement> {
  const [sentinelEl, setSentinelEl] = React.useState<HTMLDivElement | null>(null);
  const sentinelRef = React.useCallback((node: HTMLDivElement | null) => {
    setSentinelEl(node);
  }, []);
  const containerRef = React.useRef<HTMLElement | null>(null);
  const offsetsRef = React.useRef<Map<string, number>>(new Map());
  const activeTabRef = React.useRef(activeTab);

  // REQ-37: a tab switch triggers TWO scrollTop writes the listener must
  // never record — the browser clamping the outgoing tab's now-unmounted
  // content, and this hook's own restore below. Both land in the same
  // rAF-coalesced listener callback, and rAF callbacks run BEFORE React
  // flushes passive effects — so if the listener recorded them, it would
  // write the post-restore value under `activeTabRef`'s stale (OUTGOING)
  // tab, destroying the offset the user actually left. `switchingRef` is
  // raised HERE, synchronously during render, because render runs before
  // the DOM mutation that causes the clamp — an effect would run too late,
  // after the clamp has already fired. It is lowered only once the restore
  // below has been written, synchronously (not via `setTimeout`/rAF, whose
  // ordering against the already-scheduled scroll rAF is not guaranteed).
  const switchingRef = React.useRef(false);
  if (activeTabRef.current !== activeTab) {
    switchingRef.current = true;
  }

  // Restore the remembered offset for the new tab, before paint. Only cache
  // a container resolved from a REAL ancestor walk — i.e. once the sentinel
  // has actually mounted — never from `sentinelEl === null`.
  React.useLayoutEffect(() => {
    if (!containerRef.current && sentinelEl) {
      containerRef.current = findScrollContainer(sentinelEl);
    }
    const container = containerRef.current;
    if (container) {
      container.scrollTop = offsetsRef.current.get(activeTab) ?? 0;
    }
    switchingRef.current = false;
  }, [activeTab, sentinelEl]);

  // Keep the "current tab" ref current for the scroll listener's closure —
  // a plain effect is enough since only FUTURE scroll events need it.
  React.useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Remember where the user is, continuously and rAF-throttled, so the value
  // is already correct by the time the user switches tabs — reading it only
  // "on the way out" is too late once the outgoing tab's content has already
  // been unmounted in the same commit (its scrollHeight has already changed).
  // Depends on `sentinelEl` (not `[]`) so it re-attaches once the real
  // container appears, instead of binding once — possibly to nothing usable
  // — at mount time.
  React.useEffect(() => {
    if (!containerRef.current && sentinelEl) {
      containerRef.current = findScrollContainer(sentinelEl);
    }
    const container = containerRef.current;
    if (!container) return;

    // `pending` (not `rafId`) is the in-flight guard: a synchronous rAF stub —
    // real browsers never do this, but a test double legitimately might, to
    // stay deterministic without fake timers — runs its callback before
    // `requestAnimationFrame`'s own return value is assigned to `rafId`, so a
    // guard keyed on `rafId` gets clobbered back to non-null immediately
    // after the callback resets it and misses every scroll after the first.
    let rafId: number | null = null;
    let pending = false;
    const onScroll = () => {
      // REQ-37: while a tab switch is in flight, neither the browser's
      // clamp nor this hook's own restore should ever schedule an rAF —
      // see the `switchingRef` comment above `useLayoutEffect`.
      if (pending || switchingRef.current) return;
      pending = true;
      rafId = window.requestAnimationFrame(() => {
        pending = false;
        rafId = null;
        if (containerRef.current) {
          offsetsRef.current.set(activeTabRef.current, containerRef.current.scrollTop);
        }
      });
    };
    container.addEventListener("scroll", onScroll);
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (rafId != null) window.cancelAnimationFrame(rafId);
    };
  }, [sentinelEl]);

  return sentinelRef;
}

function findScrollContainer(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const overflowY = window.getComputedStyle(el).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return el;
    el = el.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}
