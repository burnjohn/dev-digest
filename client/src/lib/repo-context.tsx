/* repo-context.tsx — tracks the active repo for the shell + :repoId routing.
   Priority: repoId in the URL path > localStorage > first repo from the API. */
"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useRepos } from "./hooks";
import type { Repo } from "./types";

const RepoCtx = React.createContext<{
  repoId: string | null;
  setRepoId: (id: string) => void;
  repos: Repo[];
  activeRepo: Repo | null;
  reposLoaded: boolean;
}>({ repoId: null, setRepoId: () => {}, repos: [], activeRepo: null, reposLoaded: false });

function repoIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  // Optional-chain the capture group instead of asserting it: the group is
  // `[^/]+`, so a match always has a non-empty group 1 — but only the regex
  // says so, not the type, which is `(string | undefined)[]`.
  const id = pathname.match(/^\/repos\/([^/]+)/)?.[1];
  return id ? decodeURIComponent(id) : null;
}

export function RepoProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: repos, isSuccess: reposLoaded } = useRepos();
  const [stored, setStored] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      setStored(localStorage.getItem("dd-repo"));
    } catch {
      /* ignore */
    }
  }, []);

  const setRepoId = React.useCallback((id: string) => {
    setStored(id);
    try {
      localStorage.setItem("dd-repo", id);
    } catch {
      /* ignore */
    }
  }, []);

  const list = repos ?? [];
  const fromPath = repoIdFromPath(pathname);
  const repoId = fromPath ?? stored ?? list[0]?.id ?? null;
  const activeRepo = list.find((r) => r.id === repoId) ?? null;

  return (
    <RepoCtx.Provider value={{ repoId, setRepoId, repos: list, activeRepo, reposLoaded }}>
      {children}
    </RepoCtx.Provider>
  );
}

export function useActiveRepo() {
  return React.useContext(RepoCtx);
}

/**
 * True once the repos list has loaded and the given :repoId matches none of
 * them — i.e. a stale/invalid repo in the URL ("no repo selected"). Repo-scoped
 * pages use this to show a friendly empty state instead of a "Repo not found"
 * error. Returns false while repos are still loading (avoids a flash) and on a
 * repos fetch failure (let the page surface its real error in that case).
 */
export function useRepoNotFound(repoId: string | null | undefined): boolean {
  const { repos, reposLoaded } = useActiveRepo();
  return reposLoaded && repoId != null && !repos.some((r) => r.id === repoId);
}
