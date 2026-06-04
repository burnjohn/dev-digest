/* shell.tsx — app chrome: Sidebar, Topbar, AppFrame, NavItem, RepoSwitcher.
   Ported from chrome.jsx; route-aware via an injected Link component so this
   package stays framework-agnostic. The web app passes Next's <Link>. */
import React from "react";
import { Icon } from "./icons";
import { IconBtn, Avatar, Kbd } from "./primitives";
import { Dropdown, type DropdownItemDef } from "./kit";
import { NAV, SETTINGS_ITEM, resolveHref, type NavItemDef } from "./nav";

/** Minimal Link contract — Next's <Link> satisfies this. */
export type LinkLike = React.ComponentType<{
  href: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  onClick?: () => void;
}>;

const DefaultLink: LinkLike = ({ href, children, style, onClick }) => (
  <a href={href} style={style} onClick={onClick}>
    {children}
  </a>
);

export interface RepoSummary {
  id: string;
  full_name: string;
  default_branch?: string;
  syncedLabel?: string;
}

export interface ShellContext {
  Link?: LinkLike;
  /** Active nav key (e.g. "pulls"). */
  activeKey?: string;
  /** Active repo id, used to fill :repoId in hrefs. */
  repoId?: string | null;
  repos?: RepoSummary[];
  activeRepo?: RepoSummary | null;
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  onOpenCommandPalette?: () => void;
  onSelectRepo?: (id: string) => void;
  /** Invoked when the user picks "Add repository…" in the repo switcher. */
  onAddRepo?: () => void;
  /** Invoked when the user removes a repo via the trash action in the switcher. */
  onRemoveRepo?: (id: string) => void;
  onRefresh?: () => void;
  prCount?: number;
}

export function NavItem({
  item,
  active,
  repoId,
  Link = DefaultLink,
}: {
  item: NavItemDef;
  active?: boolean;
  repoId?: string | null;
  Link?: LinkLike;
}) {
  const I = Icon[item.icon];
  const [h, setH] = React.useState(false);
  return (
    <Link href={resolveHref(item.href, repoId)}>
      <div
        onMouseEnter={() => setH(true)}
        onMouseLeave={() => setH(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: active ? 600 : 500,
          cursor: "pointer",
          position: "relative",
          color: active ? "var(--text-primary)" : h ? "var(--text-primary)" : "var(--text-secondary)",
          background: active ? "var(--bg-hover)" : h ? "var(--bg-elevated)" : "transparent",
          transition: "background .12s, color .12s",
        }}
      >
        {active && (
          <span
            style={{
              position: "absolute",
              left: -8,
              top: 7,
              bottom: 7,
              width: 2.5,
              borderRadius: 2,
              background: "var(--accent)",
            }}
          />
        )}
        <I size={16} style={{ color: active ? "var(--accent)" : "inherit" }} />
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.badge && (
          <span
            className="tnum"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-muted)",
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 99,
              padding: "0 8px",
              minWidth: 18,
              textAlign: "center",
            }}
          >
            {item.badge}
          </span>
        )}
      </div>
    </Link>
  );
}

