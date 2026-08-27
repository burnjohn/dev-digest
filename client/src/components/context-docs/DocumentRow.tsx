"use client";

import type { ReactNode } from "react";
import { Checkbox, Icon } from "@devdigest/ui";
import type { ContextDocument } from "@/lib/types";
import { OversizedMarker } from "./OversizedMarker";
import { TokenEstimate } from "./TokenEstimate";
import { TypeBadge } from "./TypeBadge";
import { splitDocPath } from "./helpers";
import { s } from "./styles";

export interface DocumentRowDragProps {
  /** True whenever this row IS the drag source under the cursor's grip. */
  dragging?: boolean;
  /** True whenever this row is the current drop target of some other drag. */
  dropTarget?: boolean;
  onDragStart: (e: React.DragEvent<HTMLElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDragLeave?: () => void;
  onDrop: (e: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  /** Keyboard-operable equivalent of a drag (REQ-36): `-1` moves the row up
      one slot, `1` moves it down one — the SAME underlying reorder a pointer
      drop onto the adjacent row would perform, so the two paths can never
      diverge in what ordering they produce. */
  onKeyReorder: (delta: -1 | 1) => void;
  /** Accessible name for the grip — should describe the row's current
      position (e.g. "Reorder security-baseline.md — position 1 of 3."). */
  gripAriaLabel: string;
}

export interface DocumentRowProps {
  document: ContextDocument;
  /** Omit to render a read-only row (the Project Context page never attaches
      anything). Pass — even `false` — to render a checkbox (both `Context`
      tabs). */
  checked?: boolean;
  onToggle?: (checked: boolean) => void;
  checkboxAriaLabel?: string;
  /** Omit for a static row; pass the full set to enable the drag grip and its
      keyboard equivalent (both `Context` tabs). */
  drag?: DocumentRowDragProps;
  /**
   * The surface-specific preview affordance — a labelled `Preview` button in
   * the agent tab, an eye icon in the skill tab (SPEC-01 § Design review,
   * "left open"). Rendered as-is: this component never hard-codes a
   * treatment, which is what lets the three surfaces share one row anatomy
   * while disagreeing on this one control.
   */
  previewAction?: ReactNode;
  /** Extra content appended after the token estimate — e.g. the Project
      Context page's `Used by N agents` chip (AC-7), which neither `Context`
      tab renders. */
  trailing?: ReactNode;
}

/** One document row — the anatomy the Project Context page and both `Context`
    tabs share (owner decision, SPEC-01): drag grip, checkbox, filename with
    its dimmed folder path, type badge, token estimate, oversized marker, and
    a surface-supplied preview action. */
export function DocumentRow({
  document,
  checked,
  onToggle,
  checkboxAriaLabel,
  drag,
  previewAction,
  trailing,
}: DocumentRowProps) {
  const { dir, filename } = splitDocPath(document.path);
  const selectable = checked !== undefined;

  return (
    <li
      style={s.row(drag?.dragging ?? false, drag?.dropTarget ?? false)}
      draggable={!!drag}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDragLeave={drag?.onDragLeave}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
    >
      {drag && (
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            // The row itself is a drag source too (see above); stop this one
            // from also bubbling into it and starting a second drag.
            e.stopPropagation();
            drag.onDragStart(e);
          }}
          onDragEnd={drag.onDragEnd}
          aria-label={drag.gripAriaLabel}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              drag.onKeyReorder(-1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              drag.onKeyReorder(1);
            }
          }}
          style={s.grip(drag.dragging ?? false)}
        >
          <Icon.Menu size={14} aria-hidden="true" />
        </button>
      )}
      {selectable && (
        <Checkbox
          checked={!!checked}
          onChange={onToggle}
          ariaLabel={checkboxAriaLabel ?? document.path}
        />
      )}
      <span style={s.name}>
        <span className="mono" style={s.filename}>
          {filename}
        </span>
        {dir && (
          <span className="mono" style={s.dir}>
            {dir}
          </span>
        )}
      </span>
      <span style={s.spacer} />
      <TypeBadge type={document.type} />
      <TokenEstimate count={document.token_estimate} />
      {document.oversized && <OversizedMarker />}
      {trailing}
      {previewAction}
    </li>
  );
}
