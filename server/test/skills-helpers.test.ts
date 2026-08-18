import { describe, it, expect } from 'vitest';
import {
  deriveSkillName,
  isBodyChange,
  normalizeVersionMessage,
  resolveSkillName,
  restoreVersionMessage,
  slugifySkillName,
  toSkillDto,
  toSkillListItemDto,
  toSkillVersionDto,
} from '../src/modules/skills/helpers.js';
import { selectSkillBodies } from '../src/modules/reviews/helpers.js';
import type { SkillRow, SkillVersionRow } from '../src/db/rows.js';

const row = (over: Partial<SkillRow> = {}): SkillRow => ({
  id: 'sk1',
  workspaceId: 'ws1',
  name: 'uncovered-branch-gate',
  description: 'Flags uncovered branches',
  type: 'rubric',
  source: 'manual',
  body: '# Gate\nBody text.',
  enabled: true,
  version: 3,
  evidenceFiles: null,
  createdAt: new Date('2026-08-16T10:00:00.000Z'),
  ...over,
});

describe('toSkillDto', () => {
  it('maps a row to the wire shape and keeps workspace_id OFF it', () => {
    const dto = toSkillDto(row());
    expect(dto).toEqual({
      id: 'sk1',
      name: 'uncovered-branch-gate',
      description: 'Flags uncovered branches',
      type: 'rubric',
      source: 'manual',
      body: '# Gate\nBody text.',
      enabled: true,
      version: 3,
      evidence_files: null,
    });
    expect(dto).not.toHaveProperty('workspace_id');
    expect(dto).not.toHaveProperty('createdAt');
  });

  it('passes evidence_files through as an array', () => {
    expect(toSkillDto(row({ evidenceFiles: ['SKILL.md'] })).evidence_files).toEqual(['SKILL.md']);
  });

  it('adds used_by for the list item shape', () => {
    expect(toSkillListItemDto(row(), 4).used_by).toBe(4);
  });
});

describe('toSkillVersionDto', () => {
  const versionRow = (over: Partial<SkillVersionRow> = {}): SkillVersionRow => ({
    skillId: 'sk1',
    version: 2,
    body: 'b',
    message: null,
    createdAt: new Date('2026-08-16T10:00:00.000Z'),
    ...over,
  });

  it('serializes created_at as ISO-8601', () => {
    expect(toSkillVersionDto(versionRow())).toEqual({
      skill_id: 'sk1',
      version: 2,
      body: 'b',
      message: null,
      created_at: '2026-08-16T10:00:00.000Z',
    });
  });

  it('maps a NULL message column to null, never undefined', () => {
    // The contract declares `message` `.nullable()`, not `.optional()`, so the
    // key must be present on the wire for every pre-0016 snapshot too. An
    // `undefined` here would be dropped by JSON.stringify and the client would
    // have two shapes meaning "no note".
    const dto = toSkillVersionDto(versionRow({ message: null }));
    expect(dto.message).toBeNull();
    expect(Object.keys(dto)).toContain('message');
  });

  it('passes a stored note through verbatim', () => {
    expect(toSkillVersionDto(versionRow({ message: 'Restored from v1' })).message).toBe(
      'Restored from v1',
    );
  });
});

describe('normalizeVersionMessage — one choke point for "no note"', () => {
  it('collapses an absent note to null', () => {
    expect(normalizeVersionMessage(undefined)).toBeNull();
  });

  it('collapses an empty string to null', () => {
    expect(normalizeVersionMessage('')).toBeNull();
  });

  it('collapses a whitespace-only note to null', () => {
    expect(normalizeVersionMessage('   \t\n ')).toBeNull();
  });

  it('trims a real note', () => {
    expect(normalizeVersionMessage('  tightened the rule  ')).toBe('tightened the rule');
  });
});

describe('restoreVersionMessage — server-authored, locale-independent', () => {
  it('pins the exact persisted string', () => {
    // This is stored audit data, not UI copy: it is written once and rendered
    // verbatim forever. Changing it silently rewrites what old history MEANS,
    // so the literal is asserted rather than rebuilt from the constant.
    expect(restoreVersionMessage(7)).toBe('Restored from v7');
  });
});

