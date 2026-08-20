import { describe, it, expect } from 'vitest';
import {
  buildSkillDraft,
  dedupeCandidates,
  renderSample,
  renderSamples,
  ruleKey,
  slugify,
  toSampledFile,
  verifyCandidate,
  type RawCandidate,
  type SampledFile,
  type VerifiedCandidate,
} from '../src/modules/conventions/helpers.js';
import type { ConventionRow } from '../src/db/rows.js';

/**
 * The Conventions Extractor's code-only halves: what the model is shown, and
 * the evidence gate that decides which of its candidates survive. Hermetic —
 * no DB, no model, no filesystem.
 */

const USERS = [
  'export async function getUser(id: string) {',
  '  const user = await db.users.find(id);',
  '  if (!user) throw new NotFoundError("User not found");',
  '  return user;',
  '}',
].join('\n');

function sample(entries: Record<string, string>): Map<string, SampledFile> {
  return new Map(
    Object.entries(entries).map(([path, text]) => [path, toSampledFile(path, text)]),
  );
}

function raw(over: Partial<RawCandidate> = {}): RawCandidate {
  return {
    category: 'errors',
    rule: 'Throw NotFoundError instead of returning null for a missing row',
    rationale: 'Callers rely on the error, not a null check.',
    evidence_path: 'src/api/users.ts',
    evidence_line: 3,
    evidence_snippet: '  if (!user) throw new NotFoundError("User not found");',
    confidence: 0.82,
    ...over,
  };
}

describe('renderSample', () => {
  it('prefixes 1-based line numbers, which is what makes a citation checkable', () => {
    const out = renderSample(toSampledFile('a.ts', 'const a = 1;\nconst b = 2;'));
    expect(out).toBe('--- FILE: a.ts ---\n1\tconst a = 1;\n2\tconst b = 2;');
  });

  it('marks a file truncated by the per-file cap', () => {
    const big = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
    const file = toSampledFile('big.ts', big);
    expect(file.truncated).toBe(true);
    expect(renderSample(file)).toContain('… (truncated)');
  });

  it('stops adding files once the whole-sample budget is spent', () => {
    const files = [toSampledFile('a.ts', 'a'.repeat(200)), toSampledFile('b.ts', 'b'.repeat(200))];
    const out = renderSamples(files, 240);
    expect(out).toContain('a.ts');
    expect(out).not.toContain('b.ts');
  });
});

