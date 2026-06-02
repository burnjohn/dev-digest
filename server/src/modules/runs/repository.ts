import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { RunTrace } from '@devdigest/shared';

/**
 * A5 — observability / runs data-access. Reads the rows A2 writes
 * (`agent_runs`, `run_traces`, `reviews`, `findings`) and owns the
 * `multi_agent_runs` table. Strictly read/aggregate over A2's domain (it does
 * NOT mutate reviews/findings — A2 owns those writes); it only INSERTs into
 * `multi_agent_runs`, which is A5's table (§10).
 *
 * NOTE on `multi_agent_runs` shape: the canonical schema (F1) only carries
 * {id, workspace_id, pr_id, ran_at}. Member runs + conflicts are therefore
 * reconstructed by querying `agent_runs WHERE pr_id = ? AND ran_at >= mar.ran_at`
 * rather than denormalised columns — no schema change required (parallel rule #2).
 */

export type AgentRunRow = typeof t.agentRuns.$inferSelect;

export class RunsRepository {
  constructor(private db: Db) {}

  // ---- PR / agent lookups (workspace-scoped) -----------------------------

  async getPull(
    workspaceId: string,
    prId: string,
  ): Promise<(typeof t.pullRequests.$inferSelect) | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async getAgent(workspaceId: string, agentId: string) {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)));
    return row;
  }

  // ---- multi_agent_runs (A5-owned table) ---------------------------------

  /** Record that a multi-agent run happened on a PR; returns its id + ran_at. */
  async createMultiAgentRun(
    workspaceId: string,
    prId: string,
  ): Promise<{ id: string; ranAt: Date }> {
    const [row] = await this.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId })
      .returning({ id: t.multiAgentRuns.id, ranAt: t.multiAgentRuns.ranAt });
    return { id: row!.id, ranAt: row!.ranAt };
  }

  async getMultiAgentRun(
    workspaceId: string,
    id: string,
  ): Promise<{ id: string; prId: string; ranAt: Date } | undefined> {
    const [row] = await this.db
      .select({
        id: t.multiAgentRuns.id,
        prId: t.multiAgentRuns.prId,
        ranAt: t.multiAgentRuns.ranAt,
      })
      .from(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.id, id)));
    return row;
  }

  async latestMultiAgentRunForPull(
    workspaceId: string,
    prId: string,
  ): Promise<{ id: string; prId: string; ranAt: Date } | undefined> {
    const [row] = await this.db
      .select({
        id: t.multiAgentRuns.id,
        prId: t.multiAgentRuns.prId,
        ranAt: t.multiAgentRuns.ranAt,
      })
      .from(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, prId)))
      .orderBy(desc(t.multiAgentRuns.ranAt))
      .limit(1);
    return row;
  }

  // ---- agent_runs (A2 writes; A5 reads/aggregates) -----------------------

  /** Agent runs for a PR at-or-after a timestamp (the multi-agent run's members). */
  async agentRunsForPullSince(prId: string, since: Date): Promise<AgentRunRow[]> {
    return this.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.prId, prId), gte(t.agentRuns.ranAt, since)))
      .orderBy(t.agentRuns.ranAt);
  }

  async agentRunsForAgent(workspaceId: string, agentId: string): Promise<AgentRunRow[]> {
    return this.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.agentId, agentId)))
      .orderBy(t.agentRuns.ranAt);
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    const [row] = await this.db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
    return row ? (row.trace as RunTrace) : undefined;
  }

  // ---- reviews + findings (read-only joins for columns/conflicts/stats) ---

  /** The latest review per agent for a PR (newest-first), with findings. */
  async reviewsForPull(
    prId: string,
  ): Promise<{ review: typeof t.reviews.$inferSelect; findings: (typeof t.findings.$inferSelect)[] }[]> {
    const reviews = await this.db
      .select()
      .from(t.reviews)
      .where(eq(t.reviews.prId, prId))
      .orderBy(desc(t.reviews.createdAt));
    if (reviews.length === 0) return [];
    const ids = reviews.map((r) => r.id);
    const findings = await this.db
      .select()
      .from(t.findings)
      .where(inArray(t.findings.reviewId, ids));
    return reviews.map((review) => ({
      review,
      findings: findings.filter((f) => f.reviewId === review.id),
    }));
  }

  /** All findings for a given agent across the workspace (for accept-rate). */
  async findingsForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<(typeof t.findings.$inferSelect)[]> {
    const rows = await this.db
      .select({ finding: t.findings })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.agentId, agentId)));
    return rows.map((r) => r.finding);
  }

  // ---- memory (read for the curator; writes go through A1 MemoryService) --

  /** Memory rows with embeddings for the curator (workspace-scoped). */
  async memoryWithEmbeddings(
    workspaceId: string,
  ): Promise<(typeof t.memory.$inferSelect)[]> {
    return this.db
      .select()
      .from(t.memory)
      .where(and(eq(t.memory.workspaceId, workspaceId), sql`${t.memory.embedding} IS NOT NULL`))
      .orderBy(t.memory.createdAt);
  }
}
