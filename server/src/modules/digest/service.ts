import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import type { Digest } from '@devdigest/shared';
import { DIGEST_WINDOW_MS } from './constants.js';
import { buildDigestMarkdown, tallyBySeverity } from './helpers.js';

/**
 * A6 — Weekly Digest (§7 L08). Builds a period summary (markdown) from
 * `agent_runs` + `reviews`/`findings` in the window and persists a `digests`
 * row. A JobRunner handler (`weekly_digest`) lets a scheduler build it on a
 * cadence; `POST /digest/run` builds one on demand.
 */
export class DigestService {
  constructor(private container: Container) {}

  private get db() {
    return this.container.db;
  }

  async run(workspaceId: string, range?: { start?: Date; end?: Date }): Promise<Digest> {
    const end = range?.end ?? new Date(Date.now());
    const start = range?.start ?? new Date(end.getTime() - DIGEST_WINDOW_MS);

    const runs = await this.db
      .select()
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          gte(t.agentRuns.ranAt, start),
          lte(t.agentRuns.ranAt, end),
        ),
      );

    const reviewRows = await this.db
      .select({ review: t.reviews, finding: t.findings })
      .from(t.reviews)
      .leftJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          gte(t.reviews.createdAt, start),
          lte(t.reviews.createdAt, end),
        ),
      );

    const reviewIds = new Set(reviewRows.map((r) => r.review.id));
    const findings = reviewRows.map((r) => r.finding).filter((f): f is NonNullable<typeof f> => !!f);
    const accepted = findings.filter((f) => f.acceptedAt != null).length;
    const dismissed = findings.filter((f) => f.dismissedAt != null).length;
    const costs = runs.map((r) => r.costUsd).filter((c): c is number => c != null);
    const totalCost = costs.reduce((n, c) => n + c, 0);

    const bySeverity = tallyBySeverity(findings);

    const body = buildDigestMarkdown({
      reviewCount: reviewIds.size,
      runCount: runs.length,
      findingsCount: findings.length,
      bySeverity,
      accepted,
      dismissed,
      totalCost,
      start,
      end,
    });

    const [row] = await this.db
      .insert(t.digests)
      .values({ workspaceId, periodStart: start, periodEnd: end, bodyMd: body, deliveredTo: null })
      .returning();

    return this.toDto(row!);
  }

  async list(workspaceId: string): Promise<Digest[]> {
    const rows = await this.db
      .select()
      .from(t.digests)
      .where(eq(t.digests.workspaceId, workspaceId))
      .orderBy(desc(t.digests.periodEnd));
    return rows.map((r) => this.toDto(r));
  }

  private toDto(row: typeof t.digests.$inferSelect): Digest {
    return {
      id: row.id,
      period_start: row.periodStart ? row.periodStart.toISOString() : null,
      period_end: row.periodEnd ? row.periodEnd.toISOString() : null,
      body_md: row.bodyMd,
      delivered_to: row.deliveredTo,
    };
  }
}
