/* primitives.tsx — atoms & molecules shared across screens.
   Ported pixel-for-pixel from prototype primitives.jsx; typed; lucide icons. */
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon, type IconName } from "./icons";

export type Severity = "CRITICAL" | "WARNING" | "SUGGESTION" | "INFO";
export type Category = "bug" | "security" | "perf" | "style" | "test";

export const SEV: Record<
  Severity,
  { c: string; bg: string; icon: IconName; label: string }
> = {
  CRITICAL: { c: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon", label: "Critical" },
  WARNING: { c: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle", label: "Warning" },
  SUGGESTION: { c: "var(--sugg)", bg: "var(--sugg-bg)", icon: "Lightbulb", label: "Suggestion" },
  INFO: { c: "var(--info)", bg: "var(--info-bg)", icon: "Info", label: "Info" },
};

export const CAT: Record<Category, { icon: IconName; label: string }> = {
  bug: { icon: "Bug", label: "bug" },
  security: { icon: "Shield", label: "security" },
  perf: { icon: "Zap", label: "perf" },
  style: { icon: "Code", label: "style" },
  test: { icon: "FlaskConical", label: "test" },
};

type ButtonKind = "primary" | "secondary" | "tertiary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  kind?: ButtonKind;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  active?: boolean;
  full?: boolean;
  children?: React.ReactNode;
}

export function Button({
  kind = "secondary",
  size = "md",
  icon,
  iconRight,
  children,
  active,
  full,
  style,
  ...rest
}: ButtonProps) {
  const I = icon ? Icon[icon] : null;
  const IR = iconRight ? Icon[iconRight] : null;
  const pad = size === "sm" ? "5px 9px" : size === "lg" ? "10px 18px" : "7px 13px";
  const fs = size === "sm" ? 12.5 : size === "lg" ? 14 : 13;
  const [h, setH] = React.useState(false);
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    padding: children ? pad : size === "sm" ? 6 : 8,
    fontSize: fs,
    fontWeight: 500,
    borderRadius: 6,
    border: "1px solid transparent",
    whiteSpace: "nowrap",
    transition: "background .12s, border-color .12s, color .12s",
    lineHeight: 1.2,
    width: full ? "100%" : undefined,
    letterSpacing: "-0.01em",
  };
  const kinds: Record<ButtonKind, React.CSSProperties> = {
    primary: { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" },
    secondary: {
      background: "var(--bg-elevated)",
      color: "var(--text-primary)",
      borderColor: "var(--border-strong)",
    },
    tertiary: {
      background: active ? "var(--bg-hover)" : "transparent",
      color: active ? "var(--text-primary)" : "var(--text-secondary)",
      borderColor: "transparent",
    },
    ghost: { background: "transparent", color: "var(--text-secondary)", borderColor: "var(--border)" },
    danger: { background: "transparent", color: "var(--crit)", borderColor: "var(--border-strong)" },
  };
  const hoverMap: Record<ButtonKind, React.CSSProperties> = {
    primary: { background: "var(--accent-hover)", borderColor: "var(--accent-hover)" },
    secondary: { background: "var(--bg-hover)", borderColor: "var(--text-muted)" },
    tertiary: { background: "var(--bg-hover)", color: "var(--text-primary)" },
    ghost: { background: "var(--bg-hover)", color: "var(--text-primary)" },
    danger: { background: "var(--crit-bg)", borderColor: "var(--crit)" },
  };
  const hover = h ? hoverMap[kind] : {};
  return (
    <button
      {...rest}
      style={{ ...base, ...kinds[kind], ...hover, ...style }}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
    >
      {I && <I size={fs + 2} />}
      {children}
      {IR && <IR size={fs + 2} />}
    </button>
  );
}

export function IconBtn({
  icon,
  label,
  size = 30,
  active,
  onClick,
  danger,
}: {
  icon: IconName;
  label: string;
  size?: number;
  active?: boolean;
  onClick?: () => void;
  danger?: boolean;
}) {
  const I = Icon[icon];
  const [h, setH] = React.useState(false);
  return (
    <button
      title={label}
      aria-label={label}
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
        background: h ? "var(--bg-hover)" : active ? "var(--bg-hover)" : "transparent",
        color: danger && h ? "var(--crit)" : active || h ? "var(--text-primary)" : "var(--text-secondary)",
        transition: "background .12s, color .12s",
      }}
    >
      <I size={Math.round(size * 0.52)} />
    </button>
  );
}

