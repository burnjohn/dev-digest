import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Finding, Intent, RunTrace } from '@devdigest/shared';

/**
 * A2 — review data-access. The ONLY layer touching the DB for the review
 * domain. Owns `reviews`, `findings`, `pr_intent`, and persists the
 * observability rows `agent_runs` + `run_traces` (one trace doc per run, §7/§11).
 * Workspace scoping is enforced via the PR (which carries workspace_id).
 */

export type ReviewRow = typeof t.reviews.$inferSelect;
export type FindingRow = typeof t.findings.$inferSelect;
export type PullRow = typeof t.pullRequests.$inferSelect;

export class ReviewRepository {
  constructor(private db: Db) {}

  // ---- PR lookup (workspace-scoped) --------------------------------------

  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async getRepo(repoId: string): Promise<typeof t.repos.$inferSelect | undefined> {
    const [row] = await this.db.select().from(t.repos).where(eq(t.repos.id, repoId));
    return row;
  }

  async getPrFiles(prId: string): Promise<(typeof t.prFiles.$inferSelect)[]> {
    return this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
  }

  // ---- reviews + findings -------------------------------------------------

  async insertReview(values: {
    workspaceId: string;
    prId: string;
    agentId: string | null;
    kind: 'summary' | 'review';
    verdict: string | null;
    summary: string | null;
    score: number | null;
    model: string | null;
  }): Promise<ReviewRow> {
    const [row] = await this.db.insert(t.reviews).values(values).returning();
    return row!;
  }

  async insertFindings(reviewId: string, findings: Finding[]): Promise<FindingRow[]> {
    if (findings.length === 0) return [];
    const rows = await this.db
      .insert(t.findings)
      .values(
        findings.map((f) => ({
          reviewId,
          file: f.file,
          startLine: f.start_line,
          endLine: f.end_line,
          severity: f.severity,
          category: f.category,
          title: f.title,
          rationale: f.rationale,
          suggestion: f.suggestion ?? null,
          confidence: f.confidence,
          kind: f.kind ?? 'finding',
          trifectaComponents: f.trifecta_components ?? null,
        })),
      )
      .returning();
    return rows;
  }

  /** Reviews for a PR (newest first), each with its findings. */
  async reviewsForPull(prId: string): Promise<{ review: ReviewRow; findings: FindingRow[] }[]> {
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

  async getReview(reviewId: string): Promise<ReviewRow | undefined> {
    const [row] = await this.db.select().from(t.reviews).where(eq(t.reviews.id, reviewId));
    return row;
  }

  // ---- finding actions ----------------------------------------------------

  async getFinding(findingId: string): Promise<FindingRow | undefined> {
    const [row] = await this.db.select().from(t.findings).where(eq(t.findings.id, findingId));
    return row;
  }

  /** Resolve workspace_id + pr_id for a finding (via review → pr). */
  async findingContext(
    findingId: string,
  ): Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined> {
    const finding = await this.getFinding(findingId);
    if (!finding) return undefined;
    const review = await this.getReview(finding.reviewId);
    if (!review) return undefined;
    const [pull] = await this.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.id, review.prId));
    if (!pull) return undefined;
    return { finding, review, pull };
  }

  async setFindingAccepted(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    const [row] = await this.db
      .update(t.findings)
      .set({ acceptedAt: at, dismissedAt: null })
      .where(eq(t.findings.id, findingId))
      .returning();
    return row;
  }

  async setFindingDismissed(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    const [row] = await this.db
      .update(t.findings)
      .set({ dismissedAt: at, acceptedAt: null })
      .where(eq(t.findings.id, findingId))
      .returning();
    return row;
  }

  // ---- intent -------------------------------------------------------------

  async upsertIntent(prId: string, intent: Intent): Promise<void> {
    await this.db
      .insert(t.prIntent)
      .values({
        prId,
        intent: intent.intent,
        inScope: intent.in_scope,
        outOfScope: intent.out_of_scope,
      })
      .onConflictDoUpdate({
        target: t.prIntent.prId,
        set: { intent: intent.intent, inScope: intent.in_scope, outOfScope: intent.out_of_scope },
      });
  }

  async getIntent(prId: string): Promise<Intent | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    if (!row) return undefined;
    return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope };
  }

  // ---- observability: agent_runs + run_traces ----------------------------

  /** Create an agent_runs row in `running` state; returns its id (= the runId). */
  async createAgentRun(values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
  }): Promise<string> {
    const [row] = await this.db
      .insert(t.agentRuns)
      .values({
        workspaceId: values.workspaceId,
        agentId: values.agentId,
        prId: values.prId,
        provider: values.provider,
        model: values.model,
        status: 'running',
        source: 'local',
      })
      .returning({ id: t.agentRuns.id });
    return row!.id;
  }

  async completeAgentRun(
    runId: string,
    values: {
      status: 'done' | 'failed';
      durationMs: number;
      tokensIn: number;
      tokensOut: number;
      costUsd: number | null;
      findingsCount: number;
      grounding: string;
    },
  ): Promise<void> {
    await this.db
      .update(t.agentRuns)
      .set({
        status: values.status,
        durationMs: values.durationMs,
        tokensIn: values.tokensIn,
        tokensOut: values.tokensOut,
        costUsd: values.costUsd,
        findingsCount: values.findingsCount,
        grounding: values.grounding,
      })
      .where(eq(t.agentRuns.id, runId));
  }

  /** Persist the WHOLE run log as ONE document (§7). PK = runId → agent_runs. */
  async saveRunTrace(runId: string, trace: RunTrace): Promise<void> {
    await this.db
      .insert(t.runTraces)
      .values({ runId, trace })
      .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace } });
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    const [row] = await this.db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
    return row ? (row.trace as RunTrace) : undefined;
  }
}
