import { z } from 'zod';

/**
 * `get_conventions(repo)` (ring M0) — request/response shapes. Per §5.12.4's
 * named divergence, the response is a re-declared projection, never
 * `ConventionListResult` (`@devdigest/shared`'s wire shape) verbatim: no
 * `evidence_snippet`, no `signals`, no `last_scan` scan-stats block — just
 * what §5.13.5's frozen description promises, "one line per convention with
 * its status".
 *
 * `repo` is the one flat argument, "owner/name" (REQ-9, principle 2) — the
 * same shape `resolve/resolver.ts`'s `isValidRepoSlug` validates before it
 * ever reaches a URL.
 */

export const GetConventionsInput = {
  repo: z.string().min(1).describe('"owner/name" of the imported repo'),
};

/** Mirrors `@devdigest/shared`'s `ConventionStatus` values, re-declared
 *  independently rather than imported as a value (M0 may import only zod,
 *  itself, and TYPE-ONLY `@devdigest/shared` — REQ-31, `rings.test.ts`). The
 *  handler only ever returns `'accepted'` rows (§7 T9 "Do": "returns only
 *  accepted/shipped rules"), but the full enum stays here so the schema
 *  documents the real domain rather than a handler-specific narrowing. */
const ConventionStatusSchema = z.enum(['pending', 'accepted', 'rejected']);

const ConventionLineSchema = z.object({
  rule: z.string(),
  status: ConventionStatusSchema,
});

export const GetConventionsOutput = {
  conventions: z.array(ConventionLineSchema),
};

export type GetConventionsInputArgs = z.infer<z.ZodObject<typeof GetConventionsInput>>;
export type GetConventionsOutputResult = z.infer<z.ZodObject<typeof GetConventionsOutput>>;
