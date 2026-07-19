import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Review modes. `--mode working` is the headline: review what's in the working
 * copy right now, before `git push`. The other modes are the same seam with a
 * different `git diff` selector — the reviewer downstream is identical.
 */
export type ReviewMode = 'working' | 'staged' | 'branch';
export const REVIEW_MODES: readonly ReviewMode[] = ['working', 'staged', 'branch'];

/** Injected git runner: `(args) => stdout`. Real impl shells out; tests stub it. */
export type GitRunner = (args: string[]) => Promise<string>;

/** Default runner — `git <args>` in `cwd`, stdout as UTF-8 (stderr surfaced on failure). */
export function makeGitRunner(cwd: string): GitRunner {
  return async (args) => {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  };
}

/**
 * `git diff` selector per mode. The whole feature turns on choosing the right
 * diff to review; everything after this is mode-agnostic.
 *
 *   working → `git diff HEAD`  — every uncommitted change (staged + unstaged)
 *             vs the last commit: the true "not yet pushed" state. Falls back to
 *             `git diff` in a repo with no commits yet (no HEAD to diff against).
 *   staged  → `git diff --cached`         — only what's `git add`-ed.
 *   branch  → `git diff <base>...HEAD`     — the whole branch vs its base
 *             (merge-base), i.e. what a PR would show. `base` defaults to `main`.
 */
export async function getDiff(
  mode: ReviewMode,
  runGit: GitRunner,
  base = 'main',
): Promise<string> {
  switch (mode) {
    case 'working':
      try {
        return await runGit(['diff', 'HEAD']);
      } catch {
        // No HEAD yet (fresh repo, zero commits) → diff the index/worktree as-is.
        return runGit(['diff']);
      }
    case 'staged':
      return runGit(['diff', '--cached']);
    case 'branch':
      return runGit(['diff', `${base}...HEAD`]);
    default:
      throw new Error(
        `Unknown --mode "${mode as string}". Use one of: ${REVIEW_MODES.join(', ')}.`,
      );
  }
}
