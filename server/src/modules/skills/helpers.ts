import type { Skill, SkillType, SkillSource, SkillVersion, ImportPreview } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';

const MAX_UPLOAD_BYTES = 512 * 1024;

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
    evidence_files: (row.evidenceFiles as string[] | null) ?? null,
  };
}

export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

/** Estimate rough token count — ~1.3 tokens per word is accurate enough for display. */
function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

/** Infer SkillType from body content heuristic. */
function detectType(content: string): SkillType {
  const lower = content.toLowerCase();
  if (lower.includes('security') || lower.includes('vulnerability') || lower.includes('injection') || lower.includes('secret') || lower.includes('xss')) {
    return 'security';
  }
  if (lower.includes('convention') || lower.includes('naming') || lower.includes('style guide') || lower.includes('format')) {
    return 'convention';
  }
  if (lower.includes('rubric') || lower.includes('dimension') || lower.includes('quality') || lower.includes('correctness') || lower.includes('criteria')) {
    return 'rubric';
  }
  return 'custom';
}

/** Extract a skill name from the first `# Heading` in the body, or fall back to filename stem. */
function extractName(content: string, fallback: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match?.[1]) return match[1].trim().slice(0, 80);
  return fallback.replace(/\.(md|txt)$/i, '').replace(/[-_]/g, ' ').slice(0, 80) || 'Imported Skill';
}

/**
 * Parse a raw Markdown upload into an ImportPreview.
 * rawName: user-supplied override name (may be empty).
 * filename: the original filename (used for name inference).
 * content: decoded text content.
 */
export function previewMarkdown(rawName: string, filename: string, content: string): ImportPreview {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_UPLOAD_BYTES) {
    throw new Error(`Skill body exceeds ${MAX_UPLOAD_BYTES / 1024} KB limit`);
  }
  const name = rawName.trim() || extractName(content, filename);
  return {
    name,
    type: detectType(content),
    body: content,
    token_estimate: estimateTokens(content),
    source_file: filename,
    ignored_files: [],
  };
}
