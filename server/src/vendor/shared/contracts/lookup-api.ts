import { z } from 'zod';
import { PrStatus } from './platform.js';

/**
 * Lookup API — the human-coordinates→internal-id boundary.
 *
 * DevDigest's REST routes are keyed by internal uuids (`repo_id`, `pull_id`);
 * an MCP client only knows human coordinates (a repo's `full_name`, a PR
 * `number`). `PullLookupResult` is what `GET` on the lookup route returns to
 * resolve one into the other. On failure `{ok:false}` carries `candidates` —
 * the near matches found while resolving — so the caller can render a next
 * step (principle 4, docs/plans/05-mcp-server.md §4) without a second request.
 */

export const PullLookup = z.object({
  repo_id: z.string(),
  pull_id: z.string(),
  number: z.number().int(),
  full_name: z.string(),
  head_sha: z.string(),
  title: z.string(),
  status: PrStatus,
});
export type PullLookup = z.infer<typeof PullLookup>;

export const PullLookupResult = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    pull: PullLookup,
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(['repo_not_found', 'pull_not_found']),
    message: z.string(),
    candidates: z.array(z.string()),
  }),
]);
export type PullLookupResult = z.infer<typeof PullLookupResult>;
