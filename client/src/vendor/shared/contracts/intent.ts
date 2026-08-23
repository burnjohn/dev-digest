import { z } from 'zod';
import { Intent } from './brief.js';

/**
 * PR intent classification — a separate, cheap-model call that classifies *why* a
 * PR was opened, feeding the result into the main review as untrusted context
 * (see `PromptAssembly.intent` in `contracts/trace.ts`).
 *
 * `sources` is deliberately ABSENT from `IntentClassification` (the LLM
 * structured-output schema). Sources are facts the SERVER observed while
 * gathering the classifier's input — never something the model self-reports.
 * That absence is structural, not a matter of discipline: there is no field for
 * a model to lie into. `ClassifiedIntent` / `PrIntentDetail` (the persisted /
 * wire shapes) carry `sources`, computed and clamped server-side.
 *
 * `IntentSourceStatus` has five values, each with a distinct, non-interchangeable
 * meaning — collapsing any two of them loses information the intent card and the
 * confidence clamp both depend on:
 *   - `used`        — the source was read IN FULL.
 *   - `truncated`    — the source was over its per-source character budget and was
 *                       included heading-first (markdown-aware) up to that budget.
 *                       A truncated source is NEVER reported as `used`.
 *   - `skipped`      — a source that exists but was deliberately not read (e.g. a
 *                       plan/spec reference found after the aggregate character
 *                       budget for that source kind was already spent).
 *   - `missing`      — the source was not present at all (e.g. an empty PR body).
 *   - `unreachable`  — the source was referenced but could not be resolved (e.g.
 *                       a linked issue that failed to fetch, or a plan/spec
 *                       reference outside the two supported forms).
 */

// ---- Confidence ----
export const IntentConfidence = z.enum(['low', 'medium', 'high']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

// ---- Source kind / status ----
export const IntentSourceKind = z.enum([
  'pr_title',
  'pr_body',
  'linked_issue',
  'plan_or_spec',
  'file_list',
]);
export type IntentSourceKind = z.infer<typeof IntentSourceKind>;

export const IntentSourceStatus = z.enum([
  'used',
  'truncated',
  'skipped',
  'missing',
  'unreachable',
]);
export type IntentSourceStatus = z.infer<typeof IntentSourceStatus>;

export const IntentSource = z.object({
  kind: IntentSourceKind,
  ref: z.string(),
  status: IntentSourceStatus,
  /** Characters actually included in the prompt from this source — what got
   *  in, not what existed (a `truncated` source reports the smaller number). */
  chars: z.number().int(),
});
export type IntentSource = z.infer<typeof IntentSource>;

// ---- Classified intent (persisted / wire shape) ----
/** The existing `Intent` (`intent` / `in_scope` / `out_of_scope`) plus the
 *  server-observed confidence and source list. */
export const ClassifiedIntent = Intent.extend({
  confidence: IntentConfidence,
  sources: z.array(IntentSource),
});
export type ClassifiedIntent = z.infer<typeof ClassifiedIntent>;

/** GET/POST `/pulls/:id/intent` response. `PrIntentRecord` in
 *  `contracts/review-api.ts` is left alone — this is the richer, newer shape. */
export const PrIntentDetail = ClassifiedIntent.extend({
  pr_id: z.string(),
  model: z.string().nullish(),
  generated_at: z.string().nullish(),
});
export type PrIntentDetail = z.infer<typeof PrIntentDetail>;

// ---- POST /pulls/:id/intent request body ----
export const ClassifyIntentRequest = z.object({
  /** `.nullish()`, never `.default(false)` — a schema-injected default would
   *  mask a missing field; the handler's own `=== true` check is clearer. */
  force: z.boolean().nullish(),
});
export type ClassifyIntentRequest = z.infer<typeof ClassifyIntentRequest>;

// ---- LLM structured-output schema ----
/** The ONE structured-output call the classifier makes. Every field is
 *  REQUIRED — `.nullish()` is fine where a value may legitimately be absent,
 *  but `.default()` is banned here: calls go out with `strict: true`, which
 *  rejects an optional-without-being-nullable field on the real provider even
 *  though every hermetic test using `{}` as a mock fixture would still pass
 *  (`server/INSIGHTS.md`, 2026-08-17). `sources` is deliberately absent — see
 *  the file header. */
export const IntentClassification = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  confidence: IntentConfidence,
});
export type IntentClassification = z.infer<typeof IntentClassification>;
