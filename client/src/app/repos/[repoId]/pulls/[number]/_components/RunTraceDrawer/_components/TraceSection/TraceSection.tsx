/* TraceSection — collapsible titled section used throughout the trace tab. */
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import { s } from "../../styles";

export function TraceSection({
  icon,
  title,
  right,
  children,
  defaultOpen = true,
}: {
  icon: "Settings" | "Gauge" | "FileText" | "Wrench" | "Code" | "AlertOctagon";
  title: string;
  /** Trailing content in the header. The header is a <button>, so this has to
   *  stay non-interactive (a Badge, a count) — no links or nested buttons. */
  right?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const I = Icon[icon];
  return (
    <div style={s.section}>
      {/* A real button: this is nothing but an expand/collapse control, and it
          holds no interactive children. Keyboard support comes for free. */}
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={s.sectionHead}>
        <I size={15} style={s.sectionIcon} />
        <span style={s.sectionTitle}>{title}</span>
        {right}
        <Icon.ChevronDown size={15} style={s.chevron(open)} />
      </button>
      {open && <div style={s.sectionBody}>{children}</div>}
    </div>
  );
}
