/** Constants for the Project Context view. */

/** Spec editor view modes. */
export type SpecMode = "preview" | "edit";
export const SPEC_MODES: readonly SpecMode[] = ["preview", "edit"];

/** Index lifecycle statuses that mean a reindex is actively running. */
export const INDEXING_STATUSES = ["parsing", "embedding", "cloning"] as const;

/** Prefix stripped from spec paths for display + bytes-per-KB divisor. */
export const SPECS_PREFIX = ".devdigest/specs/";
export const BYTES_PER_KB = 1024;
