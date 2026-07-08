import { describe, it, expect } from 'vitest';
import { buildDedupKey, isSafeEvidencePath } from '../src/modules/conventions/extractor.js';

/**
 * Unit tests for the Conventions Extractor helper functions.
 * Pure (no DB, no LLM, no file I/O) — focused on security and dedup logic.
 */
describe('buildDedupKey', () => {
  it('is deterministic for the same inputs', () => {
    const a = buildDedupKey('async-patterns', 'Always use async/await', 'src/api/users.ts');
    const b = buildDedupKey('async-patterns', 'Always use async/await', 'src/api/users.ts');
    expect(a).toBe(b);
  });

  it('is case-insensitive on category and rule', () => {
    const a = buildDedupKey('Async-Patterns', 'Always use async/await', 'src/api/users.ts');
    const b = buildDedupKey('async-patterns', 'always use async/await', 'src/api/users.ts');
    expect(a).toBe(b);
  });

  it('collapses whitespace in rule', () => {
    const a = buildDedupKey('naming', 'Use camelCase for  variables', 'src/lib/x.ts');
    const b = buildDedupKey('naming', 'Use camelCase for variables', 'src/lib/x.ts');
    expect(a).toBe(b);
  });

  it('differs when evidenceFile differs', () => {
    const a = buildDedupKey('naming', 'Use camelCase', 'src/api/users.ts');
    const b = buildDedupKey('naming', 'Use camelCase', 'src/api/posts.ts');
    expect(a).not.toBe(b);
  });

  it('produces a 32-char hex string', () => {
    const k = buildDedupKey('testing', 'Always mock at service boundary', 'test/setup.ts');
    expect(k).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('isSafeEvidencePath — path traversal guard', () => {
  const root = '/workspace/my-repo';

  it('allows a normal relative file path', () => {
    expect(isSafeEvidencePath(root, 'src/api/users.ts')).toBe(true);
  });

  it('allows a nested path', () => {
    expect(isSafeEvidencePath(root, 'packages/core/src/index.ts')).toBe(true);
  });

  it('rejects a path that escapes via ../', () => {
    expect(isSafeEvidencePath(root, '../etc/passwd')).toBe(false);
  });

  it('rejects an absolute path outside repoRoot', () => {
    expect(isSafeEvidencePath(root, '/etc/passwd')).toBe(false);
  });

  it('rejects a deeply nested traversal attempt', () => {
    expect(isSafeEvidencePath(root, 'src/../../../../../../etc/shadow')).toBe(false);
  });

  it('rejects a path that is a prefix of root but not inside it', () => {
    // /workspace/my-repo-evil should not pass for root /workspace/my-repo
    expect(isSafeEvidencePath(root, '../my-repo-evil/secret.ts')).toBe(false);
  });
});
