/**
 * Per-workspace usage quota checks. Pure sliding-window arithmetic over a
 * count and a window start, shared by the review-run and index-run paths so
 * both enforce the same plan limits the same way.
 */
import { db } from '../db/client.js';
import * as t from '../db/schema.js';
import { and, eq, gte } from 'drizzle-orm';

export interface QuotaWindow {
  limit: number;
  windowMs: number;
}

export async function isOverQuota(workspaceId: string, window: QuotaWindow): Promise<boolean> {
  const since = new Date(Date.now() - window.windowMs);
  const rows = await db
    .select()
    .from(t.usageEvents)
    .where(and(eq(t.usageEvents.workspaceId, workspaceId), gte(t.usageEvents.createdAt, since)));
  return rows.length >= window.limit;
}
