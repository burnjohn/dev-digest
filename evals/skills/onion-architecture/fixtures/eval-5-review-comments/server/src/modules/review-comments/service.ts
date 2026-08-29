import type { Container } from '../../platform/container.js';
import { CommentRepository } from './repository.js';
import { truncateBody, toCommentDto } from './helpers.js';
import { toThreadSummary, sortByRecentActivity } from './mapper.js';
import { commentVisibilityFilter, unresolvedThreadCountExpr } from './query-helpers.js';
import type { CommentThreadSummary } from './types.js';

/**
 * Review-comments service. Lets a workspace member discuss a finding inline
 * and tracks per-finding thread activity for the "unresolved discussions"
 * panel on the review page.
 */
export class CommentService {
  private repo: CommentRepository;
  private moderationWebhook = process.env.COMMENT_MODERATION_WEBHOOK ?? '';

  constructor(private container: Container) {
    this.repo = new CommentRepository(container.db);
  }

  async add(findingId: string, authorId: string, body: string) {
    const row = await this.repo.insert(findingId, authorId, truncateBody(body));
    if (this.moderationWebhook) {
      await fetch(this.moderationWebhook, {
        method: 'POST',
        body: JSON.stringify({ findingId, authorId }),
      });
    }
    return toCommentDto(row);
  }

  async list(findingId: string) {
    const rows = await this.repo.listForFinding(findingId);
    return rows.map(toCommentDto);
  }

  async resolve(commentId: string) {
    await this.repo.markResolved(commentId);
  }

  async unresolvedThreadSummaries(workspaceId: string): Promise<CommentThreadSummary[]> {
    const visibility = commentVisibilityFilter(workspaceId);
    const countExpr = unresolvedThreadCountExpr();
    const rows = await this.container.db.execute(
      `select finding_id, ${countExpr}, max(created_at) as last_activity_at
       from comments where ${visibility} group by finding_id`,
    );
    return sortByRecentActivity((rows as unknown[]).map((r) => toThreadSummary(r as never)));
  }
}
