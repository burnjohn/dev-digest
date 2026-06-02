import type { Skill, SkillType, SkillSource } from '@devdigest/shared';
import type { SkillRow } from './repository.js';
import { TYPE_PATTERNS, DEFAULT_SKILL_NAME, NAME_MAX_LEN, URL_NAME_EXT } from './constants.js';

/**
 * A1 — skills pure helpers (no behaviour change; extracted from service.ts).
 */

/** Map a persisted skill row to the §6 Skill DTO. */
export function toDto(row: SkillRow): Skill {
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

/** Heuristic: derive a skill type from its name/body for imported content. */
export function inferType(name: string, body: string): SkillType {
  const hay = `${name}\n${body}`.toLowerCase();
  if (TYPE_PATTERNS.security.test(hay)) return 'security';
  if (TYPE_PATTERNS.convention.test(hay)) return 'convention';
  if (TYPE_PATTERNS.rubric.test(hay)) return 'rubric';
  return 'custom';
}

/** First non-empty line (heading markers stripped), capped, else fallback. */
export function firstLine(body: string, fallback: string): string {
  const line = body
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0);
  return (line ?? fallback).slice(0, NAME_MAX_LEN);
}

/** Derive a skill name from a URL's last path segment (extension stripped). */
export function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? DEFAULT_SKILL_NAME;
    return last.replace(URL_NAME_EXT, '');
  } catch {
    return DEFAULT_SKILL_NAME;
  }
}
