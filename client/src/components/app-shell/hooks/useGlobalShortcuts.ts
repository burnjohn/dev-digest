"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { NAV, SETTINGS_ITEM, resolveHref } from "@devdigest/ui";
import { useActiveRepo } from "../../../lib/contexts/repoContext";
import { G_NAV_TIMEOUT_MS } from "../constants";
import { isTextInput } from "../helpers";

interface GlobalShortcutHandlers {
  onOpenPalette: () => void;
  onOpenHelp: () => void;
}

/**
 * Binds the global keyboard shortcuts: Cmd/Ctrl+K opens the command
 * palette, `?` opens shortcuts help, and `g`-then-key navigates to a section.
 */
export function useGlobalShortcuts({ onOpenPalette, onOpenHelp }: GlobalShortcutHandlers): void {
  const router = useRouter();
  const { repoId } = useActiveRepo();

  React.useEffect(() => {
    let gPending = false;
    let gTimer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenPalette();
        return;
      }
      if (isTextInput(e.target)) return;
      if (e.key === "?") {
        onOpenHelp();
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
  }, [router, repoId, onOpenPalette, onOpenHelp]);
}
