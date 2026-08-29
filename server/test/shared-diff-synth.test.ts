import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAgentCaseDiff, buildSkillCaseDiff } from '../src/modules/_shared/diff-synth.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

/**
 * SPEC-03 T5 — the pure diff synthesizer for both eval-case owner kinds.
 * REQ-56, REQ-57, REQ-58 (buildSkillCaseDiff) and REQ-4/REQ-20 (buildAgentCaseDiff).
 */

describe('buildSkillCaseDiff', () => {
  it('REQ-56: absent, empty and whitespace-only filenames all normalize to snippet.ts', () => {
    for (const filename of [undefined, null, '', '   ']) {
      const diff = buildSkillCaseDiff({ after: 'x', filename });
      const parsed = parseUnifiedDiff(diff);
      expect(parsed.files).toHaveLength(1);
      expect(parsed.files[0].path).toBe('snippet.ts');
    }
  });

  it('REQ-57: an m-line after numbers 1..m on the new side, and an empty before is a zero-length old side', () => {
    const after = 'line1\nline2\nline3\nline4';
    const diff = buildSkillCaseDiff({ after, filename: 'new-file.ts' });
    const parsed = parseUnifiedDiff(diff);

    expect(parsed.files).toHaveLength(1);
    const file = parsed.files[0];
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0].newLineNumbers).toEqual([1, 2, 3, 4]);
    expect(file.hunks[0].oldStart).toBe(0);
    expect(file.hunks[0].oldLines).toBe(0);
  });

  it('REQ-57: a modified_file case numbers only the after lines 1..m', () => {
    const diff = buildSkillCaseDiff({
      before: 'old1\nold2',
      after: 'new1\nnew2\nnew3',
      filename: 'mod.ts',
    });
    const parsed = parseUnifiedDiff(diff);
    const file = parsed.files[0];
    expect(file.hunks[0].newLineNumbers).toEqual([1, 2, 3]);
    expect(file.hunks[0].oldLines).toBe(2);
    expect(file.additions).toBe(3);
    expect(file.deletions).toBe(2);
  });

  it('REQ-58: authored source containing diff --git/---/+++/@@ at column 0 round-trips as one file, one hunk, forging no header', () => {
    const after = [
      'const s = "diff --git a/x b/x";',
      'const t = "--- a/x";',
      'const u = "+++ b/x";',
      'const v = "@@ -1,1 +1,1 @@";',
    ].join('\n');
    const diff = buildSkillCaseDiff({ after, filename: 'authored.ts' });
    const parsed = parseUnifiedDiff(diff);

    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].path).toBe('authored.ts');
    expect(parsed.files[0].hunks).toHaveLength(1);
    expect(parsed.files[0].hunks[0].newLineNumbers).toEqual([1, 2, 3, 4]);
  });

  it('REQ-58 bypass case: an after line `++ evil.ts` and a before line `-- evil.ts` round-trip without forging the path or spawning a second file', () => {
    const diff = buildSkillCaseDiff({
      before: '-- evil.ts',
      after: '++ evil.ts',
      filename: 'case-42.ts',
    });
    const parsed = parseUnifiedDiff(diff);

    // Assert on the PATH, not only the file count: before the parser guard
    // this input parses to one file named `evil.ts`, which a count-only
    // assertion would pass.
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].path).toBe('case-42.ts');
    // Both lines survive into the hunk (correctly classified, not eaten as
    // fake headers): one deletion, one addition, and the addition still
    // occupies new-side line 1.
    expect(parsed.files[0].additions).toBe(1);
    expect(parsed.files[0].deletions).toBe(1);
    expect(parsed.files[0].hunks).toHaveLength(1);
    expect(parsed.files[0].hunks[0].newLineNumbers).toEqual([1]);
  });
});

describe('buildAgentCaseDiff', () => {
  it('REQ-4/REQ-20: a bare hunk-only patch parses to files: [] alone, and the synthesized diff resolves one file with the finding path', () => {
    const barePatch = '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,';

    // The bare patch alone (no header) is unparseable — asserts the "half"
    // that motivates buildAgentCaseDiff existing at all.
    const bareParsed = parseUnifiedDiff(barePatch);
    expect(bareParsed.files).toEqual([]);

    const diff = buildAgentCaseDiff('src/config.ts', barePatch);
    const parsed = parseUnifiedDiff(diff);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].path).toBe('src/config.ts');
    expect(parsed.files[0].hunks[0].newLineNumbers).toEqual([10, 11, 12]);
  });
});

describe('purity: _shared/ holds only R0/R1-grade code', () => {
  it('diff-synth.ts imports nothing — no drizzle-orm, fastify, node:fs, container, or modules/**', () => {
    const path = fileURLToPath(new URL('../src/modules/_shared/diff-synth.ts', import.meta.url));
    const source = readFileSync(path, 'utf-8');
    const importLines = source.match(/^import .*$/gm) ?? [];
    expect(importLines).toEqual([]);
  });
});
