/**
 * A1 — memory module constants (extracted from service/repository; no behaviour
 * change).
 */

/** Default confidence applied to a created memory when none is supplied. */
export const DEFAULT_CONFIDENCE = 0.7;

/** Default confidence for a memory learned from a review finding. */
export const LEARNING_CONFIDENCE = 0.8;

/** Default provenance note for a memory learned from a finding. */
export const LEARNING_DEFAULT_CONTEXT = 'Learned from a review finding';

/** Default top-k for cosine similarity retrieval. */
export const DEFAULT_TOP_K = 5;

/** Days after which a memory is considered stale (freshness filter default). */
export const DEFAULT_STALE_DAYS = 60;
