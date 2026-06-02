import { z } from 'zod';

/**
 * A1 — conventions module constants (extracted from service.ts; no behaviour
 * change). Schemas, prompts, and tunables for the extraction flow.
 */

/** LLM output schema for a single extracted convention candidate. */
export const ExtractionItem = z.object({
  rule: z.string().describe('A concise house-rule the codebase follows, phrased as a guideline.'),
  evidence_path: z.string().describe('Repo-relative path of a file demonstrating the rule.'),
  evidence_snippet: z.string().describe('A short verbatim snippet from that file as evidence.'),
  confidence: z.number().min(0).max(1),
});

/** LLM output schema for one structured extraction call. */
export const Extraction = z.object({ conventions: z.array(ExtractionItem).max(12) });
export type Extraction = z.infer<typeof Extraction>;

/** System prompt for the convention extractor. */
export const EXTRACTOR_SYSTEM =
  'You are a senior engineer extracting the implicit house-rules / conventions a ' +
  'codebase follows (naming, error handling, structure, testing, API shape). ' +
  'Return ONLY conventions you can back with a concrete file + snippet from the ' +
  'provided code. Each convention needs evidence_path, a short verbatim ' +
  'evidence_snippet copied from that file, and a confidence 0..1.';

/** Name passed to the structured-output call. */
export const EXTRACTION_SCHEMA_NAME = 'ConventionExtraction';

/** Max files to sample from a repo per extraction. */
export const MAX_SAMPLE_FILES = 8;

/** Max bytes read per sampled file. */
export const MAX_FILE_BYTES = 4000;

/** Grep pattern used to find candidate source files when symbols are sparse. */
export const SAMPLE_GREP_PATTERN = '(function|class|export|def )';

/** Confidence ceiling applied when an evidence snippet can't be grounded. */
export const UNGROUNDED_CONFIDENCE_CEILING = 0.5;

/** Structured-call tuning. */
export const EXTRACTION_TEMPERATURE = 0;
export const EXTRACTION_MAX_RETRIES = 2;

/** Default models per provider (used when the provider lists none). */
export const DEFAULT_MODEL: Record<'openai' | 'anthropic', string> = {
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-3-5-sonnet',
};

/** Max length of the skill name derived from an accepted convention's rule. */
export const ACCEPTED_SKILL_NAME_MAX_LEN = 80;
