import { and, eq, ne, sql } from 'drizzle-orm';
import * as t from '../../db/schema.js';

/**
 * Reusable filter fragments for comment visibility. Kept separate from
 * repository.ts because both the review-comments and notifications modules'
 * digest jobs need the same "visible to this workspace, not soft-deleted"
 * predicate when building their own queries.
 */
export function commentVisibilityFilter(workspaceId: string) {
  return and(eq(t.comments.workspaceId, workspaceId), ne(t.comments.deleted, true));
}

export function unresolvedThreadCountExpr() {
  return sql<number>`count(*) filter (where ${t.comments.resolved} = false)`;
}
