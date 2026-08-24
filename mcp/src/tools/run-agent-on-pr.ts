import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiPort } from '../ports.js';
import { resolveAgent, resolvePull, type ResolverDeps } from '../resolve/resolver.js';
import type { RepoCache } from '../resolve/cache.js';
import { budgetExhausted, runFailed } from '../resolve/messages.js';
import { projectFindings } from '../shaping/project.js';
import { RunAgentOnPrInput, RunAgentOnPrOutput } from '../schemas/findings.js';
import { decideRunAction, findActiveRun } from '../run/idempotency.js';
import { waitForRun, type RunWaiterDeps } from '../run/waiter.js';
import { registerTool } from './_register.js';

/**
 * `run_agent_on_pr(repo, pr, agent, response_format?)` (ring M4) — the one
 * write tool (REQ-12, REQ-13, REQ-14, REQ-15). The handler stays thin
 * (§5.12's own warning: "putting the poll loop inside the handler is this
 * task's version of SQL in a route handler") — resolution, the in-flight
 * decision and the wait loop all live in M2 (`resolve/**`, `run/**`); this
 * file only sequences the calls and shapes the result.
 *
 * `inputSchema`/`outputSchema` are imported from `schemas/findings.ts` (M0)
 * rather than declared here (2026-08-23 remediation, finding 3) — the same
 * move `get-findings.ts` made, so there is exactly one place that declares
 * "what a findings result looks like".
 */

/** §5.13.3, copied character for character (D-G). 780 UTF-8 bytes — asserted
 *  in `run-agent-on-pr.test.ts` and re-asserted over the whole tool list by
 *  T11's `protocol.test.ts`. Do not improve this string. */
const DESCRIPTION = [
  'Review one GitHub pull request with one DevDigest agent and return the findings. Performs the ' +
    'whole arc in a single call: resolves the pull request, attaches to a matching review already ' +
    'in flight or else starts a new run, waits for it, and returns {verdict, score, counts, findings[]}.',
  '`repo` is "owner/name", `pr` is the pull request number, `agent` is an id from `list_agents`.',
  'If the review is still running when the wait budget expires (default 90s), returns {run_id, ' +
    'status:"running", poll_with:"get_findings"} instead. That is a normal result, not a failure — ' +
    'call `get_findings` with the same `repo` and `pr` a minute later.',
  "Findings are capped at 20, most severe first. Pass `response_format:\"detailed\"` only when you " +
    "need each finding's rationale and suggested fix.",
].join('\n\n');

/**
 * `now` is named explicitly here (2026-08-23 remediation, finding 5) instead
 * of being buried inside a nested `resolver: ResolverDeps` and mined out at
 * the `RunWaiterDeps` call site — a dependency invisible at the signature is
 * a dependency nobody can test around (§5.12.3). Flattening also removes the
 * other half of that finding: `api` no longer has two independently-settable
 * references (`deps.api` and what used to be `deps.resolver.api`) — there is
 * exactly one `ApiPort` here, and the handler builds the `ResolverDeps`
 * object `resolvePull`/`resolveAgent` need locally, from these same fields.
 */
export interface RunAgentOnPrDeps {
  api: ApiPort;
  cache: RepoCache;
  /** REQ-13's wait budget, in ms — env-configured (`config.ts`), never a tool argument. */
  budgetMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** The web UI's base URL, threaded through to the `ResolverDeps` this
   *  handler builds locally (T11 remediation, 2026-08-23 — see that task's
   *  report, "Notes for the integrator"): before this fix `resolver` here
   *  had no field for `server.ts` to populate `webUiUrl` into, so a repo
   *  resolution failure through THIS tool silently fell back to the less
   *  actionable message even when `config.ts`'s `webUiUrl` was available —
   *  `get_findings`'s `GetFindingsDeps.resolver: ResolverDeps` could always
   *  receive it; this flat field is `run_agent_on_pr`'s equivalent. Optional
   *  for the same reason `ResolverDeps.webUiUrl` is: a caller that has not
   *  wired it yet still gets a valid, if less actionable, message. */
  webUiUrl?: string;
}

function summarizeCompleted(projected: { verdict: string | null; shown: number; total: number; note?: string }): string {
  const verdictText = projected.verdict ?? 'no verdict';
  const base = `Review complete — verdict: ${verdictText}. Showing ${projected.shown} of ${projected.total} findings.`;
  return projected.note ? `${base} ${projected.note}` : base;
}

export function registerRunAgentOnPr(server: McpServer, deps: RunAgentOnPrDeps): void {
  registerTool(
    server,
    'run_agent_on_pr',
    {
      title: 'Run Agent on Pull Request',
      description: DESCRIPTION,
      inputSchema: RunAgentOnPrInput,
      outputSchema: RunAgentOnPrOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      const resolver: ResolverDeps = { api: deps.api, cache: deps.cache, now: deps.now, webUiUrl: deps.webUiUrl };

      const pullResult = await resolvePull(args.repo, args.pr, resolver);
      if (!pullResult.ok) {
        return { isError: true, text: pullResult.message, structuredContent: {} };
      }

      const agentResult = await resolveAgent(args.agent, resolver);
      if (!agentResult.ok) {
        return { isError: true, text: agentResult.message, structuredContent: {} };
      }

      const { pullId } = pullResult.pull;
      const { agentId } = agentResult.agent;

      // D-H's in-flight-only idempotency (§5.5): attach to a running run for
      // THIS agent, or start a new one. There is no third branch — a
      // `done`/`failed`/`cancelled` run is never reused, whatever commit it
      // ran against.
      const activeRuns = await deps.api.listActiveRuns(pullId);
      const action = decideRunAction(activeRuns, agentId);

      let runId: string;
      if (action === 'attach') {
        // decideRunAction only returns 'attach' when a match exists.
        runId = findActiveRun(activeRuns, agentId)!.run_id;
      } else {
        const started = await deps.api.startReview(pullId, agentId);
        runId = started.runId;
      }

      const waiterDeps: RunWaiterDeps = {
        api: deps.api,
        budgetMs: deps.budgetMs,
        sleep: deps.sleep,
        now: deps.now,
      };
      const wait = await waitForRun(pullId, runId, waiterDeps);

      if (wait.outcome === 'timeout') {
        return {
          isError: false,
          text: budgetExhausted(),
          structuredContent: { run_id: runId, status: 'running' as const, poll_with: 'get_findings' as const },
        };
      }

      if (wait.outcome === 'failed' || wait.outcome === 'cancelled') {
        return {
          isError: true,
          text: runFailed(wait.runStatus.error ?? wait.outcome),
          structuredContent: { run_id: runId, status: 'failed' as const },
        };
      }

      // wait.outcome === 'done' — read the persisted review this run
      // produced (never a second review of another agent's) and project it
      // through T7's concise/detailed shaping.
      const reviews = await deps.api.listReviews(pullId);
      const ownReview = reviews.filter((review) => review.run_id === runId);
      const format = args.response_format ?? 'concise';
      const projected =
        format === 'detailed' ? projectFindings(ownReview, 'detailed') : projectFindings(ownReview, 'concise');

      return {
        isError: false,
        text: summarizeCompleted(projected),
        structuredContent: projected,
      };
    },
  );
}