describe('verifyCandidate', () => {
  it('keeps a candidate whose snippet is really in the cited file', () => {
    const result = verifyCandidate(sample({ 'src/api/users.ts': USERS }), raw());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.evidenceLine).toBe(3);
    expect(result.candidate.evidencePath).toBe('src/api/users.ts');
  });

  it('replays the snippet FROM THE FILE, so displayed evidence is never the model’s words', () => {
    const result = verifyCandidate(
      sample({ 'src/api/users.ts': USERS }),
      raw({ evidence_snippet: 'if (!user) throw new NotFoundError("User not found")' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Dedented file text, not the paraphrase the model sent (no trailing `;` there).
    expect(result.candidate.evidenceSnippet).toBe(
      'if (!user) throw new NotFoundError("User not found");',
    );
  });

  it('corrects an off-by-N line number rather than dropping a real rule', () => {
    const result = verifyCandidate(sample({ 'src/api/users.ts': USERS }), raw({ evidence_line: 11 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.evidenceLine).toBe(3);
  });

  it('drops a candidate citing a file that was never sampled', () => {
    const result = verifyCandidate(
      sample({ 'src/api/users.ts': USERS }),
      raw({ evidence_path: 'src/api/invented.ts' }),
    );
    expect(result).toEqual({ ok: false, reason: 'unknown_file' });
  });

  it('drops a candidate whose snippet is not in the file (the hallucination case)', () => {
    const result = verifyCandidate(
      sample({ 'src/api/users.ts': USERS }),
      raw({ evidence_snippet: 'return Result.err(new ApiError("nope"));' }),
    );
    expect(result).toEqual({ ok: false, reason: 'snippet_not_found' });
  });

  it('drops a snippet too short to identify a line', () => {
    const result = verifyCandidate(
      sample({ 'src/api/users.ts': USERS }),
      raw({ evidence_snippet: '}' }),
    );
    expect(result).toEqual({ ok: false, reason: 'snippet_too_short' });
  });

  it('tolerates a `./`-prefixed or bare-filename citation when it resolves uniquely', () => {
    const files = sample({ 'src/api/users.ts': USERS });
    expect(verifyCandidate(files, raw({ evidence_path: './src/api/users.ts' })).ok).toBe(true);
    expect(verifyCandidate(files, raw({ evidence_path: 'users.ts' })).ok).toBe(true);
  });

  it('refuses to guess when a bare filename matches two sampled files', () => {
    const files = sample({ 'src/api/users.ts': USERS, 'src/db/users.ts': USERS });
    expect(verifyCandidate(files, raw({ evidence_path: 'users.ts' }))).toEqual({
      ok: false,
      reason: 'unknown_file',
    });
  });

  it('strips a line-number gutter the model echoed back', () => {
    const result = verifyCandidate(
      sample({ 'src/api/users.ts': USERS }),
      raw({ evidence_snippet: '3\t  if (!user) throw new NotFoundError("User not found");' }),
    );
    expect(result.ok).toBe(true);
  });

  it('falls back to `general` for a category outside the enum', () => {
    const result = verifyCandidate(
      sample({ 'src/api/users.ts': USERS }),
      raw({ category: 'vibes' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.category).toBe('general');
  });
});

describe('dedupeCandidates', () => {
  const make = (rule: string, confidence = 0.8): VerifiedCandidate => ({
    category: 'general',
    rule,
    rationale: null,
    evidencePath: 'a.ts',
    evidenceLine: 1,
    evidenceSnippet: 'x',
    confidence,
  });

  it('keeps the first of two rules that differ only in punctuation and case', () => {
    const { kept, dropped } = dedupeCandidates([
      make('Use async/await instead of .then() chains'),
      make('use async/await instead of `.then()` chains.'),
    ]);
    expect(kept).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  it('drops a rule the user already accepted or rejected in an earlier scan', () => {
    const seen = [ruleKey('Use async/await instead of .then() chains')];
    const { kept } = dedupeCandidates([make('Use async/await instead of .then() chains')], seen);
    expect(kept).toHaveLength(0);
  });
});

describe('buildSkillDraft', () => {
  const row = (over: Partial<ConventionRow> = {}): ConventionRow =>
    ({
      id: 'c1',
      workspaceId: 'w1',
      repoId: 'r1',
      category: 'errors',
      rule: 'Throw NotFoundError instead of returning null',
      rationale: 'Callers rely on the error.',
      evidencePath: 'src/api/users.ts',
      evidenceLine: 3,
      evidenceSnippet: 'if (!user) throw new NotFoundError("User not found");',
      confidence: 0.9,
      status: 'accepted',
      createdAt: new Date('2026-08-05T00:00:00Z'),
      ...over,
    }) as ConventionRow;

  it('names the skill after the repo and types it `convention`', () => {
    const draft = buildSkillDraft('acme/payments-api', [row()]);
    expect(draft.name).toBe('payments-api-conventions');
    expect(draft.type).toBe('convention');
    expect(draft.description).toContain('1 house convention');
  });

  it('carries each rule’s file:line evidence into the body', () => {
    const draft = buildSkillDraft('acme/payments-api', [row()]);
    expect(draft.body).toContain('## throw-notfounderror-instead-of-returning-null');
    expect(draft.body).toContain('Detected in `src/api/users.ts:3`:');
    expect(draft.body).toContain('throw new NotFoundError("User not found");');
  });

  it('reports the evidence files and the ids it was built from', () => {
    const draft = buildSkillDraft('acme/payments-api', [row(), row({ id: 'c2' })]);
    expect(draft.evidence_files).toEqual(['src/api/users.ts']); // deduped
    expect(draft.convention_ids).toEqual(['c1', 'c2']);
  });

  it('omits the evidence block for a rule that has no snippet', () => {
    const draft = buildSkillDraft('acme/payments-api', [row({ evidencePath: null })]);
    expect(draft.body).not.toContain('Detected in');
  });
});

describe('slugify', () => {
  it('caps the anchor at six words', () => {
    expect(slugify('Always use async/await instead of .then() chains everywhere')).toBe(
      'always-use-asyncawait-instead-of-then',
    );
  });

  it('never returns an empty anchor', () => {
    expect(slugify('!!!')).toBe('rule');
  });
});
