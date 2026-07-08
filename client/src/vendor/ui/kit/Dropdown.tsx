import React from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons";
import { type DropdownItemDef } from "./types";

function DropdownItem({ it, onClose }: { it: DropdownItemDef; onClose: () => void }) {
  const [h, setH] = React.useState(false);
  const I = it.icon ? Icon[it.icon] : null;
  return (
    <button
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => {
        it.onClick?.();
        onClose();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 10px",
        borderRadius: 6,
        border: "none",
        background: h ? "var(--bg-hover)" : "transparent",
        color: it.muted ? "var(--text-secondary)" : "var(--text-primary)",
        fontSize: 14,
        fontWeight: 500,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {I && <I size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
      <span style={{ flex: 1 }}>{it.label}</span>
      {it.hint && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{it.hint}</span>}
      {it.onRemove && (
        <span
          role="button"
          aria-label={it.removeLabel ?? "Remove"}
          title={it.removeLabel ?? "Remove"}
          onClick={(e) => {
            e.stopPropagation();
            it.onRemove!();
            onClose();
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 3,
            borderRadius: 5,
            color: "var(--text-muted)",
            flexShrink: 0,
          }}
        >
          <Icon.Trash size={13} />
        </span>
      )}
    </button>
  );
}

interface PanelPos {
  triggerTop: number;
  triggerBottom: number;
  left: number;
}

export function Dropdown({
  trigger,
  items,
  align = "left",
  width = 230,
}: {
  trigger: React.ReactNode;
  items: DropdownItemDef[];
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<PanelPos | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const h = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        panelRef.current && !panelRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const toggle = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const left = align === "right" ? rect.right - width : rect.left;
      setPos({ triggerTop: rect.top, triggerBottom: rect.bottom, left });
    }
    setOpen((o) => !o);
  };

  const panel = open && pos ? createPortal(
    (() => {
      const spaceBelow = window.innerHeight - pos.triggerBottom - 8;
      const spaceAbove = pos.triggerTop - 8;
      const openDown = spaceBelow >= spaceAbove || spaceBelow >= 160;
      const maxH = Math.max(80, openDown ? spaceBelow : spaceAbove);
      const placement = openDown
        ? { top: pos.triggerBottom + 6 }
        : { bottom: window.innerHeight - pos.triggerTop + 6 };
      return (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            ...placement,
            left: pos.left,
            width,
            maxHeight: maxH,
            overflowY: "auto",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: 9,
            boxShadow: "var(--shadow-modal)",
            padding: 6,
            zIndex: 1100,
            animation: "ddpop .12s ease",
          }}
        >
          {items.map((it, i) =>
            it.divider ? (
              <div key={i} style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />
            ) : (
              <DropdownItem key={i} it={it} onClose={() => setOpen(false)} />
            )
          )}
        </div>
      );
    })(),
    document.body,
  ) : null;

  return (
    <div ref={triggerRef} style={{ position: "relative", display: "inline-block" }}>
      <div onClick={toggle}>{trigger}</div>
      {panel}
    </div>
  );
}
