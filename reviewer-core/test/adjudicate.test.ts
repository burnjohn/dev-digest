import { describe, expect, it } from 'vitest';
import type { Finding, UnifiedDiff } from '@devdigest/shared';
import {
  buildAdjudicationMessages,
  dedupeFindings,
} from '../src/review/adjudicate.js';

const candidate: Finding = {
  id: 'f1',
  severity: 'WARNING',
  category: 'bug',
  title: 'Inverted condition',
  file: 'src/a.ts',
  start_line: 11,
  end_line: 11,
  rationale: 'The branch rejects valid input.',
  confidence: 0.8,
  kind: 'finding',
};

const diff: UnifiedDiff = {
  raw: [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,4 +10,4 @@ function accept(value) {',
    ' const normalized = normalize(value);',
    '-if (normalized) return false;',
    '+if (!normalized) return false;',
    ' return true;',
    ' }',
    '@@ -100,1 +100,1 @@ function unrelated() {',
    "-return 'old-far-away';",
    "+return 'new-far-away';",
  ].join('\n'),
  files: [
    {
      path: 'src/a.ts',
      additions: 2,
      deletions: 2,
      hunks: [
        { file: 'src/a.ts', oldStart: 10, oldLines: 4, newStart: 10, newLines: 4, newLineNumbers: [10, 11, 12, 13] },
        { file: 'src/a.ts', oldStart: 100, oldLines: 1, newStart: 100, newLines: 1, newLineNumbers: [100] },
      ],
    },
  ],
};

describe('buildAdjudicationMessages', () => {
  it('wraps candidates and compact cited evidence as untrusted input', () => {
    const messages = buildAdjudicationMessages({ candidates: [candidate], diff });
    const user = messages.find((message) => message.role === 'user')!.content;

    expect(user).toContain('<untrusted source="review-candidates">');
    expect(user).toContain('<untrusted source="candidate-evidence">');
    expect(user).toContain('src/a.ts:11');
    expect(user).toContain('+if (!normalized) return false;');
    expect(user).not.toContain('new-far-away');
  });

  it('gives the adjudicator an authoritative stage scope', () => {
    const system = buildAdjudicationMessages({ candidates: [candidate], diff })
      .find((message) => message.role === 'system')!.content;

    expect(system).toContain('CURRENT REVIEW SCOPE — adjudicate grounded mapper candidates');
  });
});

describe('dedupeFindings', () => {
  it('keeps the highest-confidence duplicate and preserves exact anchors', () => {
    const higher = { ...candidate, id: 'f2', confidence: 0.95, title: '  INVERTED   CONDITION ' };

    const deduped = dedupeFindings([candidate, higher]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]!.id).toBe('f2');
    expect(deduped[0]!.file).toBe('src/a.ts');
    expect(deduped[0]!.start_line).toBe(11);
  });

  it('does not merge distinct locations or categories', () => {
    expect(
      dedupeFindings([
        candidate,
        { ...candidate, id: 'f2', start_line: 12, end_line: 12 },
        { ...candidate, id: 'f3', category: 'security' },
      ]),
    ).toHaveLength(3);
  });
});
