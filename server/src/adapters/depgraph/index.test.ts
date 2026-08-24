/**
 * depgraph adapter — `toRel` normalisation unit test.
 *
 * Regression test for the Windows-only bug where `toRel` returned
 * `node:path.relative`'s platform-separated output verbatim (`src\api\routes.ts`
 * on Windows) while `buildEdges`'s `fileSet` (built from `walk.ts`, which
 * normalises with `relative(root, full).split(sep).join('/')`) only ever holds
 * forward-slash paths — so `fileSet.has(...)` failed for every module, and the
 * whole file-level import graph silently degraded to `[]` on every Windows run.
 *
 * `node:path` is mocked per-test to force `win32` separator behaviour
 * regardless of the host OS this suite actually runs on. The whole point of
 * the bug is platform-specific: a test that only observes the *host's own*
 * `path.sep` would pass identically whether or not the fix is present when run
 * on Linux CI, and would not have caught the original bug. Do NOT test by
 * invoking `cruise` — that needs a real repo on disk plus tsconfig/network
 * resolution; this drives the normalisation seam directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('node:path');
  vi.resetModules();
});

describe('toRel', () => {
  it('normalises a Windows-separated cruise path to repo-relative POSIX, matching fileSet', async () => {
    vi.resetModules();
    vi.doMock('node:path', async () => {
      const actual = await vi.importActual<typeof import('node:path')>('node:path');
      // Force win32 behaviour for every function `toRel` uses, independent of
      // the OS actually running this suite (CI is Linux; local dev may be
      // Windows) — this is what makes the assertion below fail if someone
      // reverts `toRel` to a bare `relative(root, abs)`.
      return {
        ...actual,
        sep: actual.win32.sep,
        isAbsolute: actual.win32.isAbsolute,
        relative: actual.win32.relative,
        resolve: actual.win32.resolve,
        join: actual.win32.join,
      };
    });

    const { toRel } = await import('./index.js');

    // Exact shape dependency-cruiser hands back on Windows: an absolute,
    // backslash-separated `resolved`/`source` path.
    const result = toRel('C:\\repo', 'C:\\repo\\src\\api\\routes.ts');

    expect(result).toBe('src/api/routes.ts');
    expect(result).not.toContain('\\');
  });

  it('normalises a deeper Windows path with multiple nested separators', async () => {
    vi.resetModules();
    vi.doMock('node:path', async () => {
      const actual = await vi.importActual<typeof import('node:path')>('node:path');
      return {
        ...actual,
        sep: actual.win32.sep,
        isAbsolute: actual.win32.isAbsolute,
        relative: actual.win32.relative,
        resolve: actual.win32.resolve,
        join: actual.win32.join,
      };
    });

    const { toRel } = await import('./index.js');

    const root = 'C:\\workspace\\dev-digest';
    const absolute =
      'C:\\workspace\\dev-digest\\server\\src\\modules\\repo-intel\\pipeline\\walk.ts';

    expect(toRel(root, absolute)).toBe('server/src/modules/repo-intel/pipeline/walk.ts');
  });

  it('is a no-op on the real host separator (POSIX parity, unmocked)', async () => {
    vi.resetModules();
    const { toRel } = await import('./index.js');
    const { join } = await import('node:path');

    const root = process.cwd();
    const absolute = join(root, 'src', 'adapters', 'depgraph', 'index.ts');

    // Exercises the REAL host `node:path` (unmocked): on POSIX (`sep === '/'`)
    // `.split(sep).join('/')` is a no-op over an already-POSIX path; on
    // Windows it performs the real conversion. Either way the result must be
    // repo-relative POSIX.
    expect(toRel(root, absolute)).toBe('src/adapters/depgraph/index.ts');
  });
});