export function Badge({
  children,
  color = "var(--text-secondary)",
  bg = "var(--bg-hover)",
  icon,
  dot,
  mono,
  style,
}: {
  children?: React.ReactNode;
  color?: string;
  bg?: string;
  icon?: IconName;
  dot?: boolean;
  mono?: boolean;
  style?: React.CSSProperties;
}) {
  const I = icon ? Icon[icon] : null;
  return (
    <span
      className={mono ? "mono" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 10px",
        borderRadius: 5,
        fontSize: 12,
        fontWeight: 600,
        color,
        background: bg,
        letterSpacing: mono ? 0 : "0.01em",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dot && (
        <span style={{ width: 6, height: 6, borderRadius: 99, background: color }} />
      )}
      {I && <I size={12} />}
      {children}
    </span>
  );
}

/** Severity badge — always icon + label (WCAG AA: never color alone). */
export function SeverityBadge({
  severity,
  count,
  compact,
}: {
  severity: Severity;
  count?: number;
  compact?: boolean;
}) {
  const s = SEV[severity];
  const I = Icon[s.icon];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: compact ? "2px 6px" : "3px 9px",
        borderRadius: 5,
        fontSize: 12,
        fontWeight: 600,
        color: s.c,
        background: s.bg,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      <I size={12.5} />
      {compact ? null : s.label}
      {count != null && (
        <span className="tnum" style={{ opacity: 0.85 }}>
          {count}
        </span>
      )}
    </span>
  );
}

export function CategoryTag({ category }: { category: Category }) {
  const c = CAT[category];
  if (!c) return null;
  const I = Icon[c.icon];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        color: "var(--text-muted)",
        fontWeight: 500,
      }}
    >
      <I size={12} />
      {c.label}
    </span>
  );
}

export function Chip({
  children,
  active,
  onClick,
  icon,
  count,
  color,
}: {
  children?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  icon?: IconName;
  count?: number;
  color?: string;
}) {
  const I = icon ? Icon[icon] : null;
  const [h, setH] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 12px",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        transition: "all .12s",
        border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
        background: active ? "var(--accent-bg)" : h ? "var(--bg-hover)" : "transparent",
        color: active ? "var(--accent-text)" : h ? "var(--text-primary)" : "var(--text-secondary)",
      }}
    >
      {I && <I size={13} style={color ? { color } : undefined} />}
      {children}
      {count != null && (
        <span className="tnum" style={{ opacity: 0.7, fontSize: 12 }}>
          {count}
        </span>
      )}
    </button>
  );
}

export function Avatar({ name, size = 22, color }: { name: string; size?: number; color?: string }) {
  const initials = name
    .split(/[\s-]/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const hues = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6"];
  const hue = color || hues[name.charCodeAt(0) % hues.length]!;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 99,
        flexShrink: 0,
        display: "inline-grid",
        placeItems: "center",
        fontSize: size * 0.4,
        fontWeight: 600,
        background: hue + "22",
        color: hue,
        border: "1px solid " + hue + "44",
      }}
    >
      {initials}
    </span>
  );
}

export function ConfidenceNum({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const c = pct >= 85 ? "var(--ok)" : pct >= 65 ? "var(--warn)" : "var(--text-muted)";
  return (
    <span
      className="mono tnum"
      title="Model confidence"
      style={{
        fontSize: 12,
        color: "var(--text-muted)",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 99, background: c }} />
      {pct + "% conf"}
    </span>
  );
}

export function MonoLink({
  children,
  onClick,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  const [h, setH] = React.useState(false);
  return (
    <button
      className="mono"
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        fontSize: 13,
        cursor: "pointer",
        color: h ? "var(--accent-text)" : "var(--text-secondary)",
        textDecoration: h ? "underline" : "none",
        textUnderlineOffset: 2,
      }}
    >
      {children}
    </button>
  );
}

export function ProgressBar({
  value,
  color = "var(--accent)",
  height = 6,
  bg = "var(--bg-hover)",
}: {
  value: number;
  color?: string;
  height?: number;
  bg?: string;
}) {
  return (
    <div style={{ width: "100%", height, background: bg, borderRadius: 99, overflow: "hidden" }}>
      <div
        style={{
          width: Math.max(0, Math.min(100, value)) + "%",
          height: "100%",
          background: color,
          borderRadius: 99,
          transition: "width .4s ease",
        }}
      />
    </div>
  );
}

/** Indexing progress with explicit percentage label (spec §11: percent, not spinner). */
export function PercentProgress({
  value,
  label,
  color = "var(--accent)",
}: {
  value: number;
  label?: string;
  color?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(100, value)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", fontSize: 13, color: "var(--text-secondary)" }}>
        {label && <span style={{ flex: 1 }}>{label}</span>}
        <span className="mono tnum" style={{ fontWeight: 600, color: "var(--text-primary)" }}>
          {pct}%
        </span>
      </div>
      <ProgressBar value={pct} color={color} />
    </div>
  );
}

