import type { Skill, SkillType, SkillVersion } from '@devdigest/shared';
import { SkillType as SkillTypeSchema } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import {
  DEFAULT_SKILL_DESCRIPTION,
  DEFAULT_SKILL_TYPE,
  DERIVED_DESCRIPTION_MAX_CHARS,
  EXECUTABLE_EXTENSIONS,
  SKILL_CORE_NAMES,
} from './constants.js';

/**
 * Pure helpers for the skills module — row ⇄ DTO mapping, the version-bump
 * rule, and markdown/archive parsing for import. No I/O: the archive is handed
 * in already decompressed, so everything here is unit-testable without Docker.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/** Map a `skill_versions` row to the public `SkillVersion` DTO. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    message: row.message,
    created_at: row.createdAt.toISOString(),
  };
}

/** Fields whose change bumps a skill's version (everything but `enabled`). */
export interface SkillConfigChangePatch {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
}

/**
 * True when a patch changes the skill's content (vs. just toggling `enabled`).
 * A content change bumps `skills.version` and snapshots `skill_versions`, so an
 * agent run can later be tied back to the exact text that shaped its prompt.
 */
export function isSkillConfigChange(
  existing: Pick<SkillRow, 'name' | 'description' | 'type' | 'body'>,
  patch: SkillConfigChangePatch,
): boolean {
  return (
    (patch.name !== undefined && patch.name !== existing.name) ||
    (patch.description !== undefined && patch.description !== existing.description) ||
    (patch.type !== undefined && patch.type !== existing.type) ||
    (patch.body !== undefined && patch.body !== existing.body)
  );
}

// Rendering a skill into a prompt block lives in the review pipeline
// (`modules/reviews/helpers.ts`), not here — this module owns storage.

// ---- Import parsing ------------------------------------------------------

/** Flat `key: value` frontmatter. No YAML dependency: skills declare scalars. */
export function parseFrontmatter(text: string): {
  attrs: Record<string, string>;
  body: string;
} {
  // Strip a leading BOM: a literal one is invisible in this source and would
  // defeat the `^---` match on a file saved by a Windows editor.
  const normalized = text.replace(/^\uFEFF/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(normalized);
  if (!match) return { attrs: {}, body: normalized };

  const attrs: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const sep = line.indexOf(':');
    // A line without a colon (or a nested YAML mapping) is skipped rather than
    // guessed at — a skill's frontmatter is flat by construction.
    if (sep <= 0 || line.startsWith(' ') || line.startsWith('-')) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line
      .slice(sep + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) attrs[key] = value;
  }
  return { attrs, body: normalized.slice(match[0].length) };
}

/** First `# heading` in a markdown body, if any. */
export function firstHeading(body: string): string | undefined {
  const m = /^#{1,3}\s+(.+)$/m.exec(body);
  return m?.[1]?.trim();
}

/** First non-heading, non-empty paragraph — used as a fallback description. */
export function firstParagraph(body: string): string | undefined {
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const text = block.trim();
    if (!text || text.startsWith('#') || text.startsWith('---')) continue;
    return text.replace(/\s+/g, ' ').slice(0, DERIVED_DESCRIPTION_MAX_CHARS);
  }
  return undefined;
}

/** Strip a path + extension down to a usable skill name. */
export function nameFromFilename(filename: string): string {
  const base = filename.split('/').pop() ?? filename;
  return base.replace(/\.(md|markdown|zip)$/i, '') || 'imported-skill';
}

/** Coerce a frontmatter `type:` to a SkillType, falling back to 'custom'. */
export function coerceSkillType(raw: string | undefined): SkillType {
  const parsed = SkillTypeSchema.safeParse(raw?.trim().toLowerCase());
  return parsed.success ? parsed.data : DEFAULT_SKILL_TYPE;
}

export interface ParsedSkillMarkdown {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

/**
 * Derive a skill from one markdown document: frontmatter wins, then the first
 * heading / paragraph, then the filename. Never throws on odd input — an
 * unparseable field falls back rather than failing the whole import.
 */
export function parseSkillMarkdown(filename: string, text: string): ParsedSkillMarkdown {
  const { attrs, body } = parseFrontmatter(text);
  const trimmed = body.trim();
  return {
    name: attrs.name || firstHeading(trimmed) || nameFromFilename(filename),
    description: attrs.description || firstParagraph(trimmed) || DEFAULT_SKILL_DESCRIPTION,
    type: coerceSkillType(attrs.type),
    body: trimmed,
  };
}

/** True when an ignored archive member looks like something meant to run. */
export function isExecutableLooking(path: string): boolean {
  const lower = path.toLowerCase();
  return EXECUTABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Choose the markdown member that IS the skill: `SKILL.md`, else `README.md`,
 * else the shallowest single `.md`. Ties break on path length then alphabet, so
 * the same archive always yields the same skill.
 */
export function pickSkillCore(paths: string[]): string | undefined {
  const markdown = paths.filter((p) => /\.(md|markdown)$/i.test(p));
  if (markdown.length === 0) return undefined;

  for (const preferred of SKILL_CORE_NAMES) {
    const hit = markdown
      .filter((p) => (p.split('/').pop() ?? '').toLowerCase() === preferred)
      .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
    if (hit) return hit;
  }

  return markdown.sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  )[0];
}
