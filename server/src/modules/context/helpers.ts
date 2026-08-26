/**
 * context module — pure transforms. No I/O other than the two `node:fs`
 * reads a containment check needs (`realpath`, `stat`) to resolve a symlink
 * and confirm a directory exists; no database, no `Container`, no Fastify.
 *
 * SPEC-01 (Project Context): NFR-1, NFR-2, NFR-4, `## Untrusted inputs` §5.
 */
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { approxTokensForLength } from '../../adapters/tokenizer/index.js';
import { CONTEXT_ANCESTOR_DIRS } from './constants.js';
import type { ContextDocType } from '../../vendor/shared/contracts/context-api.js';
import type { SkippedRootReason } from './types.js';

// ---------------------------------------------------------------------------
// Type badge (AC-1)
// ---------------------------------------------------------------------------

const ANCESTOR_SET: ReadonlySet<string> = new Set(CONTEXT_ANCESTOR_DIRS);

/**
 * The nearest `specs`/`docs`/`insights` ancestor directory on `relPath`'s
 * path from the repository root — i.e. the ancestor closest to the file,
 * not the first one from the root. `relPath` is forward-slash and relative
 * to the repository root (`cloneDir`). Returns `null` when no such ancestor
 * exists, which means the walk must not list the file (AC-1).
 */
export function nearestAncestorType(relPath: string): ContextDocType | null {
  const segments = relPath.split('/');
  segments.pop(); // drop the filename itself
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (segment !== undefined && ANCESTOR_SET.has(segment)) {
      return segment as ContextDocType;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Token estimate (AC-2, NFR-2)
// ---------------------------------------------------------------------------

interface TokenCacheEntry {
  size: number;
  mtimeMs: number;
  tokens: number;
}

/** Module-local cache, keyed on `path` and guarded by `(size, mtimeMs)`. */
const tokenCache = new Map<string, TokenCacheEntry>();

/**
 * `ceil(chars / 4)` via the existing `approxTokensForLength` heuristic
 * (NFR-2), cached per `(path, size, mtimeMs)` — a call with an unchanged
 * triple returns the cached value without recomputing; a changed `size` or
 * `mtimeMs` recomputes and replaces the entry. No tokenizer library is
 * loaded on this path (Non-goal 5) — `approxTokensForLength` is the same
 * heuristic `repo-map` falls back to, never `js-tiktoken` itself.
 */
export function estimateTokens(path: string, size: number, mtimeMs: number, chars: number): number {
  const cached = tokenCache.get(path);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
    return cached.tokens;
  }
  const tokens = approxTokensForLength(chars);
  tokenCache.set(path, { size, mtimeMs, tokens });
  return tokens;
}

// ---------------------------------------------------------------------------
// Per-document block string (AC-21, REQ-21)
// ---------------------------------------------------------------------------

/**
 * `### <repository-relative path>` as the first line, then `body` verbatim
 * — CRLF preserved, never re-split (`server/INSIGHTS.md`, 2026-08-17: `.`
 * does not match `\r`, so a naive `split('\n')` silently breaks every CRLF
 * file — this function never splits the body at all).
 */
export function formatDocBlock(path: string, body: string): string {
  return `### ${path}\n${body}`;
}

// ---------------------------------------------------------------------------
// Resolved-path containment (REQ-30, `## Untrusted inputs` §5)
// ---------------------------------------------------------------------------

function isWithin(baseDir: string, target: string): boolean {
  const rel = relative(baseDir, target);
  // '' → target IS baseDir (contained, trivially). A leading '..' or an
  // absolute `rel` (e.g. a different Windows drive) means it escaped.
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * The ONE containment check every read against a stored or user-submitted
 * path goes through (REQ-30). Resolves `candidatePath` against `baseDir`
 * first — which alone rejects `..` segments and absolute paths, since
 * `path.resolve` normalises the former and lets the latter override
 * `baseDir` entirely, and the containment comparison below then catches
 * that override — then, if something exists at the resolved location,
 * follows any symlink via `fs.realpath` before comparing prefixes again, so
 * an escaping symlink is caught by the same comparison rather than by
 * string-matching the stored value. Returns the contained, symlink-resolved
 * absolute path, or `null` if containment fails.
 */
export async function resolveWithinRoot(
  baseDir: string,
  candidatePath: string,
): Promise<string | null> {
  const base = resolve(baseDir);
  const resolved = resolve(base, candidatePath);
  if (!isWithin(base, resolved)) return null;

  let real: string;
  try {
    real = await realpath(resolved);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Nothing on disk yet (e.g. an upload target about to be written) —
      // there is no symlink to follow for a path with nothing at the end of
      // it, so the already-contained resolved path is the containment fact.
      return resolved;
    }
    return null;
  }
  const realBase = await realpath(base).catch(() => base);
  return isWithin(realBase, real) ? real : null;
}

// ---------------------------------------------------------------------------
// Search-root resolution (REQ-37, NFR-1)
// ---------------------------------------------------------------------------

export type SearchRootResolution =
  | { ok: true; absolutePath: string }
  | { ok: false; reason: SkippedRootReason };

/**
 * Resolves one configured search root against `cloneDir` (REQ-37): a root
 * resolving outside `cloneDir` is refused (`escaped`); a root that resolves
 * inside but does not exist as a directory on disk is skipped (`missing`).
 * Neither case throws — the caller surfaces it, the listing proceeds
 * without that root (Edge cases: "neither fails the request").
 */
export async function resolveSearchRoot(
  cloneDir: string,
  root: string,
): Promise<SearchRootResolution> {
  const contained = await resolveWithinRoot(cloneDir, root);
  if (contained === null) return { ok: false, reason: 'escaped' };

  try {
    const st = await stat(contained);
    if (!st.isDirectory()) return { ok: false, reason: 'missing' };
  } catch {
    return { ok: false, reason: 'missing' };
  }
  return { ok: true, absolutePath: contained };
}
