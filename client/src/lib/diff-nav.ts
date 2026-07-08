"use client";

import { useRouter, useSearchParams } from "next/navigation";

/** Navigate a path:line reference: internal Files-changed scroll when the file is
 *  part of this PR's diff, else fall back to the external GitHub blob link. */
export function useDiffNavigate() {
  const router = useRouter();
  const search = useSearchParams();
  return (path: string, line: number | null | undefined, githubLink: string | null | undefined, isChanged: boolean) => {
    if (isChanged) {
      const sp = new URLSearchParams(search?.toString());
      sp.set("tab", "diff");
      sp.set("file", path);
      if (line != null) sp.set("line", String(line)); else sp.delete("line");
      router.replace(`?${sp.toString()}`);
    } else if (githubLink) {
      window.open(githubLink, "_blank", "noopener,noreferrer");
    }
    // else: neither in-diff nor a github link — no-op (validated refs always have one)
  };
}
