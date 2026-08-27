/**
 * context module — the bounded document walk (step 1 of discovery).
 *
 * Reuses the SHAPE of `repo-intel/pipeline/walk.ts` (recursive `readdir`
 * with `withFileTypes`, excluded dirs skipped, symlinks never followed,
 * unreadable directories skipped cleanly, forward-slash-normalised relative
 * paths, a stable alphabetical sort, a hard candidate-count bound) rather
 * than importing it — different extension set, different filter (the
 * `specs`/`docs`/`insights` ancestor test, AC-1), and a driven module must
 * stay feature-agnostic (onion §2 rule 2: `modules/**` may not import
 * another module).
 *
 * Differs from repo-intel's walk in one deliberate way: a file over
 * `MAX_FILE_SIZE` is LISTED and flagged `oversized` (AC-8), never dropped —
 * that is REQ-8's whole point, and repo-intel's own "skip it" rule does not
 * carry over here.
 */
import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { CONTEXT_DOC_EXT, EXCLUDED_DIRS, MAX_FILE_SIZE, MAX_INDEXED_FILES } from '../constants.js';
import { nearestAncestorType, resolveSearchRoot } from '../helpers.js';
import type { DocFile, SkippedRoot, WalkDocsResult, WalkDocsStats } from '../types.js';

const EXCLUDED_SET: ReadonlySet<string> = new Set(EXCLUDED_DIRS);

/**
 * Walk every configured search root under `cloneDir`, returning every
 * `.md` file that has a `specs`/`docs`/`insights` ancestor on its path from
 * the repository root — de-duplicated across overlapping roots, bounded at
 * `MAX_INDEXED_FILES` (AC-9), and sorted alphabetically for a reproducible
 * result across runs.
 */
export async function walkContextDocs(
  cloneDir: string,
  searchRoots: string[],
): Promise<WalkDocsResult> {
  const cloneDirAbs = resolve(cloneDir);
  const stats: WalkDocsStats = {
    totalCandidates: 0,
    bounded: false,
    bound: MAX_INDEXED_FILES,
    skippedRoots: [],
  };
  const seen = new Set<string>();
  const collected: DocFile[] = [];

  for (const root of searchRoots) {
    const resolution = await resolveSearchRoot(cloneDirAbs, root);
    if (!resolution.ok) {
      const skipped: SkippedRoot = { root, reason: resolution.reason };
      stats.skippedRoots.push(skipped);
      continue;
    }
    await walkDir(cloneDirAbs, resolution.absolutePath, seen, collected, stats);
  }

  collected.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  if (collected.length > MAX_INDEXED_FILES) {
    stats.bounded = true;
    collected.length = MAX_INDEXED_FILES;
  }

  return { files: collected, stats };
}

async function walkDir(
  cloneDirAbs: string,
  dir: string,
  seen: Set<string>,
  out: DocFile[],
  stats: WalkDocsStats,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory (permissions, dangling symlink) — skip cleanly so
    // the walk keeps making progress on the parts of the clone it CAN read.
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks (loops, escape)
    const name = entry.name;
    const full = join(dir, name);

    if (entry.isDirectory()) {
      if (EXCLUDED_SET.has(name)) continue;
      await walkDir(cloneDirAbs, full, seen, out, stats);
      continue;
    }

    if (!entry.isFile()) continue;
    if (extname(name).toLowerCase() !== CONTEXT_DOC_EXT) continue;

    const rel = relative(cloneDirAbs, full).split(sep).join('/');

    const type = nearestAncestorType(rel);
    if (type === null) continue; // no specs/docs/insights ancestor — not listed (AC-1)

    if (seen.has(rel)) continue; // de-dup across overlapping search roots
    seen.add(rel);

    let size: number;
    let mtimeMs: number;
    try {
      const st = await stat(full);
      size = st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      continue;
    }

    stats.totalCandidates += 1;
    out.push({
      path: rel,
      type,
      size,
      mtimeMs,
      oversized: size > MAX_FILE_SIZE,
    });
  }
}
