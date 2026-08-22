/**
 * references.ts — Parse and resolve references from a PR body.
 *
 * Pure parsing: `parseReferences` extracts repo-file, github, and url refs.
 * Async resolving: `resolveReferences` fetches each best-effort via injected ports.
 *
 * Onion layer: application helper (no SQL, no HTTP clients — ports injected).
 * Security: path-traversal guard on repo-file refs; SSRF guard delegated to WebFetchClient.
 */
import type { GitClient, GitHubClient, WebFetchClient, RepoRef } from '@devdigest/shared';
import type { Logger } from '../reviews/run-executor.js';

// ---- Types ---------------------------------------------------------------

export type ParsedRefKind = 'repo-file' | 'github' | 'url';

export interface ParsedRef {
  kind: ParsedRefKind;
  /** Raw text that produced this ref (for de-dup). */
  raw: string;
  /** For repo-file refs: the normalised relative path (no leading slash, no ..). */
  path?: string;
  /** For github refs: parsed issue/PR number. */
  issueNumber?: number;
  /**
   * For github refs that came from a full URL: the target owner/repo when it
   * differs from the current repo (used to build a cross-repo RepoRef).
   */
  targetOwner?: string;
  targetRepo?: string;
  /** For url refs: the href. */
  url?: string;
}

export interface ResolvedReference {
  kind: ParsedRefKind;
  /** Human-readable source label (path, issue URL, or URL). */
  source: string;
  content: string;
}

// ---- Constants ------------------------------------------------------------

/** Known doc-root directories that may contain repo-relative doc paths. */
const DOC_ROOTS = ['docs/', 'specs/', 'plans/'];

/** Maximum counts per kind. */
const MAX_REPO_FILES = 5;
const MAX_GITHUB_REFS = 5;
const MAX_URL_REFS = 3;

/** Default total budget in bytes across all resolved references. */
const DEFAULT_BUDGET_BYTES = 12_000;

// ---- Helpers --------------------------------------------------------------

/**
 * Returns true if `path` is a safe repo-relative doc path:
 * - No `..` segments
 * - Does not start with `/`
 * - Ends in .md, .mdx, or .txt
 * - Falls under one of the known doc roots
 */
function isSafeDocPath(path: string): boolean {
  if (!path || path.startsWith('/')) return false;
  const segments = path.split('/');
  if (segments.some((s) => s === '..' || s === '.')) return false;
  const lower = path.toLowerCase();
  const hasDocExt = lower.endsWith('.md') || lower.endsWith('.mdx') || lower.endsWith('.txt');
  if (!hasDocExt) return false;
  const underDocRoot = DOC_ROOTS.some((root) => lower.startsWith(root));
  return underDocRoot;
}

/**
 * Re-validate a path immediately before reading (second gate after parse).
 * Identical criteria to `isSafeDocPath` — keeps them in sync.
 */
function reValidateDocPath(path: string): boolean {
  return isSafeDocPath(path);
}

// ---- Parser ---------------------------------------------------------------

/**
 * Extract all reference kinds from a PR body string.
 *
 * Order of extraction:
 *  1. Markdown links `[text](url_or_path)`
 *  2. GitHub closing keywords  closes/fixes/resolves #N
 *  3. Bare `#N` references
 *  4. Full GitHub issue/PR URLs https://github.com/<owner>/<repo>/(issues|pull)/<N>
 *  5. Any remaining https?:// links
 *
 * De-duplicates within each kind; caps counts.
 */
