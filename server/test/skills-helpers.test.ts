import { describe, it, expect } from 'vitest';
import {
  coerceSkillType,
  firstHeading,
  firstParagraph,
  isExecutableLooking,
  isSkillConfigChange,
  nameFromFilename,
  parseFrontmatter,
  parseSkillMarkdown,
  pickSkillCore,
} from '../src/modules/skills/helpers.js';
import { toSkillPromptBlock } from '../src/modules/reviews/helpers.js';

/**
 * Pure parsing + version rules for skills. Hermetic: the archive is already
 * decompressed by the time these functions see it, so nothing here needs Docker.
 */

describe('parseFrontmatter', () => {
  it('reads flat key: value pairs and strips the block from the body', () => {
    const { attrs, body } = parseFrontmatter(
      '---\nname: no-then-chains\ntype: convention\n---\n# Rule\nUse async/await.',
    );
    expect(attrs).toEqual({ name: 'no-then-chains', type: 'convention' });
    expect(body).toBe('# Rule\nUse async/await.');
  });

  it('strips surrounding quotes from a value', () => {
    const { attrs } = parseFrontmatter('---\nname: "quoted name"\n---\nbody');
    expect(attrs.name).toBe('quoted name');
  });

  it('leaves a document without frontmatter untouched', () => {
    const { attrs, body } = parseFrontmatter('# Just markdown\ntext');
    expect(attrs).toEqual({});
    expect(body).toBe('# Just markdown\ntext');
  });

  it('does not treat a horizontal rule mid-document as frontmatter', () => {
    const { attrs, body } = parseFrontmatter('# Title\n\n---\n\nAfter the rule');
    expect(attrs).toEqual({});
    expect(body).toContain('# Title');
  });

  it('skips nested/list lines rather than guessing at YAML', () => {
    const { attrs } = parseFrontmatter('---\nname: x\ntags:\n  - a\n  - b\n---\nbody');
    expect(attrs).toEqual({ name: 'x', tags: '' });
  });

  it('handles CRLF line endings and a leading BOM', () => {
    const { attrs, body } = parseFrontmatter('﻿---\r\nname: crlf\r\n---\r\n# Body');
    expect(attrs.name).toBe('crlf');
    expect(body).toBe('# Body');
  });
});

describe('parseSkillMarkdown', () => {
  it('prefers frontmatter over derived values', () => {
    const parsed = parseSkillMarkdown('whatever.md', [
      '---',
      'name: declared-name',
      'description: Declared description.',
      'type: security',
      '---',
      '# Heading name',
      '',
      'Paragraph description.',
    ].join('\n'));
    expect(parsed).toMatchObject({
      name: 'declared-name',
      description: 'Declared description.',
      type: 'security',
    });
  });

  it('falls back to the first heading and paragraph', () => {
    const parsed = parseSkillMarkdown('some/path/file.md', '# Heading name\n\nThe description.');
    expect(parsed.name).toBe('Heading name');
    expect(parsed.description).toBe('The description.');
    expect(parsed.type).toBe('custom');
  });

  it('falls back to the filename when the body has no heading', () => {
    const parsed = parseSkillMarkdown('skills/no-then-chains.md', 'Just prose, no heading.');
    expect(parsed.name).toBe('no-then-chains');
    expect(parsed.description).toBe('Just prose, no heading.');
  });

  it('coerces an unknown type to custom rather than failing the import', () => {
    const parsed = parseSkillMarkdown('x.md', '---\ntype: nonsense\n---\n# X');
    expect(parsed.type).toBe('custom');
  });
});

describe('firstHeading / firstParagraph / nameFromFilename / coerceSkillType', () => {
  it('firstHeading ignores prose and takes the first heading', () => {
    expect(firstHeading('prose\n\n## Second level\ntext')).toBe('Second level');
    expect(firstHeading('no heading at all')).toBeUndefined();
  });

  it('firstParagraph skips headings and collapses whitespace', () => {
    expect(firstParagraph('# Title\n\nA   wrapped\nparagraph.')).toBe('A wrapped paragraph.');
  });

  it('nameFromFilename strips the path and the extension', () => {
    expect(nameFromFilename('a/b/c/my-skill.md')).toBe('my-skill');
    expect(nameFromFilename('bundle.zip')).toBe('bundle');
  });

  it('coerceSkillType accepts the enum case-insensitively', () => {
    expect(coerceSkillType('Rubric')).toBe('rubric');
    expect(coerceSkillType(undefined)).toBe('custom');
  });
});

describe('pickSkillCore', () => {
  it('prefers SKILL.md over anything else', () => {
    expect(pickSkillCore(['docs/README.md', 'SKILL.md', 'notes.md'])).toBe('SKILL.md');
  });

  it('falls back to README.md, then to the shallowest markdown', () => {
    expect(pickSkillCore(['deep/a.md', 'README.md'])).toBe('README.md');
    expect(pickSkillCore(['deep/nested/a.md', 'top.md'])).toBe('top.md');
  });

  it('breaks ties deterministically by path then name', () => {
    expect(pickSkillCore(['b.md', 'a.md'])).toBe('a.md');
  });

  it('returns undefined when the archive holds no markdown at all', () => {
    expect(pickSkillCore(['run.sh', 'index.js', 'logo.png'])).toBeUndefined();
  });

  it('matches the preferred names case-insensitively', () => {
    expect(pickSkillCore(['docs/x.md', 'skill.md'])).toBe('skill.md');
  });
});

describe('isExecutableLooking', () => {
  it('flags scripts and binaries, not documents or data', () => {
    expect(isExecutableLooking('install.sh')).toBe(true);
    expect(isExecutableLooking('src/index.ts')).toBe(true);
    expect(isExecutableLooking('bin/tool.exe')).toBe(true);
    expect(isExecutableLooking('notes.md')).toBe(false);
    expect(isExecutableLooking('config.json')).toBe(false);
  });
});

describe('isSkillConfigChange', () => {
  const existing = {
    name: 'a',
    description: 'b',
    type: 'rubric' as const,
    body: 'c',
  };

  it('is true when content changes', () => {
    expect(isSkillConfigChange(existing, { body: 'new' })).toBe(true);
    expect(isSkillConfigChange(existing, { name: 'other' })).toBe(true);
    expect(isSkillConfigChange(existing, { type: 'security' })).toBe(true);
  });

  it('is false when a field is re-submitted unchanged', () => {
    expect(isSkillConfigChange(existing, { name: 'a', description: 'b', body: 'c' })).toBe(false);
  });

  it('is false for an enabled-only toggle — that must not bump the version', () => {
    expect(isSkillConfigChange(existing, {})).toBe(false);
  });
});

describe('toSkillPromptBlock', () => {
  it('renders a named block and trims the body', () => {
    expect(toSkillPromptBlock({ name: 'no-then-chains', body: '\nUse async/await.\n' })).toBe(
      '### no-then-chains\nUse async/await.',
    );
  });
});
