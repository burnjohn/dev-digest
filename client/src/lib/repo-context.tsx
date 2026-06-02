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
}>({ repoId: null, setRepoId: () => {}, repos: [], activeRepo: null });

function repoIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/repos\/([^/]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function RepoProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: repos } = useRepos();
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
    <RepoCtx.Provider value={{ repoId, setRepoId, repos: list, activeRepo }}>{children}</RepoCtx.Provider>
  );
}

export function useActiveRepo() {
  return React.useContext(RepoCtx);
}
