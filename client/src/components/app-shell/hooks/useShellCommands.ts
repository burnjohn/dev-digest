"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { NAV, SETTINGS_ITEM, resolveHref, type Command } from "@devdigest/ui";
import { useActiveRepo } from "../../../lib/repo-context";
import { useTheme } from "../../../lib/theme";

/**
 * Builds the command-palette command set: one "Go to …" command per nav item,
 * plus Settings and a theme toggle. Memoized on its inputs.
 */
export function useShellCommands(): Command[] {
  const t = useTranslations("shell");
  const router = useRouter();
  const { repoId } = useActiveRepo();
  const { theme, toggle } = useTheme();

  return React.useMemo<Command[]>(() => {
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
}
