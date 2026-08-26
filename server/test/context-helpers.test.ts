import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  estimateTokens,
  formatDocBlock,
  resolveWithinRoot,
  nearestAncestorType,
} from '../src/modules/context/helpers.js';

/**
 * T5 (SPEC-01 project context) — pure transforms + the resolved-path
 * containment check. Hermetic: real `node:fs` against a throwaway temp
 * directory for the containment tests, everything else in-process.
 */
describe('context/helpers', () => {
  describe('estimateTokens (REQ-2, REQ-38)', () => {
    it('equals Math.ceil(chars / 4) for a known fixture', () => {
      expect(estimateTokens('fixture.md', 100, 1_000, 40)).toBe(10);
      expect(estimateTokens('fixture2.md', 7, 1_000, 1)).toBe(Math.ceil(1 / 4));
    });

    it('does not recompute for an unchanged (path, size, mtime) triple, and recomputes when mtime changes', () => {
      const first = estimateTokens('cache.md', 100, 1_000, 40);
      expect(first).toBe(10);

      // Same (path, size, mtime) triple, wildly different `chars` — if this
      // recomputed we would see ceil(999_999 / 4), not the cached 10.
      const second = estimateTokens('cache.md', 100, 1_000, 999_999);
      expect(second).toBe(10);

      // Changed mtime invalidates the cache and recomputes from the new chars.
      const third = estimateTokens('cache.md', 100, 2_000, 80);
      expect(third).toBe(20);
    });
  });

  describe('formatDocBlock (AC-21, REQ-21)', () => {
    it('starts with "### <path>" on its own line and leaves the body byte-identical, CRLF included', () => {
      const body = 'line one\r\nline two\r\n\r\nline four';
      const block = formatDocBlock('specs/security-baseline.md', body);

      expect(block.startsWith('### specs/security-baseline.md\n')).toBe(true);
      expect(block.slice('### specs/security-baseline.md\n'.length)).toBe(body);
    });

    it('never splits or normalises the body', () => {
      const body = 'a\r\nb\nc\r\r\n';
      const block = formatDocBlock('docs/x.md', body);
      expect(block).toBe(`### docs/x.md\n${body}`);
    });
  });

  describe('nearestAncestorType', () => {
    it('picks the NEAREST specs/docs/insights ancestor, not the first from the root', () => {
      expect(nearestAncestorType('docs/legacy-specs/insights/notes/x.md')).toBe('insights');
      expect(nearestAncestorType('specs/nested/deep/x.md')).toBe('specs');
      expect(nearestAncestorType('README.md')).toBeNull();
    });
  });

  describe('resolveWithinRoot (REQ-30, `## Untrusted inputs` §5)', () => {
    const dirs: string[] = [];

    afterEach(async () => {
      while (dirs.length > 0) {
        const dir = dirs.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
      }
    });

    async function freshRoots(): Promise<{ cloneDir: string; uploadDir: string }> {
      const base = await mkdtemp(join(tmpdir(), 'context-containment-'));
      dirs.push(base);
      const cloneDir = join(base, 'clone');
      const uploadDir = join(base, 'upload');
      await mkdir(join(cloneDir, 'specs'), { recursive: true });
      await mkdir(join(uploadDir, 'ws', 'repo'), { recursive: true });
      await writeFile(join(cloneDir, 'specs', 'a.md'), 'A');
      await writeFile(join(uploadDir, 'ws', 'repo', 'u.md'), 'U');
      return { cloneDir, uploadDir };
    }

    it('refuses a "../" traversal', async () => {
      const { cloneDir } = await freshRoots();
      const result = await resolveWithinRoot(cloneDir, '../../etc/passwd');
      expect(result).toBeNull();
    });

    it('refuses an absolute path', async () => {
      const { cloneDir } = await freshRoots();
      const outside = resolve(tmpdir(), 'definitely-outside-etc-passwd');
      const result = await resolveWithinRoot(cloneDir, outside);
      expect(result).toBeNull();
    });

    it('refuses a symlink that resolves outside the root', async () => {
      const { cloneDir } = await freshRoots();
      const outsideDir = await mkdtemp(join(tmpdir(), 'context-outside-'));
      dirs.push(outsideDir);
      const outsideFile = join(outsideDir, 'secret.md');
      await writeFile(outsideFile, 'secret');

      const linkPath = join(cloneDir, 'specs', 'link.md');
      try {
        await symlink(outsideFile, linkPath, 'file');
      } catch {
        // Environment cannot create symlinks (e.g. Windows without Developer
        // Mode / elevation) — nothing to assert, but nothing to fail either.
        return;
      }

      const result = await resolveWithinRoot(cloneDir, 'specs/link.md');
      expect(result).toBeNull();
    });

    it('accepts a legitimate nested path under the clone directory', async () => {
      const { cloneDir } = await freshRoots();
      const result = await resolveWithinRoot(cloneDir, 'specs/a.md');
      expect(result).not.toBeNull();
      expect(result).toBe(resolve(cloneDir, 'specs', 'a.md'));
    });

    it('accepts a legitimate nested path under the upload directory', async () => {
      const { uploadDir } = await freshRoots();
      const result = await resolveWithinRoot(uploadDir, 'ws/repo/u.md');
      expect(result).not.toBeNull();
      expect(result).toBe(resolve(uploadDir, 'ws', 'repo', 'u.md'));
    });

    it('accepts a path that does not exist yet (an upload target about to be written)', async () => {
      const { uploadDir } = await freshRoots();
      const result = await resolveWithinRoot(uploadDir, 'ws/repo/new-upload.md');
      expect(result).toBe(resolve(uploadDir, 'ws', 'repo', 'new-upload.md'));
    });
  });

  it('does not import js-tiktoken', async () => {
    const source = await readFile(join(__dirname, '../src/modules/context/helpers.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"]js-tiktoken['"]/);
  });
});
