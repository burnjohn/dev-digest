import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiPort } from '../ports.js';
import { resolveAgentForRead, resolvePull, type ResolverDeps } from '../resolve/resolver.js';
import { projectFindingsByAgent, type AgentSelection, type GroupBy } from '../shaping/project.js';
import { summarizeGroupedFindings } from '../shaping/summary.js';
import { GetFindingsInput, GetFindingsOutput } from '../schemas/findings.js';
import { registerTool } from './_register.js';

/**
 * `get_findings(repo, pr, agent?, response_format?, severity?, file?,
 * all_runs?)` (ring M4) —
 * the free, read-only twin of `run_agent_on_pr` (REQ-16). Under D-H (§5.5)
 * this is the ONLY zero-cost way to re-read a verdict, which is why
 * §5.13.4's description states "never starts a review" twice. The handler
 * never calls `ApiPort.startReview` — there is no code path in this file
 * that could.
 *
 * `inputSchema`/`outputSchema` are imported from `schemas/findings.ts` (M0)
 * rather than declared here — the 2026-08-23 remediation moved both value
 * schemas out of this M4 file, matching the pattern `list-agents.ts` and
 * `get-conventions.ts` already used. `severity`/`file` narrowing is now a
 * `projectFindings` parameter (`shaping/project.ts`), not a helper in this
 * file — narrowing is shaping logic, exactly like the cap and the order.
 */

/** §5.13.4, extended for the `agent` argument and the grouped result. Byte
 *  count asserted in `get-findings.test.ts` and re-asserted over the whole
 *  tool list by T11's `protocol.test.ts` — both move together with this
 *  string, and neither is a formality: the count is what stops a "small
 *  clarification" from being absorbed silently. Do not improve this string.
 *
 *  Paragraph 1 is unchanged from D-G's approved copy, and the promise it
 *  brackets — "without starting a new one" … "never starts a review" —
 *  survives verbatim. */
const DESCRIPTION = [
  'Return the findings of a review that already ran on a pull request, without starting a new one. ' +
    'Use it to re-read a result, or to poll after `run_agent_on_pr` returned status "running".',
  '`repo` is "owner/name", `pr` is the pull request number. Narrow with `agent` — an id or name from ' +
    '`list_agents` — and with `severity` and `file`.',
  'Each agent contributes only its LATEST run by default. Pass `all_runs:true` for one group per stored ' +
    'run instead, which counts a finding once per run it appears in.',
  'Returns {agents[], counts, shown, total} — one entry per group, each with its own {agent_name, run_id, ' +
    'created_at, reviewed, verdict, score, counts, findings[]}. A group with "reviewed": false means that ' +
    'agent has no stored result here. Findings are capped at 20 across all groups, most severe first. ' +
    'This tool never starts a review — use `run_agent_on_pr` for that.',
].join('\n\n');

export interface GetFindingsDeps {
  api: ApiPort;
  resolver: ResolverDeps;
}


export function registerGetFindings(server: McpServer, deps: GetFindingsDeps): void {
  registerTool(
    server,
    'get_findings',
    {
      title: 'Get Findings',
      description: DESCRIPTION,
      inputSchema: GetFindingsInput,
      outputSchema: GetFindingsOutput,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const pullResult = await resolvePull(args.repo, args.pr, deps.resolver);
      if (!pullResult.ok) {
        return { isError: true, text: pullResult.message, structuredContent: {} };
      }

      // Resolving the agent BEFORE the reviews call keeps an unknown agent an
      // error about the agent, not a confusingly empty findings answer.
      let selection: AgentSelection | undefined;
      if (args.agent !== undefined) {
        const agentResult = await resolveAgentForRead(args.agent, deps.resolver);
        if (!agentResult.ok) {
          return { isError: true, text: agentResult.message, structuredContent: {} };
        }
        selection = { agentId: agentResult.agent.agentId, name: agentResult.agent.name };
      }

      const reviews = await deps.api.listReviews(pullResult.pull.pullId);
      const filter = { severity: args.severity, file: args.file };
      const format = args.response_format ?? 'concise';
      // `all_runs` is absent far more often than it is explicitly false, so
      // the default is expressed once, here, rather than by making the schema
      // field `.default(false)` — which under structured output silently masks
      // a genuinely missing field instead of validating its absence
      // (`server/INSIGHTS.md`, 2026-08-17; the same reasoning keeps `note` a
      // plain optional in `schemas/findings.ts`).
      const groupBy: GroupBy = args.all_runs === true ? 'run' : 'agent';
      const projected =
        format === 'detailed'
          ? projectFindingsByAgent(reviews, 'detailed', filter, selection, groupBy)
          : projectFindingsByAgent(reviews, 'concise', filter, selection, groupBy);

      return {
        isError: false,
        text: summarizeGroupedFindings(projected, groupBy),
        structuredContent: projected,
      };
    },
  );
}
