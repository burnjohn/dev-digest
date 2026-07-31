/* HoverCard — lightweight hover popover (no such UI primitive exists). Content
   mounts only while open, so a data-fetching child (e.g. ListFindingsPreview)
   fires its request on hover, not upfront. Small close delay lets the pointer
   travel from trigger to card. */
"use client";

import React from "react";

export function HoverCard({
  trigger,
  children,
  width = 400,
  align = "left",
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  align?: "left" | "right";
}) {
  const [open, setOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const openNow = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  React.useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
    >
      {trigger}
      {open && (
        <div
          role="dialog"
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
          style={{
            position: "absolute",
            top: "100%",
            [align]: 0,
            marginTop: 6,
            zIndex: 50,
            width,
          }}
        >
          {children}
        </div>
      )}
    </span>
  );
}
