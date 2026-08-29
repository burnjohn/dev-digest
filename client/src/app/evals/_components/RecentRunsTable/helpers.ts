/* RecentRunsTable/helpers.ts — the cross-agent runs feed, built entirely on
   the client.

   There is no workspace-wide batch endpoint: `GET /evals/batches` requires an
   `owner_id`, and `GET /evals/dashboard` is the only call that returns rows
   for every enabled agent at once. It already carries each agent's complete
   `recent_batches`, so the feed is a flatten + sort + slice over data the page
   has fetched anyway — no second request. */
import type { Agent, EvalBatchRecord, EvalOwnerDashboard } from "@devdigest/shared";

/** One batch, tagged with the agent it belongs to. `EvalBatchRecord` carries
    `owner_id` but no owner NAME, so the name is joined in here rather than
    re-looked-up per cell. */
export interface RecentRunRow {
  batch: EvalBatchRecord;
  agentId: string;
  agentName: string;
}

export interface JoinedAgentRow {
  row: EvalOwnerDashboard;
  agent: Agent;
}

/**
 * Newest first across ALL agents, capped at `limit`.
 *
 * Takes the already-joined `{row, agent}` pairs rather than the raw dashboard
 * response on purpose: `EvalDashboardView` drops any dashboard row whose agent
 * is missing from `useAgents()`, and a run must not outlive the agent row it
 * links to. Feeding this the raw response would resurrect exactly those.
 *
 * Ordering mirrors the server's own (`repository.ts` `listBatchHistory`):
 * `started_at` desc, `id` desc breaking a tie. Timestamps are ISO-8601 UTC
 * strings, so `localeCompare` orders them correctly without parsing a Date.
 */
export function flattenRecentRuns(rows: JoinedAgentRow[], limit: number): RecentRunRow[] {
  const all: RecentRunRow[] = [];
  for (const { row, agent } of rows) {
    for (const batch of row.recent_batches) {
      all.push({ batch, agentId: agent.id, agentName: agent.name });
    }
  }
  all.sort(
    (a, b) =>
      b.batch.started_at.localeCompare(a.batch.started_at) || b.batch.id.localeCompare(a.batch.id),
  );
  return all.slice(0, Math.max(0, limit));
}
