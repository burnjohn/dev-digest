import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkContextDocs } from '../src/modules/context/pipeline/walk-docs.js';
import { MAX_INDEXED_FILES } from '../src/modules/context/constants.js';

/**
 * T5 (SPEC-01 project context) — the bounded document walk. Hermetic: real
 * `node:fs` against a throwaway temp directory, no DB, no Container.
 */
describe('walkContextDocs', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function freshCloneDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'context-walk-'));
    dirs.push(dir);
    return dir;
  }

  it('REQ-1 — lists every .md file with a specs/docs/insights ancestor and none without one, with the nearest ancestor as the badge', async () => {
    const cloneDir = await freshCloneDir();
    await mkdir(join(cloneDir, 'specs', 'nested'), { recursive: true });
    await mkdir(join(cloneDir, 'docs'), { recursive: true });
    await mkdir(join(cloneDir, 'insights'), { recursive: true });
    await mkdir(join(cloneDir, 'node_modules', 'specs'), { recursive: true });

    await writeFile(join(cloneDir, 'specs', 'a.md'), 'A');
    await writeFile(join(cloneDir, 'specs', 'nested', 'b.md'), 'B');
    await writeFile(join(cloneDir, 'docs', 'c.md'), 'C');
    await writeFile(join(cloneDir, 'insights', 'd.md'), 'D');
    await writeFile(join(cloneDir, 'README.md'), 'no ancestor — must be excluded');
    await writeFile(join(cloneDir, 'node_modules', 'specs', 'skip.md'), 'excluded dir');

    const result = await walkContextDocs(cloneDir, ['.']);

    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual(['docs/c.md', 'insights/d.md', 'specs/a.md', 'specs/nested/b.md']);

    // Forward-slash normalised, and the badge is the NEAREST ancestor.
    const nested = result.files.find((f) => f.path === 'specs/nested/b.md');
    expect(nested?.type).toBe('specs');
    const docs = result.files.find((f) => f.path === 'docs/c.md');
    expect(docs?.type).toBe('docs');
    const insights = result.files.find((f) => f.path === 'insights/d.md');
    expect(insights?.type).toBe('insights');

    // README.md and node_modules/specs/skip.md never appear.
    expect(paths).not.toContain('README.md');
    expect(paths).not.toContain('node_modules/specs/skip.md');
  });

  it('REQ-1 — the default root "." (the clone root) reaches every ancestor, not just the top level', async () => {
    const cloneDir = await freshCloneDir();
    await mkdir(join(cloneDir, 'packages', 'api', 'specs'), { recursive: true });
    await writeFile(join(cloneDir, 'packages', 'api', 'specs', 'x.md'), 'X');

    const result = await walkContextDocs(cloneDir, ['.']);

    expect(result.files.map((f) => f.path)).toEqual(['packages/api/specs/x.md']);
    expect(result.files[0]?.type).toBe('specs');
  });

  it('REQ-8/REQ-40 — an oversized file is listed and flagged, not dropped, and the bound is the fixed 400 KB constant', async () => {
    const cloneDir = await freshCloneDir();
    await mkdir(join(cloneDir, 'specs'), { recursive: true });
    const big = 'x'.repeat(401 * 1024); // 401 KB, over the 400 KB bound
    await writeFile(join(cloneDir, 'specs', 'big.md'), big);
    await writeFile(join(cloneDir, 'specs', 'small.md'), 'small');

    const result = await walkContextDocs(cloneDir, ['.']);

    const bigFile = result.files.find((f) => f.path === 'specs/big.md');
    expect(bigFile).toBeDefined();
    expect(bigFile?.oversized).toBe(true);
    expect(bigFile?.size).toBe(401 * 1024);

    const smallFile = result.files.find((f) => f.path === 'specs/small.md');
    expect(smallFile?.oversized).toBe(false);

    // The bound in this module's own constants file, not a config value.
    const constantsSource = await readFile(
      join(__dirname, '../src/modules/context/constants.ts'),
      'utf-8',
    );
    expect(constantsSource).toMatch(/MAX_FILE_SIZE\s*=\s*400\s*\*\s*1024/);
  });

  it(
    'REQ-9/REQ-40 — 5 001 candidates yield exactly 5 000 entries, a true bounded flag, and the bound reported',
    async () => {
      const cloneDir = await freshCloneDir();
      await mkdir(join(cloneDir, 'specs'), { recursive: true });

      const total = MAX_INDEXED_FILES + 1;
      const batchSize = 200;
      for (let start = 0; start < total; start += batchSize) {
        const end = Math.min(start + batchSize, total);
        const batch: Promise<void>[] = [];
        for (let i = start; i < end; i++) {
          const name = `f${String(i).padStart(5, '0')}.md`;
          batch.push(writeFile(join(cloneDir, 'specs', name), 'x'));
        }
        await Promise.all(batch);
      }

      const result = await walkContextDocs(cloneDir, ['.']);

      expect(result.files).toHaveLength(MAX_INDEXED_FILES);
      expect(result.stats.bounded).toBe(true);
      expect(result.stats.bound).toBe(MAX_INDEXED_FILES);
    },
    30_000,
  );

  it('REQ-37 — a root escaping cloneDir is refused, a missing root is skipped, and neither fails the listing', async () => {
    const cloneDir = await freshCloneDir();
    await mkdir(join(cloneDir, 'specs'), { recursive: true });
    await writeFile(join(cloneDir, 'specs', 'a.md'), 'A');

    const result = await walkContextDocs(cloneDir, ['specs', '../outside-clone', 'does-not-exist']);

    expect(result.files.map((f) => f.path)).toEqual(['specs/a.md']);

    const byRoot = new Map(result.stats.skippedRoots.map((s) => [s.root, s.reason]));
    expect(byRoot.get('../outside-clone')).toBe('escaped');
    expect(byRoot.get('does-not-exist')).toBe('missing');
  });

  it('does not import js-tiktoken', async () => {
    const source = await readFile(
      join(__dirname, '../src/modules/context/pipeline/walk-docs.ts'),
      'utf-8',
    );
    expect(source).not.toMatch(/from ['"]js-tiktoken['"]/);
  });
});
