/**
 * Smart Diff — pure classifier. No DB / fs / LLM: everything here is a
 * function of its arguments, so it's covered by hermetic unit tests only
 * (`classifier.test.ts`). The DB-backed aggregation (latest review, PR files)
 * lives in `../service.ts#smartDiffForPull`.
 */
import type { SmartDiff, SmartDiffFile, SmartDiffFinding, SmartDiffRole } from '@devdigest/shared';
import {
  BOILERPLATE_PATTERNS,
  TOO_BIG_CORE_FILES,
  TOO_BIG_TOTAL_LINES,
  WIRING_PATTERNS,
} from './constants.js';

/** One `pr_files` row's worth of input (path/additions/deletions/patch — patch
 *  itself isn't used by the classifier, but callers have it to hand). */
export interface SmartDiffInputFile {
  path: string;
  additions: number;
  deletions: number;
}

// ---- glob matching ----------------------------------------------------------

/** Translate one glob pattern into a RegExp body (no anchors yet). `**`
 *  followed by `/` becomes "zero or more path segments"; a bare `**`
 *  (typically at the end, e.g. `dist/**`) becomes "anything". A lone `*`
 *  never crosses a `/`. */
function globBodyToRegExpSource(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++; // consume the second '*'
      if (glob[i + 1] === '/') {
        out += '(?:.*/)?';
        i++; // consume the '/' too
      } else {
        out += '.*';
      }
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c && '.+^${}()|[]\\'.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * Build a matcher for one glob. Patterns containing a literal `/` (e.g.
 * `**\/dist/**`, `.github/**`) match the FULL path from the start; patterns
 * with no `/` (e.g. `*.lock`, `index.ts`, `tsconfig*.json`) match the
 * basename at ANY directory depth — a bare `index.ts` should catch
 * `src/api/index.ts`, not just a repo-root one.
 */
function compileGlob(glob: string): RegExp {
  const hasSlash = glob.includes('/');
  const body = globBodyToRegExpSource(glob);
  return hasSlash ? new RegExp(`^${body}$`) : new RegExp(`(?:^|.*/)${body}$`);
}

const BOILERPLATE_MATCHERS = BOILERPLATE_PATTERNS.map(compileGlob);
const WIRING_MATCHERS = WIRING_PATTERNS.map(compileGlob);

/** Normalize to forward slashes with no leading slash, so a Windows-style or
 *  root-anchored path still matches the same patterns as everything else. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Classify one file path into a Smart Diff role. Deterministic, no I/O.
 * Priority: boilerplate > wiring > core (a lock file under `dist/**` is still
 * boilerplate, not wiring or core).
 */
export function classifyFile(path: string): SmartDiffRole {
  const normalized = normalizePath(path);
  if (BOILERPLATE_MATCHERS.some((re) => re.test(normalized))) return 'boilerplate';
  if (WIRING_MATCHERS.some((re) => re.test(normalized))) return 'wiring';
  return 'core';
}

// ---- aggregation -------------------------------------------------------------

const ROLE_ORDER: readonly SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

/** Unique-by-line, ascending — a file with duplicate findings on one line
 *  (two agents, or accept/re-run) still shows one badge per line. When two
 *  findings share a line at different severities, the worse one wins. */
const SEVERITY_RANK: Record<SmartDiffFinding['severity'], number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

function dedupeAndSortFindings(findings: SmartDiffFinding[]): SmartDiffFinding[] {
  const byLine = new Map<number, SmartDiffFinding>();
  for (const f of findings) {
    const existing = byLine.get(f.line);
    if (!existing || SEVERITY_RANK[f.severity] > SEVERITY_RANK[existing.severity]) {
      byLine.set(f.line, f);
    }
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

/**
 * Build the full Smart Diff document. `findingsByFile` is keyed by the SAME
 * `path` as `files` (caller's job to align them — see `service.ts`, which
 * builds this map from the latest review's findings using the pulls-list
 * semantics).
 */
export function buildSmartDiff(
  files: SmartDiffInputFile[],
  findingsByFile: Map<string, SmartDiffFinding[]>,
): SmartDiff {
  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>();
  let totalLines = 0;
  let coreFileCount = 0;
  const coreFilePaths: string[] = [];

  for (const file of files) {
    const role = classifyFile(file.path);
    const smartDiffFile: SmartDiffFile = {
      path: file.path,
      // Deterministic feature — no LLM call backs this, ever.
      pseudocode_summary: null,
      additions: file.additions,
      deletions: file.deletions,
      findings: dedupeAndSortFindings(findingsByFile.get(file.path) ?? []),
    };
    const bucket = byRole.get(role);
    if (bucket) bucket.push(smartDiffFile);
    else byRole.set(role, [smartDiffFile]);

    totalLines += file.additions + file.deletions;
    if (role === 'core') {
      coreFileCount++;
      coreFilePaths.push(file.path);
    }
  }

  const groups = ROLE_ORDER.filter((role) => byRole.has(role)).map((role) => ({
    role,
    files: byRole.get(role) ?? [],
  }));

  const tooBig = totalLines > TOO_BIG_TOTAL_LINES || coreFileCount > TOO_BIG_CORE_FILES;

  return {
    groups,
    split_suggestion: {
      too_big: tooBig,
      total_lines: totalLines,
      // Deterministic-only: we don't have an LLM-free way to propose a
      // sensible multi-way split, so this stays empty for now — `too_big` +
      // `total_lines` are still enough signal for the client's banner.
      proposed_splits: [],
    },
  };
}
