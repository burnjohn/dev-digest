import React from "react";
import { Icon } from "../icons";

type SelectOption = string | { value: string; label: string };
const optValue = (o: SelectOption) => (typeof o === "string" ? o : o.value);
const optLabel = (o: SelectOption) => (typeof o === "string" ? o : o.label);

/**
 * Custom single-select with a fully styled dropdown — same API as before but
 * replaces the native <select> so the list inherits dark-theme CSS variables.
 */
export function SelectInput({
  value,
  onChange,
  options,
  mono = true,
}: {
  value: string;
  onChange?: (v: string) => void;
  options: SelectOption[];
  mono?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [hi, setHi] = React.useState(0);
  const ref = React.useRef<HTMLDivElement>(null);

  // Close on outside click
  React.useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Reset highlight when opening
  React.useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => optValue(o) === value);
      setHi(idx >= 0 ? idx : 0);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (o: SelectOption) => {
    onChange?.(optValue(o));
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = options[hi];
      if (o) pick(o);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const current = options.find((o) => optValue(o) === value);
  const currentLabel = current ? optLabel(current) : value;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Trigger */}
      <div
        role="combobox"
        aria-expanded={open}
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderRadius: 7,
          border: "1px solid var(--border-strong)",
          background: "var(--bg-elevated)",
          cursor: "pointer",
          outline: "none",
          userSelect: "none",
        }}
      >
        <span
          className={mono ? "mono" : undefined}
          style={{
            flex: 1,
            fontSize: 14,
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {currentLabel}
        </span>
        <Icon.ChevronsUpDown size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      </div>

      {/* Dropdown list */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: 9,
            boxShadow: "var(--shadow-modal)",
            zIndex: 40,
            overflow: "hidden",
            animation: "ddpop .12s ease",
          }}
        >
          <div style={{ padding: 6 }}>
            {options.map((o, i) => {
              const v = optValue(o);
              const sel = v === value;
              const hot = i === hi;
              return (
                <button
                  key={v}
                  type="button"
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(o)}
                  className={mono ? "mono" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "none",
                    background: hot ? "var(--bg-hover)" : "transparent",
                    color: "var(--text-primary)",
                    fontSize: 13,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <Icon.Check
                    size={13}
                    style={{
                      color: sel ? "var(--text-primary)" : "transparent",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {optLabel(o)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
