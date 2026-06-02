import type { SkillSource } from '@devdigest/shared';

/**
 * A1 — skills module constants (no behaviour change; extracted from service.ts).
 */

/** Heuristic patterns used to infer a skill's type from its name/body. */
export const TYPE_PATTERNS = {
  security: /secret|trifecta|injection|ssrf|exfil|security|vuln/,
  convention: /convention|naming|style|house rule|lint/,
  rubric: /rubric|score|grade|severity/,
} as const;

/** Fallback skill name when none can be derived. */
export const DEFAULT_SKILL_NAME = 'imported-skill';

/** Max length for a derived skill name / first-line description. */
export const NAME_MAX_LEN = 200;

/** Default source for a non-URL import. */
export const DEFAULT_IMPORT_SOURCE: SkillSource = 'manual';

/** Source assigned to URL imports. */
export const URL_IMPORT_SOURCE: SkillSource = 'imported_url';

/** Timeout (ms) for fetching a skill body from a URL. */
export const URL_FETCH_TIMEOUT_MS = 15_000;

/** Accept header sent when fetching a skill body from a URL. */
export const URL_FETCH_ACCEPT = 'text/plain, text/markdown, */*';

/** Filename extensions stripped when deriving a name from a URL. */
export const URL_NAME_EXT = /\.(md|txt|json|ya?ml)$/i;
