import React from "react";
import { Icon, type IconName } from "../icons";

export function IconBtn({
  icon,
  label,
  size = 30,
  active,
  onClick,
  danger,
  disabled,
}: {
  icon: IconName;
  label: string;
  size?: number;
  active?: boolean;
  onClick?: () => void;
  danger?: boolean;
  /** Renders inert + dimmed. Prefer this over omitting the button, so controls
      don't reflow as state changes (e.g. a reorder arrow at a list boundary). */
  disabled?: boolean;
}) {
  const I = Icon[icon];
  const [h, setH] = React.useState(false);
  const hot = h && !disabled;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        width: size,
        height: size,
        display: "inline-grid",
        placeItems: "center",
        borderRadius: 6,
        border: "1px solid transparent",
        background: hot ? "var(--bg-hover)" : active ? "var(--bg-hover)" : "transparent",
        color: disabled
          ? "var(--text-muted)"
          : danger && hot
            ? "var(--crit)"
            : active || hot
              ? "var(--text-primary)"
              : "var(--text-secondary)",
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background .12s, color .12s",
      }}
    >
      <I size={Math.round(size * 0.52)} />
    </button>
  );
}
