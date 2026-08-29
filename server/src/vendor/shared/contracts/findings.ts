import { z } from 'zod';

/**
 * Review / Findings contracts.
 * These Zod schemas are the single source of truth for:
 *  - API request/response validation,
 *  - LLM structured output (`response_format` / forced tool-use),
 *  - shared web↔api types.
 */

export const Severity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export type Severity = z.infer<typeof Severity>;

export const FindingCategory = z.enum(['bug', 'security', 'perf', 'style', 'test']);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const FindingKind = z.enum([
  'finding',
  'secret_leak',
  'lethal_trifecta',
  'phantom',
  'hook',
]);
export type FindingKind = z.infer<typeof FindingKind>;

export const Verdict = z.enum(['request_changes', 'approve', 'comment']);
export type Verdict = z.infer<typeof Verdict>;

export const TrifectaComponent = z.enum([
  'private_data_access',
  'untrusted_input',
  'exfil_path',
]);
export type TrifectaComponent = z.infer<typeof TrifectaComponent>;

export const TrifectaEvidence = z.object({
  component: TrifectaComponent,
  file: z.string(),
  line: z.number().int(),
});
export type TrifectaEvidence = z.infer<typeof TrifectaEvidence>;

/**
 * Finding — the atomic review unit. `start_line`/`end_line` are used by the
 * citation-grounding gate (must intersect a real diff hunk for diff-findings).
 *
 * The line bounds are a safety limit, not a style choice: these values come from
 * untrusted model output, and any consumer that walks the claimed range pays for
 * an absurd one. `strict` JSON-schema mode constrains the TYPE, never the magnitude.
 */
const MAX_LINE = 1_000_000;

export const Finding = z.object({
  id: z.string(),
  severity: Severity,
  category: FindingCategory,
  title: z.string(),
  file: z.string(),
  start_line: z.number().int().min(0).max(MAX_LINE),
  end_line: z.number().int().min(0).max(MAX_LINE),
  rationale: z.string(), // markdown
  suggestion: z.string().nullish(), // markdown
  confidence: z.number().min(0).max(1),
  kind: FindingKind.nullish(),
  // Lethal-trifecta variant fields (present only when kind === 'lethal_trifecta')
  trifecta_components: z.array(TrifectaComponent).nullish(),
  evidence: z.array(TrifectaEvidence).nullish(),
});
export type Finding = z.infer<typeof Finding>;

/** Review — the consolidated structured output of a single agent run. */
export const Review = z.object({
  verdict: Verdict,
  summary: z.string(),
  score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      'Overall PR quality from 0 to 100, where HIGHER is better. 90–100 = no or only trivial issues (approve); 60–89 = minor suggestions; 30–59 = warnings worth addressing; 0–29 = critical problems. Must be consistent with `findings`: if there are no findings, the score is 90 or above.',
    ),
  // NOT capped with `.max()` on purpose: this schema is sent to the provider with
  // `strict: true`, and a `.max()` here emits `maxItems`, which not every strict
  // implementation accepts — unlike the `minimum`/`maximum` already emitted by
  // `score` and `confidence`. Cap the count at the call site if it ever matters;
  // per-finding cost is already bounded by the diff (see grounding.ts).
  findings: z.array(Finding),
});
export type Review = z.infer<typeof Review>;

/**
 * Action taken on a finding (accept/dismiss/learn/reply/revert).
 * `revert` undoes a decision: it clears BOTH `accepted_at` and `dismissed_at`,
 * returning the finding to undecided. It is the only way out of a decision —
 * the UI disables the opposite action while one stands, so accept -> revert ->
 * dismiss is the path, never accept -> dismiss directly.
 */
export const FindingActionKind = z.enum(['accept', 'dismiss', 'learn', 'reply', 'revert']);
export type FindingActionKind = z.infer<typeof FindingActionKind>;

export const FindingAction = z.object({
  action: FindingActionKind,
  reply: z.string().optional(),
});
export type FindingAction = z.infer<typeof FindingAction>;
