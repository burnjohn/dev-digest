import React from "react";
import { createPortal } from "react-dom";
import { IconBtn } from "../primitives";

/* Elements a browser treats as reachable by Tab. Used both to pick the
   initial focus target and to compute the trap boundary on every Tab press —
   never cached, since content (footer buttons, form fields) can change while
   the dialog is open. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  width = 720,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  width?: number;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose?: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const hasTitle = title !== undefined && title !== null && title !== "";
  // Read through a ref inside the effect so the listener isn't torn down and
  // re-attached (which would also re-run the initial-focus logic) every time
  // a consumer passes a fresh onClose closure.
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  // Mount = open, unmount = close: every consumer in this codebase renders
  // `{open && <Modal .../>}` rather than passing an `open` prop, so there is
  // no separate "open" transition to react to — see VersionsTab.tsx.
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable[0] ?? dialog).focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const current = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (current.length === 0) {
        e.preventDefault();
        return;
      }
      const first = current[0]!;
      const last = current[current.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  // PORTALLED to <body>, and that is load-bearing — not tidiness. A consumer
  // can render <Modal> from inside a dimmed subtree (FindingCard applies
  // `opacity: .6` to an accepted/dismissed card, and its "Turn into eval case"
  // modal is a DOM child of that card). `opacity < 1` groups the whole subtree
  // into one composited layer, so an in-tree dialog is painted at the
  // ancestor's alpha AND confined to the stacking context that opacity
  // creates — the modal came out see-through with page content on top of it.
  // The portal takes it out of that group entirely. Same reasoning as
  // FindingsIndicator's popup.
  const overlay = (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", zIndex: 50, padding: 28 }}>
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", animation: "ddfadein .15s ease" }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hasTitle ? titleId : undefined}
        tabIndex={-1}
        style={{
          position: "relative",
          width,
          maxWidth: "100%",
          maxHeight: "92%",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: 14,
          boxShadow: "var(--shadow-modal)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "ddpop .18s ease",
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            padding: "18px 24px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ flex: 1 }}>
            <div id={hasTitle ? titleId : undefined} style={{ fontSize: 16, fontWeight: 700 }}>
              {title}
            </div>
            {subtitle && (
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
          {onClose && <IconBtn icon="X" label="Close" onClick={onClose} />}
        </div>
        <div style={{ flex: 1, overflow: "auto", overscrollBehavior: "contain" }}>{children}</div>
        {footer && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "16px 24px", background: "var(--bg-surface)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  // No document during SSR: render nothing then. Every consumer mounts the
  // modal from an interaction, so the server never has one open.
  return typeof document === "undefined" ? null : createPortal(overlay, document.body);
}
