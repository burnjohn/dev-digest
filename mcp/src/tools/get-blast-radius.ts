import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiPort } from '../ports.js';
import { resolvePull, type ResolverDeps } from '../resolve/resolver.js';
import { projectBlastRadius, summarizeBlastRadius } from '../shaping/blast.js';
import { GetBlastRadiusInput, GetBlastRadiusOutput } from '../schemas/blast.js';
import { registerTool } from './_register.js';

/**
 * `get_blast_radius(repo, pr)` (ring M4, REQ-17, docs/plans/06-blast-radius.md)
 * — "what else could this diff touch?", answered from `repo-intel`'s local
 * code index via `GET /pulls/:id/blast`. No LLM call on this path.
 *
 * PROVENANCE, so nobody reads this as an accidental wiring: this tool was
 * REGISTERED from day one as a deliberate stub (decision D8,
 * `docs/plans/05-mcp-server.md` §5.8) that made no HTTP call and always
 * returned `isError: true` with an `{implemented: false, retry: false, …}`
 * payload — "wiring it to repo-intel is the course homework, not an
 * oversight". The owner has now explicitly commissioned that exercise
 * (docs/plans/06-blast-radius.md, T3); this file is the result. No
 * `implemented: false` literal survives anywhere under `mcp/src/**`.
 *
 * Same shape as `get-findings.ts`: resolve the pull FIRST (so an unresolvable
 * `repo`/`pr` is reported as a resolution error, never a confusing empty
 * blast map), then one `ApiPort.getBlastRadius` call, then project the
 * result through `shaping/blast.ts` before it ever reaches `structuredContent`
 * — this file holds no shaping or capping logic itself (REQ-18).
 */

/**
 * Model-facing copy — states what the tool returns, that endpoint/cron
 * detection is heuristic (never certainty), and that the result is capped
 * and read-only. Byte count re-measured and pinned in
 * `mcp/test/tools-blast.test.ts` and `mcp/test/protocol.test.ts` — do not
 * edit this string without updating both.
 */
const DESCRIPTION = [
  "Return a heuristic map of what a pull request's changed code touches: the symbols it declares, " +
    'how many places call each one, and which HTTP endpoints or cron jobs may depend on them — built ' +
    "from a local code index, not from re-reading the diff. `repo` is \"owner/name\", `pr` is the " +
    'pull request number.',
  'Returns {status, status_reason, totals, symbols[], chips[], truncated}. `totals` counts symbols, ' +
    'callers, endpoints and crons found. `symbols` is capped at 20, most-called first, each ' +
    '{symbol, file, caller_count}. `chips` is a capped, deduplicated flat list of {label, kind} for ' +
    'endpoints and crons the index found — `truncated: true` means some rows were cut. Endpoint and ' +
    'cron detection is heuristic: false positives and negatives are expected, never certainty.',
  '`status` is "partial" or "degraded" when part of the code index is unavailable, with ' +
    '`status_reason` explaining what could not be determined. Read-only — this tool never starts a ' +
    'review or rebuilds the index.',
].join('\n\n');

export interface GetBlastRadiusDeps {
  api: ApiPort;
  resolver: ResolverDeps;
}

export function registerGetBlastRadius(server: McpServer, deps: GetBlastRadiusDeps): void {
  registerTool(
    server,
    'get_blast_radius',
    {
      title: 'Get Blast Radius',
      description: DESCRIPTION,
      inputSchema: GetBlastRadiusInput,
      outputSchema: GetBlastRadiusOutput,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const pullResult = await resolvePull(args.repo, args.pr, deps.resolver);
      if (!pullResult.ok) {
        return { isError: true, text: pullResult.message, structuredContent: {} };
      }

      const blast = await deps.api.getBlastRadius(pullResult.pull.pullId);
      const projected = projectBlastRadius(blast);

      return {
        isError: false,
        text: summarizeBlastRadius(projected),
        structuredContent: projected,
      };
    },
  );
}
