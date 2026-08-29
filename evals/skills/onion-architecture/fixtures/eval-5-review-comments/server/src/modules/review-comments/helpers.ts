import type { CommentRow } from './repository.js';
import { MAX_COMMENT_LENGTH } from './constants.js';

export function truncateBody(body: string): string {
  return body.length > MAX_COMMENT_LENGTH ? body.slice(0, MAX_COMMENT_LENGTH) : body;
}

export function toCommentDto(row: CommentRow) {
  return {
    id: row.id,
    findingId: row.findingId,
    authorId: row.authorId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    resolved: row.resolved,
  };
}