export function parseReferences(
  body: string | null,
  repo: { owner: string; name: string },
): ParsedRef[] {
  if (!body) return [];

  const repoFiles: ParsedRef[] = [];
  const githubRefs: ParsedRef[] = [];
  const urlRefs: ParsedRef[] = [];

  // Track de-dup keys per kind.
  const seenPaths = new Set<string>();
  const seenIssues = new Set<string>();
  const seenUrls = new Set<string>();

  function addRepoFile(raw: string, path: string): void {
    if (repoFiles.length >= MAX_REPO_FILES) return;
    const norm = path.toLowerCase();
    if (seenPaths.has(norm)) return;
    if (!isSafeDocPath(path)) return;
    seenPaths.add(norm);
    repoFiles.push({ kind: 'repo-file', raw, path });
  }

  function addGitHub(raw: string, n: number, owner?: string, name?: string): void {
    if (githubRefs.length >= MAX_GITHUB_REFS) return;
    // Normalise cross-repo key: "owner/repo#N" or "#N" for current repo.
    const key =
      owner && name && (owner !== repo.owner || name !== repo.name)
        ? `${owner}/${name}#${n}`
        : `#${n}`;
    if (seenIssues.has(key)) return;
    seenIssues.add(key);
    const ref: ParsedRef = { kind: 'github', raw, issueNumber: n };
    if (owner && name && (owner !== repo.owner || name !== repo.name)) {
      ref.targetOwner = owner;
      ref.targetRepo = name;
    }
    githubRefs.push(ref);
  }

  function addUrl(raw: string, url: string): void {
    if (urlRefs.length >= MAX_URL_REFS) return;
    if (seenUrls.has(url)) return;
    seenUrls.add(url);
    urlRefs.push({ kind: 'url', raw, url });
  }

  // 1. Markdown links: [text](target)
  const mdLinkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  for (const match of body.matchAll(mdLinkRe)) {
    const rawLink = match[0];
    const target = match[2]?.trim();
    if (!target) continue;

    // Check if it looks like a repo-relative doc path.
    if (isSafeDocPath(target)) {
      addRepoFile(rawLink, target);
      continue;
    }

    // Full GitHub issue/PR URL inside a markdown link.
    const ghUrlMatch = target.match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/i,
    );
    if (ghUrlMatch) {
      const owner = ghUrlMatch[1] ?? '';
      const name = ghUrlMatch[2] ?? '';
      const numStr = ghUrlMatch[4] ?? '0';
      addGitHub(rawLink, parseInt(numStr, 10), owner, name);
      continue;
    }

    // Any other https?:// link.
    if (/^https?:\/\//i.test(target)) {
      // Skip GitHub repo-level or PR-diff URLs that are not issue/PR refs.
      addUrl(rawLink, target);
    }
  }

  // 2. Closing keywords: closes/fixes/resolves #N (case-insensitive)
  const closesRe = /\b(?:closes|fixes|resolves)\s+#(\d+)\b/gi;
  for (const match of body.matchAll(closesRe)) {
    const numStr = match[1] ?? '0';
    addGitHub(match[0], parseInt(numStr, 10));
  }

  // 3. Full GitHub issue/PR URLs (bare, not inside markdown links already processed).
  const ghUrlRe = /https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pull)\/(\d+)/gi;
  for (const match of body.matchAll(ghUrlRe)) {
    const rawUrl = match[0];
    const owner = match[1] ?? '';
    const name = match[2] ?? '';
    const numStr = match[4] ?? '0';
    addGitHub(rawUrl, parseInt(numStr, 10), owner, name);
  }

  // 4. Bare #N references (not already in a closing keyword match above,
  //    not following alphanumeric — avoids CSS colour codes etc.)
  const bareHashRe = /(?<![/\w])#(\d+)\b/g;
  for (const match of body.matchAll(bareHashRe)) {
    const numStr = match[1] ?? '0';
    addGitHub(match[0], parseInt(numStr, 10));
  }

  // 5. Remaining bare https?:// links (outside markdown links).
  //    We strip markdown link targets we already processed via negative lookbehind.
  //    Simple heuristic: find https?:// followed by non-whitespace characters that
  //    aren't already captured as github issue/PR URLs.
  const urlRe = /https?:\/\/[^\s)>"]+/gi;
  for (const match of body.matchAll(urlRe)) {
    const url = match[0].replace(/[.,;:!?]+$/, ''); // strip trailing punctuation
    // Skip GitHub issue/PR URLs (handled above).
    if (/github\.com\/[^/\s]+\/[^/\s]+\/(issues|pull)\/\d+/i.test(url)) continue;
    if (!seenUrls.has(url)) {
      addUrl(url, url);
    }
  }

  return [...repoFiles, ...githubRefs, ...urlRefs];
}

