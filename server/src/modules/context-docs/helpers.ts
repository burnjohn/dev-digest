import path from 'node:path';
import type { ContextDocument } from '@devdigest/shared';

/**
 * Pure, I/O-free path-confinement gate (AC-13). MUST be called before any
 * filesystem read of a stored/user-supplied document path — both at discovery
 * time (paths come from our own `readdir` walk, already confined by
 * construction) and, more importantly, at ATTACH-TIME VALIDATION and RUN-TIME
 * RE-VALIDATION (Step 5 / Step 6), where the path was persisted earlier and
 * could now point outside the clone (stale attachment, crafted path, or a
 * relocated repo).
 *
 * Rejects (returns `null`) unless BOTH:
 *   (a) the resolved absolute path is `cloneRoot` itself or nested under it
 *       (`cloneRoot + path.sep` prefix check on the RESOLVED path — never
 *       `path.join` alone, which does not normalize `..` traversal the same
 *       way when the input already contains resolved-looking segments); and
 *   (b) the first path segment (relative to `cloneRoot`) is one of the
 *       configured `folders` — an unconfigured folder (e.g. `node_modules`,
 *       `.git`) is rejected even if it technically resolves inside the clone.
 *
 * Returns the confined absolute path on success.
 */
export function resolveConfinedPath(
  cloneRoot: string,
  folders: string[],
  storedPath: string,
): string | null {
  if (folders.length === 0) return null;

  const resolvedRoot = path.resolve(cloneRoot);
  const resolved = path.resolve(resolvedRoot, storedPath);

  // (a) must be the root itself or nested under it — prefix check on the
  // RESOLVED path, not a naive string check on the raw input.
  const isRoot = resolved === resolvedRoot;
  const isNested = resolved.startsWith(resolvedRoot + path.sep);
  if (!isRoot && !isNested) return null;
  // The root itself is never a valid document location — a document must
  // live under one of the configured folders, not sit at the clone root.
  if (isRoot) return null;

  // (b) first segment of the path relative to the clone root must be a
  // configured folder.
  const relative = path.relative(resolvedRoot, resolved);
  const firstSegment = relative.split(path.sep)[0];
  if (!firstSegment || !folders.includes(firstSegment)) return null;

  return resolved;
}

/**
 * Overlay-vs-clone precedence gate (AC-25) — the ONE place the "prefer overlay"
 * decision lives. `service.ts` (`listDocuments`/`getDocumentContent`) and
 * `run-executor.ts` (`buildContextDocs`) both call this; none reimplement the
 * if/else, so overlay precedence can never drift between the read surfaces.
 *
 * Pure, I/O-free. Returns:
 *   - `undefined` when neither side has the document (AC-31 "nothing to inject")
 *   - `{ overlayBody, 'overlay' }`      when both an overlay and a clone file exist
 *   - `{ overlayBody, 'overlay-only' }` when only an overlay exists (uploaded doc)
 *   - `{ cloneContent, 'clone' }`       when only a clone file exists
 */
export function resolveEffectiveContent(
  cloneContent: string | undefined,
  overlayBody: string | undefined,
): { content: string; source: ContextDocument['source'] } | undefined {
  if (overlayBody !== undefined) {
    return { content: overlayBody, source: cloneContent !== undefined ? 'overlay' : 'overlay-only' };
  }
  if (cloneContent !== undefined) {
    return { content: cloneContent, source: 'clone' };
  }
  return undefined;
}

/**
 * Clone-root-FREE path-shape validation for overlay saves/uploads (AC-13
 * restated for overlays). Unlike `resolveConfinedPath`, this does NOT call
 * `path.resolve` against a real clone directory — an overlay-only document may
 * target a path with no corresponding clone directory (a repo with no clone at
 * all, per AC-36). It validates only the SHAPE of the path:
 *   - not absolute
 *   - contains no `..` segment anywhere (no traversal)
 *   - its first segment is one of the configured `folders`
 *
 * These rules are a strict subset of what `resolveConfinedPath` accepts for any
 * path that WOULD resolve inside a real clone root, so a path accepted here is
 * always also confinement-safe once a clone exists. Used for ALL overlay path
 * validation (clone-backed or overlay-only) going forward.
 */
export function isPathShapeValid(folders: string[], candidatePath: string): boolean {
  if (folders.length === 0) return false;
  const normalized = candidatePath.replace(/\\/g, '/');
  if (path.isAbsolute(candidatePath) || normalized.startsWith('/')) return false;
  const segments = normalized.split('/').filter((s) => s.length > 0);
  if (segments.length < 2) return false; // must be under a folder, not the root
  if (segments.some((s) => s === '..' || s === '.')) return false;
  const first = segments[0];
  return first !== undefined && folders.includes(first);
}

/**
 * Category badge value for a document — the first path segment (root folder
 * name), matching `resolveConfinedPath`'s notion of "configured folder".
 * `relativePath` is expected to already use POSIX-style forward slashes (as
 * produced by the discovery walk / stored attachment paths).
 */
export function categoryFor(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const [first] = normalized.split('/');
  return first ?? normalized;
}

/** Maps discovered/attached document data to the response DTO. */
export function toContextDocumentDto(
  docPath: string,
  tokenCount: number,
  usedBy: number,
  coverage: number,
  source: ContextDocument['source'],
): ContextDocument {
  return {
    path: docPath,
    category: categoryFor(docPath),
    token_count: tokenCount,
    used_by_agents: usedBy,
    coverage,
    source,
  };
}
