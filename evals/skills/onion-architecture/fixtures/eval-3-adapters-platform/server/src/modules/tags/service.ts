import type { Db } from '../../db/client.js';
import { TagRepository } from './repository.js';
import { MAX_TAGS_PER_REPO } from './constants.js';

export interface TagServiceDeps {
  db: Db;
}

export class TagService {
  private repo: TagRepository;

  constructor(private deps: TagServiceDeps) {
    this.repo = new TagRepository(deps.db);
  }

  async list(workspaceId: string) {
    return this.repo.list(workspaceId);
  }

  async create(workspaceId: string, name: string) {
    const existing = await this.repo.list(workspaceId);
    if (existing.length >= MAX_TAGS_PER_REPO) {
      throw new Error('tag limit reached');
    }
    return this.repo.create(workspaceId, name);
  }
}
