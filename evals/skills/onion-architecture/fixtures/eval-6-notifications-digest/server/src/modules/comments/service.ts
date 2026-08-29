import type { Db } from '../../db/client.js';
import { CommentRepository } from './repository.js';

export interface CommentServiceDeps {
  db: Db;
}

export class CommentService {
  private repo: CommentRepository;

  constructor(private deps: CommentServiceDeps) {
    this.repo = new CommentRepository(deps.db);
  }

  async listRecentAcrossWorkspace(workspaceId: string, since: Date) {
    return this.repo.listSince(workspaceId, since);
  }
}
