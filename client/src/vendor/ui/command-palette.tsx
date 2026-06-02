/* command-palette.tsx — Cmd+K palette (scaffold; A6 finalizes action wiring).
   Generic: takes a list of commands + an onRun callback. */
import React from "react";
import { Icon, type IconName } from "./icons";
import { Kbd } from "./primitives";
import { SHORTCUTS } from "./nav";

export interface Command {
  id: string;
  label: string;
  group?: string;
  icon?: IconName;
  hint?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      // focus after paint
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(needle) || c.group?.toLowerCase().includes(needle));
  }, [q, commands]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = filtered[sel];
      if (c) {
        c.run();
        onClose();
      }
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, display: "grid", placeItems: "start center", zIndex: 60, padding: "12vh 28px 28px" }}
      onKeyDown={onKey}
    >
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", animation: "ddfadein .12s ease" }}
      />
      <div
        role="dialog"
        aria-label="Command palette"
        style={{
          position: "relative",
          width: 560,
          maxWidth: "100%",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: 12,
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          animation: "ddpop .14s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <Icon.Search size={16} style={{ color: "var(--text-muted)" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            placeholder="Type a command or search…"
            style={{
              flex: 1,
              fontSize: 15,
              color: "var(--text-primary)",
              background: "transparent",
              border: "none",
              outline: "none",
            }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div style={{ maxHeight: 360, overflow: "auto", padding: 8 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "28px 14px", textAlign: "center", fontSize: 14, color: "var(--text-muted)" }}>
              No commands match “{q}”.
            </div>
          ) : (
            filtered.map((c, i) => {
              const I = c.icon ? Icon[c.icon] : Icon.ArrowRight;
              const on = i === sel;
              return (
                <button
                  key={c.id}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => {
                    c.run();
                    onClose();
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 7,
                    border: "none",
                    background: on ? "var(--bg-hover)" : "transparent",
                    color: "var(--text-primary)",
                    fontSize: 14,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <I size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{c.label}</span>
                  {c.group && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.group}</span>}
                  {c.hint && (
                    <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {c.hint}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/** Shortcuts help (triggered by `?`). */
export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const groups = Array.from(new Set(SHORTCUTS.map((s) => s.group)));
  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", zIndex: 60, padding: 28 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        style={{
          position: "relative",
          width: 520,
          maxWidth: "100%",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: 12,
          boxShadow: "var(--shadow-modal)",
          padding: 24,
          animation: "ddpop .14s ease",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 18 }}>Keyboard shortcuts</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px" }}>
          {groups.map((g) => (
            <div key={g}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  marginBottom: 10,
                }}
              >
                {g}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                    <span style={{ flex: 1, color: "var(--text-secondary)" }}>{s.label}</span>
                    {s.keys.split(" ").map((k, i) => (
                      <Kbd key={i}>{k}</Kbd>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
