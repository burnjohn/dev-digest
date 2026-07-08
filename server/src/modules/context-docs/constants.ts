/**
 * context-docs module constants.
 */

/**
 * Default root folders (relative to the repo clone) that discovery walks when
 * a repo has no explicit `context_folders` configured (AC-2).
 */
export const DEFAULT_CONTEXT_FOLDERS = ['specs', 'docs', 'insights'] as const;

/**
 * Upper bound on an overlay document's body length (chars). A markdown context
 * document has no legitimate reason to exceed this; the cap guards `doc_overrides`
 * (and the injected prompt) against a pathological paste/upload — defense in
 * depth on the upload/edit endpoint (§4 v2, security skill A08).
 */
export const MAX_OVERLAY_BODY_CHARS = 2_000_000;
