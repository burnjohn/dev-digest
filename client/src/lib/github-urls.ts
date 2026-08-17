/* github-urls.ts — build github.com deep-links from data we already hold.
   PR detail has repo full_name (owner/repo), PR number, head sha, and finding
   file/line — enough to open the PR or a file blob at a line range in a new tab. */

const HOST = "https://github.com";

/* Encode a repo-relative path for a URL while keeping "/" separators.

   Percent-encoding IS the right form for the `[repoId]` / `[number]` segments this
   repo's App Router paths are full of: github.com's own file-tree anchors link to
   `…/repos/%5BrepoId%5D/pulls/%5Bnumber%5D`, which is exactly what
   `encodeURIComponent` emits. (The `html_url` from the contents API reports bare
   brackets instead — the two disagree, and the UI's form is the one to match.) */
function encPath(file: string): string {
  return file
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

/** https://github.com/{owner}/{repo}/pull/{number} */
export function githubPrUrl(repoFullName: string, number: number): string {
  return `${HOST}/${repoFullName}/pull/${number}`;
}

/**
 * https://github.com/{owner}/{repo}/blob/{sha}/{file}#L{start}[-L{end}]
 * `sha` pins the link to the PR's head so line numbers stay accurate.
 */
export function githubBlobUrl(
  repoFullName: string,
  sha: string,
  file: string,
  startLine?: number,
  endLine?: number,
): string {
  let url = `${HOST}/${repoFullName}/blob/${sha}/${encPath(file)}`;
  if (startLine != null) {
    url += `#L${startLine}`;
    if (endLine != null && endLine !== startLine) url += `-L${endLine}`;
  }
  return url;
}