export function RepoSwitcher({ ctx }: { ctx: ShellContext }) {
  const active = ctx.activeRepo;
  const items: DropdownItemDef[] = [
    ...(ctx.repos ?? []).map((r) => ({
      label: r.full_name,
      icon: "GitBranch" as const,
      onClick: () => ctx.onSelectRepo?.(r.id),
      ...(ctx.onRemoveRepo
        ? { onRemove: () => ctx.onRemoveRepo!(r.id), removeLabel: `Remove ${r.full_name}` }
        : {}),
    })),
    ...(ctx.repos && ctx.repos.length ? [{ divider: true }] : []),
    { label: "Add repository…", icon: "Plus", muted: true, onClick: () => ctx.onAddRepo?.() },
  ];
  return (
    <Dropdown
      align="left"
      width={240}
      items={items}
      trigger={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            margin: "0 0 8px",
            borderRadius: 7,
            border: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: "linear-gradient(135deg,#3b82f6,#8b5cf6)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <Icon.GitBranch size={14} style={{ color: "#fff" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="mono"
              style={{
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {active?.full_name ?? "No repo selected"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {active ? `${active.default_branch ?? "main"} · ${active.syncedLabel ?? "not synced"}` : "Add a repo to begin"}
            </div>
          </div>
          <Icon.ChevronsUpDown size={14} style={{ color: "var(--text-muted)" }} />
        </div>
      }
    />
  );
}

export function Sidebar({ ctx }: { ctx: ShellContext }) {
  const Link = ctx.Link ?? DefaultLink;
  return (
    <aside
      style={{
        width: 264,
        flexShrink: 0,
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        padding: "24px 14px 16px",
        gap: 2,
        overflow: "hidden",
      }}
    >
      <Link href="/">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 5px 14px" }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: "var(--text-primary)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <Icon.Layers size={15} style={{ color: "var(--bg-primary)" }} />
          </div>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>DevDigest</span>
        </div>
      </Link>
      <RepoSwitcher ctx={ctx} />
      <div style={{ overflowY: "auto", flex: 1, margin: "5px -5px 0", padding: "0 5px" }}>
        {NAV.map((grp, gi) => (
          <div key={gi} style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: "var(--text-muted)",
                padding: "0 14px",
                marginBottom: 8,
              }}
            >
              {grp.section}
            </div>
            {grp.items.map((it) => (
              <NavItem
                key={it.key}
                item={it.key === "pulls" && ctx.prCount != null ? { ...it, badge: String(ctx.prCount) } : it}
                active={ctx.activeKey === it.key}
                repoId={ctx.repoId}
                Link={Link}
              />
            ))}
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 2 }}>
        <NavItem item={SETTINGS_ITEM} active={ctx.activeKey === "settings"} repoId={ctx.repoId} Link={Link} />
      </div>
    </aside>
  );
}

export interface Crumb {
  label: string;
  mono?: boolean;
  href?: string;
}

export function Topbar({ ctx, crumb = [] }: { ctx: ShellContext; crumb?: Crumb[] }) {
  const Link = ctx.Link ?? DefaultLink;
  return (
    <header
      style={{
        height: 52,
        flexShrink: 0,
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-primary)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {crumb.map((c, i) => {
          const last = i === crumb.length - 1;
          const text = (
            <span
              className={c.mono ? "mono" : undefined}
              style={{
                fontSize: 14,
                fontWeight: last ? 600 : 500,
                color: last ? "var(--text-primary)" : "var(--text-secondary)",
                whiteSpace: "nowrap",
              }}
            >
              {c.label}
            </span>
          );
          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <Icon.ChevronRight size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              )}
              {c.href ? <Link href={c.href}>{text}</Link> : text}
            </React.Fragment>
          );
        })}
      </div>
      <button
        onClick={ctx.onOpenCommandPalette}
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: 260,
          padding: "8px 14px",
          borderRadius: 7,
          border: "1px solid var(--border)",
          background: "var(--bg-surface)",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        <Icon.Search size={14} />
        <span style={{ flex: 1, textAlign: "left" }}>Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>
      {ctx.onToggleTheme && (
        <IconBtn
          icon={ctx.theme === "light" ? "Moon" : "Sun"}
          label="Toggle theme"
          onClick={ctx.onToggleTheme}
        />
      )}
      {ctx.onRefresh && <IconBtn icon="RefreshCw" label="Refresh" onClick={ctx.onRefresh} />}
      <IconBtn icon="Bell" label="Notifications" />
      <Avatar name="you" size={26} />
    </header>
  );
}

export function AppFrame({
  ctx,
  crumb,
  children,
}: {
  ctx: ShellContext;
  crumb?: Crumb[];
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        minHeight: "100vh",
        background: "var(--bg-primary)",
        alignItems: "stretch",
      }}
    >
      <Sidebar ctx={ctx} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar ctx={ctx} crumb={crumb} />
        <main style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</main>
      </div>
    </div>
  );
}