export function CircularScore({
  score,
  size = 44,
  stroke = 4,
}: {
  score: number;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const c = score >= 75 ? "var(--ok)" : score >= 50 ? "var(--warn)" : "var(--crit)";
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-hover)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={c}
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - score / 100)}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset .6s ease" }}
        />
      </svg>
      <div
        className="tnum"
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          fontSize: size * 0.3,
          fontWeight: 700,
        }}
      >
        {score}
      </div>
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  size = 18,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  size?: number;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      style={{
        width: size * 1.85,
        height: size + 4,
        borderRadius: 99,
        border: "none",
        padding: 2,
        background: on ? "var(--accent)" : "var(--border-strong)",
        transition: "background .15s",
        position: "relative",
      }}
    >
      <span
        style={{
          display: "block",
          width: size,
          height: size,
          borderRadius: 99,
          background: "#fff",
          transform: on ? `translateX(${size * 0.85}px)` : "none",
          transition: "transform .15s",
          boxShadow: "0 1px 3px rgba(0,0,0,.3)",
        }}
      />
    </button>
  );
}

export function Kbd({ children }: { children?: React.ReactNode }) {
  return (
    <kbd
      className="mono"
      style={{
        display: "inline-grid",
        placeItems: "center",
        minWidth: 18,
        height: 18,
        padding: "0 6px",
        fontSize: 12,
        color: "var(--text-secondary)",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-strong)",
        borderRadius: 4,
        lineHeight: 1,
      }}
    >
      {children}
    </kbd>
  );
}

export function SectionLabel({
  children,
  icon,
  right,
}: {
  children?: React.ReactNode;
  icon?: IconName;
  right?: React.ReactNode;
}) {
  const I = icon ? Icon[icon] : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      {I && <I size={14} style={{ color: "var(--text-muted)" }} />}
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {children}
      </span>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}

export function Card({
  children,
  pad = true,
  style,
  hover,
  onClick,
}: {
  children?: React.ReactNode;
  pad?: boolean;
  style?: React.CSSProperties;
  hover?: boolean;
  onClick?: () => void;
}) {
  const [h, setH] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => hover && setH(true)}
      onMouseLeave={() => hover && setH(false)}
      style={{
        background: h ? "var(--bg-hover)" : "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: pad ? "var(--card-pad)" : 0,
        transition: "background .12s, border-color .12s",
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  cta,
  onCta,
}: {
  icon?: IconName;
  title: string;
  body?: React.ReactNode;
  cta?: string;
  onCta?: () => void;
}) {
  const I = icon ? Icon[icon] : null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "60px 28px",
        gap: 8,
      }}
    >
      {I && (
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            marginBottom: 8,
          }}
        >
          <I size={22} />
        </div>
      )}
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>
      {body && (
        <div style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 340, lineHeight: 1.5 }}>
          {body}
        </div>
      )}
      {cta && (
        <div style={{ marginTop: 12 }}>
          <Button kind="secondary" icon="Plus" onClick={onCta}>
            {cta}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Skeleton loading bar (uses .skeleton from styles.css). */
export function Skeleton({
  width = "100%",
  height = 14,
  style,
}: {
  width?: number | string;
  height?: number | string;
  style?: React.CSSProperties;
}) {
  return <div className="skeleton" style={{ width, height, ...style }} />;
}

/** Full-screen / inline error (spec §11 error UX taxonomy) with Retry. */
export function ErrorState({
  title = "Something went wrong",
  body,
  onRetry,
  fullScreen,
}: {
  title?: string;
  body?: React.ReactNode;
  onRetry?: () => void;
  fullScreen?: boolean;
}) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 10,
        padding: fullScreen ? "80px 24px" : "40px 24px",
        minHeight: fullScreen ? "60vh" : undefined,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          display: "grid",
          placeItems: "center",
          background: "var(--crit-bg)",
          color: "var(--crit)",
          marginBottom: 5,
        }}
      >
        <Icon.AlertOctagon size={22} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>{title}</div>
      {body && (
        <div style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 380, lineHeight: 1.5 }}>
          {body}
        </div>
      )}
      {onRetry && (
        <div style={{ marginTop: 12 }}>
          <Button kind="secondary" icon="RefreshCw" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

/** Markdown renderer (replaces prototype mdLite). Inline + GFM. */
export function Markdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          strong: ({ children }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{children}</strong>
          ),
          code: ({ children }) => (
            <code
              className="mono"
              style={{
                fontSize: "0.92em",
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--bg-hover)",
                color: "var(--accent-text)",
              }}
            >
              {children}
            </code>
          ),
          a: ({ children, href }) => (
            <a href={href} style={{ color: "var(--accent-text)", textDecoration: "underline" }}>
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
