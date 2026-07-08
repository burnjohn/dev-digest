"use client";

import React from "react";

/**
 * Corrects a popup's left position so it doesn't overflow the viewport.
 * Defers the measurement to a rAF so offsetWidth is non-zero on first render.
 *
 * Returns `[ref, adjustedLeft]` — attach `ref` to the popup element.
 */
export function usePopupPosition(left: number, margin = 12) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [adjustedLeft, setAdjustedLeft] = React.useState(left);

  React.useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (!ref.current) return;
      const overflow = left + ref.current.offsetWidth - window.innerWidth + margin;
      setAdjustedLeft(overflow > 0 ? left - overflow : left);
    });
    return () => cancelAnimationFrame(id);
  }, [left, margin]);

  return [ref, adjustedLeft] as const;
}
