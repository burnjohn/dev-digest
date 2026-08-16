import type { Skill, SkillListItem, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import { FALLBACK_SKILL_NAME, MAX_DERIVED_NAME_CHARS } from './constants.js';

/**
 * Pure helpers for the skills module — row ⇄ DTO mapping, the version-bump
 * predicate, and name derivation. No I/O, no container: everything here is
 * hermetically testable.
 */

/** Map a persisted skill row to the public `Skill` DTO (snake_case on the wire). */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/**
 * `Skill` + the number of agents linking it. `usedBy` is computed by the
 * repository's join, not fetched here — this stays pure.
 */
export function toSkillListItemDto(row: SkillRow, usedBy: number): SkillListItem {
  return { ...toSkillDto(row), used_by: usedBy };
}

/** Map a `skill_versions` row to the public DTO. `created_at` is ISO-8601. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * True when a patch actually changes the body — the ONLY thing that bumps the
 * version and writes a new `skill_versions` snapshot.
 *
 * Renaming, re-typing, editing the description or toggling `enabled` deliberately
 * do NOT: a version is a snapshot of the text sent to the model, so bumping it for
 * a rename would make the version history lie about what the agent actually saw.
 * An absent `body` (a metadata-only patch) is not a change.
 */
export function isBodyChange(existing: Pick<SkillRow, 'body'>, patch: { body?: string }): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}

/**
 * Derive a skill name from its markdown body: the first `# H1`, slugified.
 * Returns `undefined` when there is no H1, so the caller can decide between a
 * user-supplied name and `FALLBACK_SKILL_NAME`.
 *
 * Only `# ` (level 1) counts — an `## H2` is a section inside the skill, not its
 * title. `#hashtag` (no space) is not a heading in CommonMark and is ignored.
 */
export function deriveSkillName(body: string): string | undefined {
  const match = body.match(/^[ \t]{0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*$/m);
  if (!match?.[1]) return undefined;
  const slug = slugifySkillName(match[1]);
  return slug || undefined;
}

/**
 * Lowercase, hyphenated, ASCII-ish. Keeps names readable inside the assembled
 * prompt and safe in a URL, without pulling in a slug dependency.
 */
export function slugifySkillName(raw: string): string {
  return raw
    .normalize('NFKD') // "é" → "e" + combining acute, so the mark can be dropped
    .replace(/\p{M}/gu, '') // strip combining marks (else they'd become hyphens below)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_DERIVED_NAME_CHARS)
    .replace(/-+$/g, '');
}

/**
 * The name to persist, given an explicit name and a body. Explicit wins; then a
 * derived `# H1`; then the fallback. Never returns an empty string, because
 * `skills.name` is `NOT NULL` and an empty card is unclickable.
 */
export function resolveSkillName(explicit: string | undefined, body: string): string {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  return deriveSkillName(body) ?? FALLBACK_SKILL_NAME;
}
