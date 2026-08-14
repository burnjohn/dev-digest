import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  selectConfigFiles,
  readSamples,
  runExtractionModel,
  verifyEvidence,
} from '../src/modules/conventions/extract.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';

/**
 * Conventions extraction pipeline — hermetic (real temp dir on disk, no DB, no
 * network). Covers the two things that must never regress: config-file
 * selection is code-only (no model call in this file at all), and the
 * evidence gate only keeps candidates whose file+line-range exist, always
 * replacing the snippet with the real on-disk excerpt.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devdigest-conventions-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('selectConfigFiles', () => {
  it('finds only the config files actually present at the clone root', async () => {
    await writeFile(join(dir, 'tsconfig.json'), '{}');
    await writeFile(join(dir, '.eslintrc.json'), '{}');
    await writeFile(join(dir, 'README.md'), '# hi');

    const found = selectConfigFiles(dir);
    expect(found).toContain('tsconfig.json');
    expect(found).toContain('.eslintrc.json');
    expect(found).not.toContain('README.md');
    expect(found).not.toContain('prettier.config.js');
  });
});

describe('readSamples', () => {
  it('prefixes real 1-indexed line numbers and skips unreadable paths', async () => {
    await writeFile(join(dir, 'a.ts'), 'export const a = 1;\nexport const b = 2;\n');

    const samples = await readSamples(dir, ['a.ts', 'does-not-exist.ts']);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.path).toBe('a.ts');
    expect(samples[0]?.content).toBe('1: export const a = 1;\n2: export const b = 2;\n3: ');
  });
});

describe('runExtractionModel', () => {
  it('sends one structured call named ConventionCandidates and returns its candidates', async () => {
    const fixture = {
      candidates: [
        {
          category: 'naming',
          rule: 'Use async/await instead of .then() chains.',
          evidence_path: 'src/api/users.ts',
          evidence_start_line: 23,
          evidence_end_line: 31,
          evidence_snippet: 'whatever the model guessed',
          confidence: 0.91,
        },
      ],
    };
    const llm = new MockLLMProvider('openai', { structuredBySchema: { ConventionCandidates: fixture } });

    const result = await runExtractionModel(llm, 'deepseek/deepseek-v4-flash', [], [
      { path: 'src/api/users.ts', content: '1: const x = 1;\n' },
    ]);

    expect(result.raw).toEqual(fixture.candidates);
    expect(llm.calls).toHaveLength(1);
    expect((llm.calls[0]?.req as { schemaName: string }).schemaName).toBe('ConventionCandidates');
  });
});

describe('verifyEvidence', () => {
  async function writeSample() {
    await mkdir(join(dir, 'src'), { recursive: true });
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(dir, 'src', 'a.ts'), lines.join('\n'));
    return lines;
  }

  it('keeps a candidate whose file+lines exist and overwrites the snippet with real disk content', async () => {
    const lines = await writeSample();
    const { kept, dropped } = await verifyEvidence(dir, [
      {
        category: 'naming',
        rule: 'Some rule',
        evidence_path: 'src/a.ts',
        evidence_start_line: 5,
        evidence_end_line: 7,
        evidence_snippet: 'the model made this up',
        confidence: 0.8,
      },
    ]);

    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.evidenceSnippet).toBe(lines.slice(4, 7).join('\n'));
    expect(kept[0]?.evidenceSnippet).not.toContain('the model made this up');
  });

  it('drops a candidate whose file does not exist', async () => {
    await writeSample();
    const { kept, dropped } = await verifyEvidence(dir, [
      {
        category: 'naming',
        rule: 'Some rule',
        evidence_path: 'src/missing.ts',
        evidence_start_line: 1,
        evidence_end_line: 2,
        evidence_snippet: 'x',
        confidence: 0.8,
      },
    ]);
    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.reason).toMatch(/not found/);
  });

  it('drops a candidate whose line range is out of bounds', async () => {
    await writeSample();
    const { kept, dropped } = await verifyEvidence(dir, [
      {
        category: 'naming',
        rule: 'Some rule',
        evidence_path: 'src/a.ts',
        evidence_start_line: 100,
        evidence_end_line: 105,
        evidence_snippet: 'x',
        confidence: 0.8,
      },
    ]);
    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.reason).toMatch(/out of bounds/);
  });

  it('drops a candidate whose evidence_path tries to escape the clone', async () => {
    await writeSample();
    const { kept, dropped } = await verifyEvidence(dir, [
      {
        category: 'naming',
        rule: 'Some rule',
        evidence_path: '../../../etc/passwd',
        evidence_start_line: 1,
        evidence_end_line: 1,
        evidence_snippet: 'x',
        confidence: 0.8,
      },
    ]);
    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.reason).toMatch(/escapes the repo clone/);
  });
});
