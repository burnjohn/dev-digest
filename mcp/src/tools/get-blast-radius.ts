import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool } from './_register.js';
import { GetBlastRadiusInput, GetBlastRadiusOutput } from '../schemas/blast.js';

/**
 * `get_blast_radius(repo, pr)` (ring M4) — the deliberately unimplemented
 * stub (decision D-E, plan 05 §5.8). It is registered so the tool APPEARS in
 * the tool list; wiring it to `repo-intel`'s `getBlastRadius` is the course
 * homework, not an oversight, and doing it here would remove the exercise.
 *
 * Makes NO HTTP call and holds no `ApiPort` at all (REQ-21) — there is
 * nothing in this file that could reach the network even by accident, which
 * is a stronger guarantee than "the handler happens not to call fetch".
 *
 * Returns `isError: true` rather than a successful empty result (decision
 * D8): a successful result invites the model to state the blast radius is
 * empty, which is a worse failure than a visible one. `retry: false` in the
 * structured content and "Not implemented" leading the text are what stop a
 * retry loop; the error flag is what stops the fabrication.
 */

/**
 * §5.13.6, copied character for character (D-G). 285 UTF-8 bytes, first two
 * words "Not implemented" — both are load-bearing per §5.13.7 and asserted
 * by `test/tools-blast.test.ts`. Do not improve this string.
 */
const DESCRIPTION =
  'Not implemented — this tool returns an explanation, never data. It is a registered placeholder ' +
  'for a future pull request impact map. Do not call it expecting a blast radius and do not retry ' +
  "it: use `run_agent_on_pr` for review findings, or `get_conventions` for a repository's rules.";

export function registerGetBlastRadius(server: McpServer): void {
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
    async () => ({
      isError: true,
      text: DESCRIPTION,
      structuredContent: {
        implemented: false as const,
        retry: false as const,
        reason: 'Blast radius is not wired up yet.',
        use_instead: 'get_findings',
      },
    }),
  );
}
