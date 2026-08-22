/* FindingsHoverCard — a dependency-free hover popover for findings teasers
   (PR list cell + Agent-runs timeline row).

   The panel is rendered in a PORTAL to document.body with position:fixed, so it
   is never clipped by an ancestor's `overflow:hidden` (the PR-list table card
   has one). Position is measured from the anchor on open and recomputed on
   scroll/resize; it opens below the anchor and flips above when there isn't room.

   - Opens on mouse-enter, closes on mouse-leave with a short delay. Because the
     panel lives outside the anchor's DOM subtree, both the anchor and the panel
     share the open/close timers so moving the pointer across the 6px gap keeps
     it open.
   - Closes on Escape and on scroll of an ancestor.
   - The popover is decoration over already-visible counts (the full, actionable
     list is the detail Findings panel), so it is aria-hidden. */
"use client";

import React from "react";
import { createPortal } from "react-dom";

const CLOSE_DELAY_MS = 120;
const GAP = 6;
const MAX_PANEL_H = 340; // matches the panel's max-height + header, for flip math

type Coords = { left: number; top: number; placement: "below" | "above" };

export function FindingsHoverCard({
  anchor,
  header,
  children,
  align = "left",
  width = 380,
}: {
  anchor: React.ReactNode;
  header: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<Coords | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const anchorRef = React.useRef<HTMLSpanElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => setMounted(true), []);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelClose]);
  React.useEffect(() => cancelClose, [cancelClose]);

  const place = React.useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const roomBelow = vh - r.bottom;
    const placement: Coords["placement"] =
      roomBelow < MAX_PANEL_H && r.top > roomBelow ? "above" : "below";
    // Horizontal: align to the requested edge, then clamp into the viewport.
    let left = align === "right" ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, vw - width - 8));
    const top = placement === "below" ? r.bottom + GAP : r.top - GAP;
    setCoords({ left, top, placement });
  }, [align, width]);

  const handleOpen = React.useCallback(() => {
    cancelClose();
    place();
    setOpen(true);
  }, [cancelClose, place]);

  // Reposition / dismiss while open.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Close when the PAGE scrolls (the fixed panel would otherwise detach from
    // its anchor) — but NOT when the user scrolls inside the panel's own list.
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const panel =
    open && coords ? (
      <div
        ref={panelRef}
        role="presentation"
        aria-hidden
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          left: coords.left,
          top: coords.placement === "below" ? coords.top : undefined,
          bottom:
            coords.placement === "above" ? window.innerHeight - coords.top : undefined,
          width,
          maxWidth: "92vw",
          zIndex: 1000,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 12px 32px rgba(0,0,0,0.32)",
          overflow: "hidden",
          textAlign: "left",
          cursor: "default",
        }}
      >
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          {header}
        </div>
        <div
          style={{
            maxHeight: 320,
            overflowY: "auto",
            overflowX: "hidden",
            padding: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            boxSizing: "border-box",
          }}
        >
          {children}
        </div>
      </div>
    ) : null;

  return (
    <span
      ref={anchorRef}
      style={{ display: "inline-flex" }}
      onMouseEnter={handleOpen}
      onMouseLeave={scheduleClose}
    >
      {anchor}
      {mounted && panel ? createPortal(panel, document.body) : null}
    </span>
  );
}
