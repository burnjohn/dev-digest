"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ShellContext } from "@devdigest/ui";
import { useTheme } from "../../../lib/theme";
import { useActiveRepo } from "../../../lib/repo-context";
import { usePulls, useDeleteRepo } from "../../../lib/hooks";
import { activeKeyFor, toShellRepo } from "../helpers";

interface ShellContextOptions {
  onOpenCommandPalette: () => void;
  /** Called when the user requests repo removal; the caller shows a confirm dialog. */
  onRequestRemoveRepo?: (id: string, name: string) => void;
}

/**
 * Assembles the `ShellContext` consumed by AppFrame: active nav key, the repo
 * list/active repo (mapped to the shell shape), theme, PR count, and the repo
 * selection / add / removal actions.
 */
export function useShellContext({ onOpenCommandPalette, onRequestRemoveRepo }: ShellContextOptions): ShellContext & {
  pendingRemoveRepo: { id: string; name: string } | null;
  confirmRemoveRepo: () => void;
  cancelRemoveRepo: () => void;
} {
  const t = useTranslations("shell");
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const { repoId, repos, activeRepo, setRepoId } = useActiveRepo();
  const { data: pulls } = usePulls(repoId);
  const deleteRepo = useDeleteRepo();
  const [pendingRemoveRepo, setPendingRemoveRepo] = React.useState<{ id: string; name: string } | null>(null);

  const onSelectRepo = React.useCallback(
    (id: string) => {
      setRepoId(id);
      router.push(`/repos/${id}/pulls`);
    },
    [setRepoId, router],
  );

  const onAddRepo = React.useCallback(() => router.push("/onboarding"), [router]);

  const onRemoveRepo = React.useCallback(
    (id: string) => {
      const target = repos.find((r) => r.id === id);
      const name = target?.full_name ?? t("removeRepo.fallbackName");
      if (onRequestRemoveRepo) {
        onRequestRemoveRepo(id, name);
      } else {
        setPendingRemoveRepo({ id, name });
      }
    },
    [repos, t, onRequestRemoveRepo],
  );

  const confirmRemoveRepo = React.useCallback(() => {
    if (!pendingRemoveRepo) return;
    const { id } = pendingRemoveRepo;
    setPendingRemoveRepo(null);
    deleteRepo.mutate(id, {
      onSuccess: () => {
        if (repoId === id) {
          const next = repos.find((r) => r.id !== id);
          router.push(next ? `/repos/${next.id}/pulls` : "/onboarding");
        }
      },
    });
  }, [pendingRemoveRepo, deleteRepo, repoId, repos, router]);

  const cancelRemoveRepo = React.useCallback(() => setPendingRemoveRepo(null), []);

  const shellCtx = React.useMemo<ShellContext>(
    () => ({
      Link,
      activeKey: activeKeyFor(pathname),
      repoId,
      repos: repos.map(toShellRepo),
      activeRepo: activeRepo ? toShellRepo(activeRepo) : null,
      theme,
      onToggleTheme: toggle,
      onOpenCommandPalette,
      onSelectRepo,
      onAddRepo,
      onRemoveRepo,
      // Sidebar badge = PRs that still NEED review, not the total PR count.
      // 0 → undefined so the badge hides entirely when nothing needs review.
      prCount: pulls?.filter((p) => p.status === "needs_review").length || undefined,
    }),
    [
      pathname,
      repoId,
      repos,
      activeRepo,
      theme,
      toggle,
      onOpenCommandPalette,
      onSelectRepo,
      onAddRepo,
      onRemoveRepo,
      pulls,
    ],
  );

  return { ...shellCtx, pendingRemoveRepo, confirmRemoveRepo, cancelRemoveRepo };
}
