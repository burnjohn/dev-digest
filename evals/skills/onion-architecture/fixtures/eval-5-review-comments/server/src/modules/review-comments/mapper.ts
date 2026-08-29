import type { CommentThreadRow } from './repository.js';
import type { CommentThreadSummary } from './types.js';

export function toThreadSummary(row: CommentThreadRow): CommentThreadSummary {
  return {
    findingId: row.findingId,
    commentCount: row.commentCount,
    lastActivityAt: row.lastActivityAt.toISOString(),
    resolved: row.resolved,
  };
}

export function sortByRecentActivity(summaries: CommentThreadSummary[]): CommentThreadSummary[] {
  return [...summaries].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}
