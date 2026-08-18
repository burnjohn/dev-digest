/** Every skill starts at v1; `skill_versions` gets a matching row on insert. */
export const INITIAL_SKILL_VERSION = 1;

/** Used when a caller (notably an import) supplies no type. */
export const DEFAULT_SKILL_TYPE = 'custom' as const;

/** Used when a caller supplies no provenance. */
export const DEFAULT_SKILL_SOURCE = 'manual' as const;

/**
 * Hard cap on a skill body, enforced by the route schema.
 *
 * This is a COST control, not a storage one. `reviewer-core` assembles the prompt
 * once per chunk, so under `strategy: 'map-reduce'` every linked skill body is
 * re-sent on every file call — a 9-file PR with 4 maxed-out skills is ~288KB of
 * repeated prompt. Worse, the assembly stored in the run trace is the whole-diff
 * one, so the trace under-reports the real spend. Raising this raises that
 * multiplier; do it deliberately.
 */
export const MAX_SKILL_BODY_CHARS = 8_000;

/** Fallback when a body has no `# H1` and the caller supplied no name. */
export const FALLBACK_SKILL_NAME = 'untitled-skill';

/** Longest derived name we will slugify down to, so a runaway H1 can't fill the column. */
export const MAX_DERIVED_NAME_CHARS = 60;

/**
 * Hard cap on a version note, enforced by the route schema.
 *
 * Applied PRE-trim: the route schema is declarative (`.max(...)`, no `.trim()`
 * transform), so 200 spaces is a 200-char note that the service then normalizes
 * to NULL. Trimming first would make the cap depend on the handler running.
 */
export const MAX_VERSION_MESSAGE_CHARS = 200;

/**
 * The note stamped on a version written by `POST /skills/:id/restore`.
 *
 * This is deliberately NOT UI copy, which is the whole point of the endpoint. A
 * restore note is an audit fact — stored once, at the moment of the write, and
 * rendered verbatim forever after, like a commit message. Composing it on the
 * client from a translated string would mean the persisted history changes
 * language when the reader's locale does. Never route this through i18n.
 */
export const RESTORE_MESSAGE_PREFIX = 'Restored from v';
