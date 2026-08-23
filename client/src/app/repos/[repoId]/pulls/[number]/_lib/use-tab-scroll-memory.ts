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
 * The offset is captured in the RENDER PHASE, not from a `scroll` listener
 * (docs/plans/04-smart-diff.md "REQ-24 / REQ-36 / REQ-37 — status correction,
 * 2026-08-22"). A prior design recorded the outgoing tab's `scrollTop` from a
 * `scroll` listener, rAF-throttled, with a suppression window meant to ignore
 * the browser's own clamp of the outgoing tab's now-shorter content. That
 * design was wrong because `scroll` events are ASYNCHRONOUS — verified in
 * Chrome — so the clamp's event lands after any suppression window has
 * already closed and overwrites the real offset with 0 (measured: 2400 →
 * switch away → switch back → 0, while every jsdom test passed). Instead:
 * on the render where `activeTab` changes, read `containerRef.current.scrollTop`
 * synchronously, in the component body, before React commits. At that moment
 * the DOM still holds the OUTGOING tab's taller content, so the value read is
 * the true pre-clamp offset — with no dependence on event timing at all.
 *
 * Because the offsets map is no longer updated continuously, the restore
 * (a `useLayoutEffect`, so it lands before paint) must fire only when the
 * position is actually stale for the current tab — `restoredForRef` holds
 * the tab it last positioned, so a layout-effect re-run caused by the
 * sentinel unmounting and remounting (see REQ-36 below) cannot stomp a
 * scroll position the user is currently sitting in with a second, redundant
 * restore.
 *
 * REQ-36: `page.tsx` renders the sentinel only inside its success branch, so
 * the FIRST commit (the `isLoading` skeleton) has no sentinel at all. The
 * returned ref is therefore a CALLBACK ref, not a plain `useRef` object — a
 * plain ref never triggers a re-render when it attaches, so an effect keyed
 * off `activeTab` alone would resolve the scroll container against `null`
 * on that first commit (silently falling back to `document.scrollingElement`,
 * which never scrolls in this shell) and then cache that wrong answer
 * forever behind the `if (!containerRef.current)` guard. Routing the
 * sentinel through `useState` gives the effect below a real dependency —
 * `sentinelEl` — so it re-runs and resolves the REAL ancestor once the
 * sentinel actually mounts, however many renders later that is.
 */
export function useTabScrollMemory(activeTab: string): React.RefCallback<HTMLDivElement> {
  const [sentinelEl, setSentinelEl] = React.useState<HTMLDivElement | null>(null);
  const sentinelRef = React.useCallback((node: HTMLDivElement | null) => {
    setSentinelEl(node);
  }, []);
  const containerRef = React.useRef<HTMLElement | null>(null);
  const offsetsRef = React.useRef<Map<string, number>>(new Map());
  const prevTabRef = React.useRef(activeTab);
  // Which tab the restore effect last positioned the container for — the
  // guard that keeps a sentinel remount (REQ-36) from re-running the restore
  // and snapping back to a stale/zero offset while the user hasn't switched.
  const restoredForRef = React.useRef<string | null>(null);

  // Render-phase capture (REQ-24): while `activeTab` is changing, the DOM
  // still shows the OUTGOING tab's content — read is a snapshot, not an
  // event, so it cannot be beaten by an async clamp. This is a read plus two
  // ref writes; it must never touch the DOM.
  if (prevTabRef.current !== activeTab) {
    if (containerRef.current) {
      offsetsRef.current.set(prevTabRef.current, containerRef.current.scrollTop);
    }
    prevTabRef.current = activeTab;
  }

  // Restore the remembered offset for the new tab, before paint — but only
  // once per tab change, never on every re-run this effect happens to see.
  React.useLayoutEffect(() => {
    if (!containerRef.current && sentinelEl) {
      containerRef.current = findScrollContainer(sentinelEl);
    }
    const container = containerRef.current;
    if (!container) return;
    if (restoredForRef.current === activeTab) return;
    container.scrollTop = offsetsRef.current.get(activeTab) ?? 0;
    restoredForRef.current = activeTab;
  }, [activeTab, sentinelEl]);

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
