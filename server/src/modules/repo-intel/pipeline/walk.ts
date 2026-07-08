/**
 * repo-intel pipeline — walk + filter (step 1+2).
 *
 * Walks a clone directory and returns the set of files the parse phase should
 * process, applying:
 *   - EXCLUDED_DIRS  (node_modules, dist, build, coverage, .next, out, vendor, .git)
 *   - .gitignore     — a root-level `.gitignore` (if present) is loaded via the
 *                    `ignore` npm package and every candidate path (dir or file)
 *                    is tested against it before being walked/accepted. Dropped
 *                    candidates are counted in `stats.gitignoredCount`. A missing
 *                    `.gitignore` is NOT an error — it just means no extra rules.
 *   - nested repos   — any subdirectory (other than `root` itself) that contains
 *                    its own `.git` entry (directory OR file — submodules use a
 *                    `.git` FILE) is treated as a nested repository working tree
 *                    and its entire subtree is skipped, counted once per skipped
 *                    subtree root in `stats.skippedNestedRepo`.
 *   - SUPPORTED_EXT  (.ts, .tsx, .js, .jsx, .mjs, .cjs)
 *   - MAX_FILE_SIZE  (400 KB) — files larger than this are counted in
 *                    `stats.skippedTooLarge` and left out of the result.
 *   - MAX_INDEXED_FILES (5000) — if exceeded, take the FIRST N (by walk order)
 *                    and record `stats.bounded = total - N`. T3 will replace
 *                    "first N" with "top N by hotness" once `file_rank` lands.
 *
 * SCOPE NOTE: this hardening (gitignore + nested-repo skipping) applies only to
 * files walked from this point forward. A repository indexed before this shipped
 * retains its previously-walked (unfiltered) fact set until a resync is triggered
 * (`POST /repos/:id/resync`) or a fresh clone happens.
 *
 * Pure-ish: takes a root path + does fs ops; returns plain data so the caller
 * (full.ts / incremental.ts) can decide what to do with it.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import {
  EXCLUDED_DIRS,
  MAX_FILE_SIZE,
  MAX_INDEXED_FILES,
  SUPPORTED_EXT,
} from '../constants.js';

const EXCLUDED_SET: ReadonlySet<string> = new Set(EXCLUDED_DIRS);
const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_EXT);

export interface WalkStats {
  /** Files seen on disk with a SUPPORTED_EXT extension (before size + bound filters). */
  totalCandidates: number;
  /** Candidates dropped because stat().size > MAX_FILE_SIZE. */
  skippedTooLarge: number;
  /** Candidates dropped because the file list exceeded MAX_INDEXED_FILES. */
  bounded: number;
  /** Subtree roots skipped because they contained a nested `.git` entry. */
  skippedNestedRepo: number;
  /** Candidates (dirs + files) dropped because they matched root `.gitignore` rules. */
  gitignoredCount: number;
}

export interface WalkResult {
  /** Paths relative to `root`, separator-normalized to forward slashes. */
  files: string[];
  stats: WalkStats;
}

/**
 * Best-effort load of a root-level `.gitignore` into an `ignore()` instance.
 * A missing file is not an error — it just means no extra rules beyond
 * EXCLUDED_DIRS. Any other read error is treated the same way (fail open —
 * the walk should never abort because `.gitignore` couldn't be read).
 */
async function loadRootIgnore(root: string): Promise<Ignore> {
  const ig = ignore();
  try {
    const contents = await readFile(join(root, '.gitignore'), 'utf8');
    ig.add(contents);
  } catch {
    // No .gitignore (or unreadable) — walk proceeds with EXCLUDED_DIRS only.
  }
  return ig;
}

/**
 * Recursively walk `root`, returning the file set to parse + a small stats
 * object the pipeline persists into `repo_index_state.stats`.
 */
export async function walkClone(root: string): Promise<WalkResult> {
  const out: string[] = [];
  const stats: WalkStats = {
    totalCandidates: 0,
    skippedTooLarge: 0,
    bounded: 0,
    skippedNestedRepo: 0,
    gitignoredCount: 0,
  };

  const ig = await loadRootIgnore(root);

  await walkDir(root, root, out, stats, ig);

  // Stable order: alphabetical relpath. Keeps "first N when bounded" reproducible
  // across runs (until T3 replaces it with rank-driven selection).
  out.sort();

  if (out.length > MAX_INDEXED_FILES) {
    stats.bounded = out.length - MAX_INDEXED_FILES;
    out.length = MAX_INDEXED_FILES;
  }

  return { files: out, stats };
}

/**
 * True if `dir` contains a `.git` entry (directory or file — submodules use a
 * `.git` FILE pointing at the parent's gitdir). Used to detect nested
 * repository working trees so their entire subtree can be skipped.
 */
async function hasNestedGit(dir: string): Promise<boolean> {
  try {
    const entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
    return entries.some((e) => e.name === '.git' && (e.isDirectory() || e.isFile()));
  } catch {
    return false;
  }
}

async function walkDir(
  root: string,
  dir: string,
  out: string[],
  stats: WalkStats,
  ig: Ignore,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory (permissions, dangling symlink) — skip cleanly so
    // the indexer keeps making progress on the parts of the clone it CAN read.
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks (loops, perf)
    const name = entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_SET.has(name)) continue;

      const subDir = join(dir, name);
      const relDir = relative(root, subDir).split(sep).join('/');
      if (ig.ignores(relDir)) {
        stats.gitignoredCount += 1;
        continue;
      }

      // Nested repository detection: a `.git` entry inside a subdirectory
      // (other than root itself) means this subtree is a separate repo's
      // working tree (or a submodule) — skip it entirely.
      if (await hasNestedGit(subDir)) {
        stats.skippedNestedRepo += 1;
        continue;
      }

      await walkDir(root, subDir, out, stats, ig);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = extname(name).toLowerCase();
    if (!SUPPORTED_SET.has(ext)) continue;

    const full = join(dir, name);
    const rel = relative(root, full).split(sep).join('/');
    if (ig.ignores(rel)) {
      stats.gitignoredCount += 1;
      continue;
    }

    stats.totalCandidates += 1;

    let size: number;
    try {
      size = (await stat(full)).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_SIZE) {
      stats.skippedTooLarge += 1;
      continue;
    }

    // Posix-style relative path so DB rows are platform-agnostic (matches the
    // `pr_files.path` convention).
    out.push(rel);
  }
}
