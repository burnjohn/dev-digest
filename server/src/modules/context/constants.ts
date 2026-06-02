/**
 * A3 — Project Context indexer constants (extracted from service.ts; no behaviour change).
 */
import { join } from 'node:path';

/** JobRunner job name for spec indexing. */
export const SPEC_INDEX_JOB = 'spec_index';

/** Subdirectory (under the clone) that holds indexable spec files. */
export const SPECS_SUBDIR = join('.devdigest', 'specs');

/** Required prefix (posix) + extension for a valid spec path. */
export const SPEC_PATH_PREFIX = '.devdigest/specs/';
export const SPEC_PATH_EXT = '.md';

/** Heading-aware chunker cap (chars per chunk). */
export const CHUNK_MAX_CHARS = 1200;

/** Progress phase boundaries (percentages) for the reindex lifecycle. */
export const PCT_READING = 5;
export const PARSING_BASE_PCT = 10;
export const PARSING_SPAN_PCT = 40; // 10 → 50
export const EMBEDDING_BASE_PCT = 50;
export const EMBEDDING_SPAN_PCT = 45; // 50 → 95
