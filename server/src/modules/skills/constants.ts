/** Constants for the skills module. */

/** Initial body version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/** Default type when a create/import doesn't classify the skill. */
export const DEFAULT_SKILL_TYPE = 'custom' as const;

/** Default source when a create doesn't state provenance. */
export const DEFAULT_SKILL_SOURCE = 'manual' as const;

/**
 * Fallback name for an imported skill with no usable heading and no filename to
 * fall back on. Deliberately obvious — an untitled skill in the list is a prompt
 * to rename it, not something to leave.
 */
export const UNTITLED_SKILL_NAME = 'untitled-skill';

/** Default lookback window for the Stats tab and the list-card footer. */
export const DEFAULT_STATS_WINDOW_DAYS = 30;