describe('isBodyChange — only the body bumps the version', () => {
  const existing = { body: 'original' };

  it('is true when the body actually differs', () => {
    expect(isBodyChange(existing, { body: 'changed' })).toBe(true);
  });

  it('is false when the body is resubmitted unchanged', () => {
    expect(isBodyChange(existing, { body: 'original' })).toBe(false);
  });

  it('is false for a metadata-only patch (no body key at all)', () => {
    expect(isBodyChange(existing, {})).toBe(false);
  });

  it('is true for an empty-string body — that is a real edit, not "absent"', () => {
    expect(isBodyChange(existing, { body: '' })).toBe(true);
  });
});

describe('deriveSkillName', () => {
  it('takes the first H1 and slugifies it', () => {
    expect(deriveSkillName('# Uncovered Branch Gate\n\ntext')).toBe('uncovered-branch-gate');
  });

  it('ignores H2 and deeper — those are sections, not the title', () => {
    expect(deriveSkillName('## Section\n\ntext')).toBeUndefined();
  });

  it('ignores a hash with no space (not a CommonMark heading)', () => {
    expect(deriveSkillName('#hashtag\n\ntext')).toBeUndefined();
  });

  it('handles a closed ATX heading', () => {
    expect(deriveSkillName('# Title #\n')).toBe('title');
  });

  it('finds an H1 that is not on the first line', () => {
    expect(deriveSkillName('intro para\n\n# Real Title\n')).toBe('real-title');
  });

  it('returns undefined for an empty body', () => {
    expect(deriveSkillName('')).toBeUndefined();
  });

  it('returns undefined when the H1 slugifies to nothing', () => {
    expect(deriveSkillName('# !!! ???\n')).toBeUndefined();
  });
});

describe('slugifySkillName', () => {
  it('strips accents rather than turning them into hyphens', () => {
    expect(slugifySkillName('Café Rules')).toBe('cafe-rules');
  });

  it('collapses punctuation and trims stray hyphens', () => {
    expect(slugifySkillName('  No then-chains!!  ')).toBe('no-then-chains');
  });

  it('truncates without leaving a trailing hyphen', () => {
    const out = slugifySkillName('a'.repeat(80));
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('-')).toBe(false);
  });
});

describe('resolveSkillName', () => {
  it('prefers an explicit name', () => {
    expect(resolveSkillName('explicit', '# Derived')).toBe('explicit');
  });

  it('falls back to the H1 when the explicit name is blank', () => {
    expect(resolveSkillName('   ', '# Derived Title')).toBe('derived-title');
  });

  it('never returns an empty string — the column is NOT NULL', () => {
    expect(resolveSkillName(undefined, 'no heading here')).toBe('untitled-skill');
  });
});

describe('selectSkillBodies — what actually reaches the prompt', () => {
  const link = (name: string, body: string, enabled: boolean, order: number) => ({
    skill: { name, body, enabled },
    order,
  });

  it('returns [] for no links, so the prompt section is omitted entirely', () => {
    expect(selectSkillBodies([])).toEqual([]);
  });

  it('drops globally disabled skills — skills.enabled is the gate', () => {
    const bodies = selectSkillBodies([
      link('a', 'A', true, 0),
      link('b', 'B', false, 1),
      link('c', 'C', true, 2),
    ]);
    expect(bodies).toEqual(['A', 'C']);
  });

  it('preserves the given order — link order is prompt order', () => {
    // Callers pass rows already sorted by agent_skills.order ASC; this must not
    // re-sort or reverse them.
    expect(selectSkillBodies([link('x', 'X', true, 0), link('y', 'Y', true, 1)])).toEqual([
      'X',
      'Y',
    ]);
  });

  it('returns [] when every linked skill is disabled', () => {
    expect(selectSkillBodies([link('a', 'A', false, 0)])).toEqual([]);
  });
});