// ---- Resolver -------------------------------------------------------------

export interface ResolveRefsDeps {
  repoRef: RepoRef;
  git: GitClient;
  github: GitHubClient | null;
  webFetch: WebFetchClient | null;
  logger?: Logger;
  /** Total byte budget across all resolved reference content. Default ~12KB. */
  budgetBytes?: number;
}

/**
 * Resolve parsed references to their content, best-effort.
 *
 * - Each fetch is wrapped in try/catch → errors skip that ref silently.
 * - Content accumulates up to `budgetBytes`; the item that exceeds it is truncated
 *   with `\n…[truncated]` and logged; further refs are skipped.
 * - Never throws out of this function.
 */
export async function resolveReferences(
  refs: ParsedRef[],
  deps: ResolveRefsDeps,
): Promise<ResolvedReference[]> {
  const { repoRef, git, github, webFetch, logger, budgetBytes = DEFAULT_BUDGET_BYTES } = deps;

  const resolved: ResolvedReference[] = [];
  let accumulatedBytes = 0;
  let budgetExceeded = false;

  for (const ref of refs) {
    if (budgetExceeded) break;

    try {
      let content: string | null = null;
      let source: string = ref.raw;

      if (ref.kind === 'repo-file') {
        const path = ref.path!;
        // Re-validate path before reading — second security gate.
        if (!reValidateDocPath(path)) continue;
        content = await git.readFile(repoRef, path);
        source = path;
      } else if (ref.kind === 'github') {
        if (!github) continue;
        const n = ref.issueNumber!;
        const targetRef: RepoRef =
          ref.targetOwner && ref.targetRepo
            ? { owner: ref.targetOwner, name: ref.targetRepo }
            : repoRef;
        const issueUrl =
          ref.targetOwner && ref.targetRepo
            ? `https://github.com/${ref.targetOwner}/${ref.targetRepo}/issues/${n}`
            : `https://github.com/${repoRef.owner}/${repoRef.name}/issues/${n}`;
        source = issueUrl;
        let issue: { title: string; body?: string | null } | null = null;
        try {
          issue = await github.getIssue(targetRef, n);
        } catch {
          // Fall back to PR if issue fetch fails.
          try {
            const pr = await github.getPullRequest(targetRef, n);
            issue = { title: pr.title, body: pr.body };
          } catch {
            continue;
          }
        }
        content = `${issue.title}\n\n${issue.body ?? ''}`.trim();
      } else if (ref.kind === 'url') {
        if (!webFetch) continue;
        const url = ref.url!;
        source = url;
        content = await webFetch.fetch(url);
      }

      if (content === null || content === undefined) continue;

      const contentBytes = Buffer.byteLength(content, 'utf8');

      if (accumulatedBytes + contentBytes > budgetBytes) {
        // Truncate to fit remaining budget.
        const remainingBytes = budgetBytes - accumulatedBytes;
        if (remainingBytes <= 0) {
          budgetExceeded = true;
          break;
        }
        const truncated = content.slice(0, remainingBytes) + '\n…[truncated]';
        logger?.info(
          {
            source,
            originalBytes: contentBytes,
            truncatedTo: remainingBytes,
          },
          `intent:references: content truncated to fit budget`,
        );
        resolved.push({ kind: ref.kind, source, content: truncated });
        accumulatedBytes = budgetBytes; // mark budget as consumed
        budgetExceeded = true;
        break;
      }

      logger?.info(
        { kind: ref.kind, source, bytes: contentBytes },
        `intent:references resolved ${ref.kind}: ${source}`,
      );
      accumulatedBytes += contentBytes;
      resolved.push({ kind: ref.kind, source, content });
    } catch {
      // Best-effort: skip this ref silently on any error.
    }
  }

  return resolved;
}
