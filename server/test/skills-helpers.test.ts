import { describe, it, expect } from 'vitest';
import {
  deriveSkillName,
  isBodyChange,
  resolveSkillName,
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
  it('serializes created_at as ISO-8601', () => {
    const v: SkillVersionRow = {
      skillId: 'sk1',
      version: 2,
      body: 'b',
      createdAt: new Date('2026-08-16T10:00:00.000Z'),
    };
    expect(toSkillVersionDto(v)).toEqual({
      skill_id: 'sk1',
      version: 2,
      body: 'b',
      created_at: '2026-08-16T10:00:00.000Z',
    });
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
