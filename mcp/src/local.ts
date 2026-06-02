/**
 * Local working-tree helpers for the MCP tools / pre-push CLI.
 *
 * These operate on the developer's checkout (no engine round-trip) so that
 * `grep_repo`, `read_file`, and the pre-push `review_diff` work against
 * uncommitted changes — exactly what you want before pushing.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

export interface GrepHit {
  path: string;
  line: number;
  text: string;
}

/** Run `git` in `cwd` and return stdout (throws on non-zero with stderr). */
function git(args: string[], cwd: string): string {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr?.trim() || res.status}`);
  }
  return res.stdout;
}

/** The unified diff of the working tree (staged + unstaged) vs HEAD. */
export function workingDiff(cwd = process.cwd()): string {
  // include staged + unstaged; `HEAD` so brand-new staged files appear too
  const staged = git(['diff', '--cached', 'HEAD'], cwd);
  const unstaged = git(['diff'], cwd);
  return [staged, unstaged].filter(Boolean).join('\n');
}

/** The diff of `base..HEAD` (what a pre-push hook would send upstream). */
export function pushDiff(base = 'origin/HEAD', cwd = process.cwd()): string {
  try {
    return git(['diff', `${base}...HEAD`], cwd);
  } catch {
    // no upstream tracked yet → fall back to working diff
    return workingDiff(cwd);
  }
}

/** grep_repo via git grep (respects .gitignore, fast). Returns up to `limit`. */
export function grepRepo(pattern: string, cwd = process.cwd(), limit = 200): GrepHit[] {
  const res = spawnSync('git', ['grep', '-n', '-I', '-e', pattern], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  // git grep exits 1 when there are no matches — that's not an error for us.
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(`git grep failed: ${res.stderr?.trim() || res.status}`);
  }
  const hits: GrepHit[] = [];
  for (const line of (res.stdout ?? '').split('\n')) {
    const m = line.match(/^(.*?):(\d+):(.*)$/);
    if (m) hits.push({ path: m[1]!, line: Number(m[2]), text: m[3]! });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** read_file — read a repo file, guarding against path traversal out of cwd. */
export function readRepoFile(path: string, cwd = process.cwd()): string {
  const full = isAbsolute(path) ? path : resolve(cwd, path);
  const rel = relative(cwd, full);
  if (rel.startsWith('..')) {
    throw new Error(`Refusing to read outside the repo: ${path}`);
  }
  return readFileSync(full, 'utf8');
}
