/**
 * context module constants — SPEC-01 (Project Context).
 *
 * VALUES only are mirrored from `repo-intel/constants.ts` (`MAX_FILE_SIZE`,
 * `MAX_INDEXED_FILES`, `EXCLUDED_DIRS`) — never imported from there. A driven
 * adapter/module must stay feature-agnostic and `modules/**` may not import
 * another module (onion §2 rule 2), so this file copies the walk's *shape*,
 * not the module.
 */

/** The one extension this walk lists (AC-1). */
export const CONTEXT_DOC_EXT = '.md';

/**
 * The ancestor-directory restriction (AC-1, NFR-1). Hard-coded — never
 * derived from `AppConfig.contextSearchRoots` — so a misconfigured search
 * root can only move *where* the walk starts, never widen *what kind* of
 * file gets listed.
 */
export const CONTEXT_ANCESTOR_DIRS = ['specs', 'docs', 'insights'] as const;

/** Directories never walked. Mirrors `repo-intel/constants.ts::EXCLUDED_DIRS`. */
export const EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
] as const;

/**
 * NFR-4 — fixed, not configurable, and adds no config key. Matches
 * `repo-intel/constants.ts::MAX_FILE_SIZE`. A file over this bound is
 * LISTED and flagged oversized (AC-8) — never dropped, which is where this
 * walk differs from repo-intel's own (which skips oversized files).
 */
export const MAX_FILE_SIZE = 400 * 1024;

/**
 * NFR-4 / AC-9 — fixed, not configurable. Matches
 * `repo-intel/constants.ts::MAX_INDEXED_FILES`. The walk takes the first N
 * (by the stable alphabetical sort) once total candidates exceed this.
 */
export const MAX_INDEXED_FILES = 5000;
