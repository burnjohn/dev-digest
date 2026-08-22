import type { Container } from "../../platform/container.js";
import type { Skill, SkillSource, SkillType } from "@devdigest/shared";
import { SkillsRepository } from "./repository.js";
import type { SkillRow, SkillStats, SkillVersionRow } from "./repository.js";
import { THREAT_LEVEL } from "./scanner.js";
import type { ThreatLevel } from "./scanner.js";

/**
 * A1 — skills service. Business logic for the Skills library.
 *
 * A Skill = named, versioned text body (rubric / convention / security / custom)
 * that agents can be linked to. Body changes are versioned via `skill_versions`
 * (repository). Metadata changes (name, description, enabled, type) are NOT versioned.
 */

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
}

export interface ImportSkillInput {
  name: string;
  body: string;
  source?: SkillSource;
  description?: string;
  enabled?: boolean;
  threatLevel?: ThreatLevel;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: (row.evidenceFiles as string[] | null) ?? null,
    threat_level: (row.threatLevel as ThreatLevel) ?? THREAT_LEVEL.UNKNOWN,
  };
}

export class SkillsService {
  repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description ?? "",
      type: input.type,
      source: input.source ?? "manual",
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
    return toSkillDto(row);
  }

  /** Import a skill from an external source. Source defaults to 'imported_url'. */
  async import(workspaceId: string, input: ImportSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description ?? "",
      type: "custom",
      source: input.source ?? "manual",
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.threatLevel !== undefined
        ? { threatLevel: input.threatLevel }
        : {}),
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async versions(workspaceId: string, id: string): Promise<SkillVersionRow[]> {
    // Guard: ensure skill belongs to workspace before exposing versions.
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return [];
    return this.repo.listVersions(id);
  }

  async stats(
    workspaceId: string,
    id: string,
  ): Promise<SkillStats | undefined> {
    return this.repo.stats(workspaceId, id);
  }

  async updateThreatLevel(id: string, threatLevel: ThreatLevel): Promise<void> {
    await this.repo.updateThreatLevel(id, threatLevel);
  }

  async restore(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<Skill | undefined> {
    const row = await this.repo.restore(workspaceId, id, version);
    return row ? toSkillDto(row) : undefined;
  }
}
