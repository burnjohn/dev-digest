/* AppShell.tsx — binds @devdigest/ui AppFrame to Next routing, theme, repo,
   the Cmd+K command palette, and global keyboard shortcuts (§9). */
"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AppFrame,
  CommandPalette,
  ShortcutsHelp,
  NAV,
  SETTINGS_ITEM,
  resolveHref,
  type Command,
  type Crumb,
  type ShellContext,
} from "@devdigest/ui";
import { useTheme } from "../../lib/theme";
import { useActiveRepo } from "../../lib/repo-context";
import { usePulls } from "../../lib/hooks";
import { G_NAV_TIMEOUT_MS } from "./constants";
import { activeKeyFor } from "./helpers";

export function AppShell({ children, crumb }: { children: React.ReactNode; crumb?: Crumb[] }) {
  const t = useTranslations("shell");
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const { repoId, repos, activeRepo, setRepoId } = useActiveRepo();
  const { data: pulls } = usePulls(repoId);

  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);

  // Global keyboard shortcuts (§9): Cmd+K palette, ? help, g-nav.
  React.useEffect(() => {
    let gPending = false;
    let gTimer: ReturnType<typeof setTimeout> | undefined;
    const isTyping = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (isTyping(e.target)) return;
      if (e.key === "?") {
        setHelpOpen(true);
        return;
      }
      if (e.key === "g") {
        gPending = true;
        clearTimeout(gTimer);
        gTimer = setTimeout(() => (gPending = false), G_NAV_TIMEOUT_MS);
        return;
      }
      if (gPending) {
        gPending = false;
        const target = NAV.flatMap((g) => g.items).find((it) => it.gKey === e.key);
        if (target) router.push(resolveHref(target.href, repoId));
        else if (e.key === SETTINGS_ITEM.gKey) router.push(SETTINGS_ITEM.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(gTimer);
    };
  }, [router, repoId]);

  const commands = React.useMemo<Command[]>(() => {
    const navCmds: Command[] = NAV.flatMap((g) =>
      g.items.map((it) => ({
        id: it.key,
        label: t("commandPalette.goTo", { label: t(`nav.${it.key}`) }),
        group: g.section,
        icon: it.icon,
        run: () => router.push(resolveHref(it.href, repoId)),
      }))
    );
    navCmds.push({
      id: "settings",
      label: t("commandPalette.goToSettings"),
      group: t("commandPalette.globalGroup"),
      icon: SETTINGS_ITEM.icon,
      run: () => router.push(SETTINGS_ITEM.href),
    });
    navCmds.push({
      id: "toggle-theme",
      label: t("commandPalette.switchTheme", {
        theme: theme === "dark" ? t("theme.light") : t("theme.dark"),
      }),
      group: t("commandPalette.themeAppearanceGroup"),
      icon: theme === "dark" ? "Sun" : "Moon",
      run: toggle,
    });
    return navCmds;
  }, [t, router, repoId, theme, toggle]);

  const ctx: ShellContext = {
    Link,
    activeKey: activeKeyFor(pathname),
    repoId,
    repos: repos.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      default_branch: r.default_branch,
      syncedLabel: r.last_polled_at ? "synced" : "not synced",
    })),
    activeRepo: activeRepo
      ? {
          id: activeRepo.id,
          full_name: activeRepo.full_name,
          default_branch: activeRepo.default_branch,
          syncedLabel: activeRepo.last_polled_at ? "synced" : "not synced",
        }
      : null,
    theme,
    onToggleTheme: toggle,
    onOpenCommandPalette: () => setPaletteOpen(true),
    onSelectRepo: (id) => {
      setRepoId(id);
      router.push(`/repos/${id}/pulls`);
    },
    prCount: pulls?.length,
  };

  return (
    <>
      <AppFrame ctx={ctx} crumb={crumb}>
        {children}
      </AppFrame>
      <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
