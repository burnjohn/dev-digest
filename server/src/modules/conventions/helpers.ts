import type { ConventionCandidate } from '@devdigest/shared';
import type { ConventionRow } from './repository.js';
import { UNGROUNDED_CONFIDENCE_CEILING } from './constants.js';

/**
 * A1 — conventions pure helpers (extracted from service.ts; no behaviour change).
 */

export interface GroundedItem {
  rule: string;
  evidence_path: string;
  evidence_snippet: string;
  confidence: number;
}

/**
 * Keep a candidate only if its evidence_path was actually sampled. If the
 * snippet is not found verbatim in that file, we down-rank confidence rather
 * than drop it (the model may have lightly normalized whitespace).
 */
export function groundEvidence(
  c: { rule: string; evidence_path: string; evidence_snippet: string; confidence: number },
  byPath: Map<string, string>,
): GroundedItem | null {
  const content = byPath.get(c.evidence_path);
  if (content === undefined) return null; // hallucinated path → drop
  const normalized = content.replace(/\s+/g, ' ');
  const snippetNorm = c.evidence_snippet.replace(/\s+/g, ' ').trim();
  const found = snippetNorm.length > 0 && normalized.includes(snippetNorm);
  return {
    rule: c.rule,
    evidence_path: c.evidence_path,
    evidence_snippet: c.evidence_snippet,
    confidence: found ? c.confidence : Math.min(c.confidence, UNGROUNDED_CONFIDENCE_CEILING),
  };
}

/** Build the Markdown body for the Skill created from an accepted convention. */
export function conventionSkillBody(
  rule: string,
  evidencePath: string | null,
  evidenceSnippet: string | null,
): string {
  return `# Convention\n\n${rule}\n\n## Evidence\n\n\`${evidencePath}\`\n\n\`\`\`\n${evidenceSnippet}\n\`\`\``;
}

/** Map a persisted convention row to the §6 ConventionCandidate DTO. */
export function toCandidate(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    accepted: row.accepted,
  };
}
