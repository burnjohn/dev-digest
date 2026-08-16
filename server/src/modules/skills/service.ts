import type { Skill, SkillListItem, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import { SkillsRepository, type UpdateSkill } from './repository.js';
import {
  isBodyChange,
  resolveSkillName,
  toSkillDto,
  toSkillListItemDto,
  toSkillVersionDto,
} from './helpers.js';
import { DEFAULT_SKILL_SOURCE, DEFAULT_SKILL_TYPE } from './constants.js';

/**
 * A1 — skills service. Business logic for reusable review rules.
 *
 * Takes an explicit `Deps` interface, NOT the `Container`. `Container` exposes
 * `db` as a public member, so `new SkillsService(app.container)` still compiles
 * at the call site with no container change — but the dependency is now visible
 * in the signature and a hermetic test can pass `{ db }` as an object literal
 * instead of faking the whole world. (This is the first service in the repo
 * written this way; the other four still take `Container`. Follow this one.)
 *
 * 404 convention: every read returns `undefined` when the skill is missing OR
 * belongs to another workspace — the two are indistinguishable on purpose, so a
 * cross-tenant probe cannot tell "not yours" from "does not exist". The route
 * turns `undefined` into `NotFoundError`.
 */
export interface SkillsServiceDeps {
  db: Db;
}

export interface CreateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(deps: SkillsServiceDeps) {
    this.repo = new SkillsRepository(deps.db);
  }

  async list(workspaceId: string): Promise<SkillListItem[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map((r) => toSkillListItemDto(r.skill, r.usedBy));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  /**
   * Create a skill. The name falls back to the body's first `# H1` (then to a
   * placeholder) so an import that carries no explicit name still lands with a
   * clickable card — `file.nameHint` in the UI promises exactly this.
   */
  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: resolveSkillName(input.name, input.body),
      description: input.description ?? '',
      type: input.type ?? DEFAULT_SKILL_TYPE,
      source: input.source ?? DEFAULT_SKILL_SOURCE,
      body: input.body,
      enabled: input.enabled ?? true,
      evidenceFiles: input.evidence_files ?? null,
    });
    return toSkillDto(row);
  }

  /**
   * Update a skill. Only a real body change bumps the version and writes a new
   * `skill_versions` snapshot — the decision is made here (against the current
   * row) and passed down, so the repository stays a mechanical writer and the
   * predicate stays hermetically testable in `helpers.ts`.
   */
  async update(
    workspaceId: string,
    id: string,
    input: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) return undefined;

    const patch: UpdateSkill = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.evidence_files !== undefined ? { evidenceFiles: input.evidence_files } : {}),
    };

    const row = await this.repo.update(workspaceId, id, patch, {
      bumpVersion: isBodyChange(existing, patch),
    });
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /**
   * Body history, newest first. Returns `undefined` (not `[]`) when the skill
   * itself is missing, so the route can 404 rather than render an empty tab for
   * a skill that does not exist.
   */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map(toSkillVersionDto);
  }
}
