import { z } from 'zod';

/**
 * `get_blast_radius(repo, pr)` (ring M0) — the stub's request/response
 * shapes. Per decision D8 (plan 05 §5.8) the "success" branch never fires:
 * the handler in `tools/get-blast-radius.ts` always returns `isError: true`,
 * but `outputSchema` still needs a real shape for `structuredContent` to
 * validate against — `{implemented, retry, reason, use_instead}` is that
 * shape, copied from §5.8 verbatim.
 *
 * Flat primitives only (REQ-9, principle 2) — `repo` and `pr` are the same
 * two arguments every other tool takes, kept independent of `ports.ts`'s
 * `ApiPort` on purpose: this stub holds no port at all (REQ-21).
 */

export const GetBlastRadiusInput = {
  repo: z.string().min(1).describe('"owner/name" of the imported repo'),
  pr: z.number().int().positive().describe('the pull request number'),
};

export const GetBlastRadiusOutput = {
  /** Always `false` — a stub that could ever report `true` would be a lie. */
  implemented: z.literal(false),
  /** Always `false` — retrying teaches nothing; D8 is why this stays put. */
  retry: z.literal(false),
  reason: z.string(),
  use_instead: z.string(),
};

export type GetBlastRadiusInputArgs = z.infer<z.ZodObject<typeof GetBlastRadiusInput>>;
export type GetBlastRadiusOutputResult = z.infer<z.ZodObject<typeof GetBlastRadiusOutput>>;
