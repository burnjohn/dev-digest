import { describe, it, expect, vi } from 'vitest';
import { getDiff, REVIEW_MODES } from '../src/cli/diff.js';

describe('getDiff — mode → git selector (L04 pre-push CLI)', () => {
  it('D.P0.1 — working: diffs the whole uncommitted state (`git diff HEAD`)', async () => {
    const runGit = vi.fn(async () => 'PATCH');
    const out = await getDiff('working', runGit);
    expect(runGit).toHaveBeenCalledWith(['diff', 'HEAD']);
    expect(out).toBe('PATCH');
  });

  it('D.P0.2 — working: falls back to `git diff` when there is no HEAD (fresh repo)', async () => {
    const runGit = vi.fn(async (args: string[]) => {
      if (args.includes('HEAD')) throw new Error("fatal: ambiguous argument 'HEAD'");
      return 'FRESH';
    });
    const out = await getDiff('working', runGit);
    expect(runGit).toHaveBeenLastCalledWith(['diff']);
    expect(out).toBe('FRESH');
  });

  it('D.P1.1 — staged: reviews only `git add`-ed changes (`git diff --cached`)', async () => {
    const runGit = vi.fn(async () => '');
    await getDiff('staged', runGit);
    expect(runGit).toHaveBeenCalledWith(['diff', '--cached']);
  });

  it('D.P1.2 — branch: diffs the branch vs its base merge-base (`git diff <base>...HEAD`)', async () => {
    const runGit = vi.fn(async () => '');
    await getDiff('branch', runGit, 'develop');
    expect(runGit).toHaveBeenCalledWith(['diff', 'develop...HEAD']);
  });

  it('D.P1.3 — unknown mode throws a helpful error listing the valid modes', async () => {
    await expect(getDiff('nope' as never, vi.fn(async () => ''))).rejects.toThrow(
      new RegExp(REVIEW_MODES.join('|')),
    );
  });
});
