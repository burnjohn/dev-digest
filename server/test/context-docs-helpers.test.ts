/**
 * Unit tests for context-docs pure helpers: `resolveConfinedPath` (AC-13
 * confinement gate) and `categoryFor`.
 *
 * Hermetic: pure functions, no I/O, no DB, no filesystem access.
 */
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  resolveConfinedPath,
  resolveEffectiveContent,
  isPathShapeValid,
  categoryFor,
} from '../src/modules/context-docs/helpers.js';

const CLONE_ROOT = path.resolve('/mock/clones/acme/api');
const FOLDERS = ['specs', 'docs', 'insights'];

describe('resolveConfinedPath — valid path inside a configured folder', () => {
  it('accepts a path directly under a configured folder', () => {
    const result = resolveConfinedPath(CLONE_ROOT, FOLDERS, 'specs/foo.md');
    expect(result).toBe(path.resolve(CLONE_ROOT, 'specs/foo.md'));
  });

  it('accepts a nested path several levels under a configured folder', () => {
    const result = resolveConfinedPath(CLONE_ROOT, FOLDERS, 'docs/design/2026-01-01-plan.md');
    expect(result).toBe(path.resolve(CLONE_ROOT, 'docs/design/2026-01-01-plan.md'));
  });
});

describe('resolveConfinedPath — traversal rejection', () => {
  it('rejects a ../../secret traversal attempt', () => {
    const result = resolveConfinedPath(CLONE_ROOT, FOLDERS, '../../secret');
    expect(result).toBeNull();
  });

  it('rejects a traversal that starts inside a configured folder but escapes via ..', () => {
    const result = resolveConfinedPath(CLONE_ROOT, FOLDERS, 'specs/../../../etc/passwd');
    expect(result).toBeNull();
  });
});

describe('resolveConfinedPath — absolute-path injection', () => {
  it('rejects an absolute path resolving outside the clone root', () => {
    const result = resolveConfinedPath(CLONE_ROOT, FOLDERS, '/etc/passwd');
    expect(result).toBeNull();
  });

  it('rejects an absolute path pointing at a sibling directory (prefix-alike but not nested)', () => {
    // e.g. cloneRoot = /mock/clones/acme/api, injected = /mock/clones/acme/api-evil/specs/x.md
    // Must NOT pass via a naive `startsWith(cloneRoot)` string check (no separator).
    const result = resolveConfinedPath(CLONE_ROOT, FOLDERS, `${CLONE_ROOT}-evil/specs/x.md`);
    expect(result).toBeNull();
  });
});

describe('resolveConfinedPath — unconfigured folder', () => {
  it('rejects a path under a folder not in the configured set (node_modules)', () => {
    const result = resolveConfinedPath(CLONE_ROOT, FOLDERS, 'node_modules/x.md');
    expect(result).toBeNull();
  });

  it('rejects a path under .git even though it resolves inside the clone', () => {
    const result = resolveConfinedPath(CLONE_ROOT, FOLDERS, '.git/config');
    expect(result).toBeNull();
  });
});

describe('resolveConfinedPath — bare clone root', () => {
  it('rejects the clone root itself with no subfolder', () => {
    const result = resolveConfinedPath(CLONE_ROOT, FOLDERS, '.');
    expect(result).toBeNull();
  });

  it('rejects a path resolving exactly to the clone root via traversal', () => {
    const result = resolveConfinedPath(CLONE_ROOT, FOLDERS, 'specs/..');
    expect(result).toBeNull();
  });
});

describe('resolveConfinedPath — empty folders array', () => {
  it('rejects every path when no folders are configured', () => {
    expect(resolveConfinedPath(CLONE_ROOT, [], 'specs/foo.md')).toBeNull();
    expect(resolveConfinedPath(CLONE_ROOT, [], '.')).toBeNull();
    expect(resolveConfinedPath(CLONE_ROOT, [], '../../secret')).toBeNull();
  });
});

describe('resolveEffectiveContent — overlay-vs-clone precedence (AC-25)', () => {
  it('returns undefined when neither clone nor overlay exists (AC-31)', () => {
    expect(resolveEffectiveContent(undefined, undefined)).toBeUndefined();
  });

  it('prefers the overlay body and marks source "overlay" when both exist', () => {
    expect(resolveEffectiveContent('clone text', 'overlay text')).toEqual({
      content: 'overlay text',
      source: 'overlay',
    });
  });

  it('marks source "overlay-only" when only an overlay exists', () => {
    expect(resolveEffectiveContent(undefined, 'uploaded text')).toEqual({
      content: 'uploaded text',
      source: 'overlay-only',
    });
  });

  it('uses the clone content with source "clone" when only a clone file exists', () => {
    expect(resolveEffectiveContent('clone text', undefined)).toEqual({
      content: 'clone text',
      source: 'clone',
    });
  });

  it('treats an empty-string overlay body as present (not absent)', () => {
    expect(resolveEffectiveContent('clone', '')).toEqual({ content: '', source: 'overlay' });
    expect(resolveEffectiveContent(undefined, '')).toEqual({ content: '', source: 'overlay-only' });
  });
});

describe('isPathShapeValid — clone-root-free overlay path validation (AC-13)', () => {
  it('accepts a path under a configured folder without any clone root', () => {
    expect(isPathShapeValid(FOLDERS, 'docs/new.md')).toBe(true);
    expect(isPathShapeValid(FOLDERS, 'specs/nested/x.md')).toBe(true);
  });

  it('rejects a .. traversal segment anywhere', () => {
    expect(isPathShapeValid(FOLDERS, '../secret.md')).toBe(false);
    expect(isPathShapeValid(FOLDERS, 'docs/../../etc/passwd')).toBe(false);
  });

  it('rejects an absolute path', () => {
    expect(isPathShapeValid(FOLDERS, '/etc/passwd')).toBe(false);
  });

  it('rejects a path under an unconfigured folder', () => {
    expect(isPathShapeValid(FOLDERS, 'node_modules/x.md')).toBe(false);
  });

  it('rejects a bare filename at the root (must be under a folder)', () => {
    expect(isPathShapeValid(FOLDERS, 'README.md')).toBe(false);
  });

  it('rejects everything when no folders are configured', () => {
    expect(isPathShapeValid([], 'docs/x.md')).toBe(false);
  });

  it('accepts the same in-folder paths that resolveConfinedPath accepts', () => {
    // Cross-check: any path isPathShapeValid accepts also resolves inside a real clone root.
    for (const p of ['specs/foo.md', 'docs/design/plan.md', 'insights/g.md']) {
      expect(isPathShapeValid(FOLDERS, p)).toBe(true);
      expect(resolveConfinedPath(CLONE_ROOT, FOLDERS, p)).not.toBeNull();
    }
  });
});

describe('categoryFor', () => {
  it('returns the first path segment as the category', () => {
    expect(categoryFor('specs/foo.md')).toBe('specs');
    expect(categoryFor('docs/design/plan.md')).toBe('docs');
  });

  it('normalizes backslash-separated (Windows-style) paths before extracting the category', () => {
    expect(categoryFor('insights\\gotchas.md')).toBe('insights');
  });

  it('falls back to the whole string when there is no separator', () => {
    expect(categoryFor('README.md')).toBe('README.md');
  });
});
