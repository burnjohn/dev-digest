import type {
  Skill,
  SkillVersion,
  SkillStats,
  ImportPreview,
  EvalCase,
  SkillContextDocLink,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { SkillsRepository } from './repository.js';
import { toSkillDto, toSkillVersionDto, previewMarkdown } from './helpers.js';
import { AppError, NotFoundError } from '../../platform/errors.js';

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) throw new NotFoundError(`Skill ${id} not found`);
    return toSkillDto(row);
  }

  async create(
    workspaceId: string,
    input: {
      name: string;
      description: string;
      type: Skill['type'];
      source: Skill['source'];
      body: string;
      enabled?: boolean;
    },
  ): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name.trim(),
      description: input.description.trim(),
      type: input.type,
      source: input.source,
      body: input.body,
      enabled: input.enabled,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: {
      name?: string;
      description?: string;
      type?: Skill['type'];
      body?: string;
      enabled?: boolean;
    },
  ): Promise<Skill> {
    const row = await this.repo.update(workspaceId, id, {
      name: patch.name?.trim(),
      description: patch.description?.trim(),
      type: patch.type,
      body: patch.body,
      enabled: patch.enabled,
    });
    if (!row) throw new NotFoundError(`Skill ${id} not found`);
    return toSkillDto(row);
  }

  async delete(workspaceId: string, id: string): Promise<void> {
    const deleted = await this.repo.deleteById(workspaceId, id);
    if (!deleted) throw new NotFoundError(`Skill ${id} not found`);
  }

  /**
   * Attached context documents for a skill (ordered). 404-guards `skillId`
   * against `workspaceId` via `get()` BEFORE delegating to `ContextDocsService`
   * — `ContextDocsService.skillAttachments`/`setSkillAttachments` intentionally
   * do NOT re-validate workspace ownership themselves (see context-docs
   * service.ts's "ownership boundary" comment).
   */
  async contextDocLinks(workspaceId: string, skillId: string): Promise<SkillContextDocLink[]> {
    await this.get(workspaceId, skillId);
    const links = await this.container.contextDocs.skillAttachments(skillId);
    return links.map((l) => ({ owner_id: skillId, path: l.path, order: l.order }));
  }

  /**
   * Replace the skill's full set of attached context-document paths (full
   * replace-and-reorder semantics, mirrors the agent-side equivalent). Same
   * workspace guard as `contextDocLinks` — validated here, before
   * `ContextDocsService` is touched.
   */
  async setContextDocs(
    workspaceId: string,
    skillId: string,
    paths: string[],
  ): Promise<SkillContextDocLink[]> {
    await this.get(workspaceId, skillId);
    const links = await this.container.contextDocs.setSkillAttachments(skillId, paths);
    return links.map((l) => ({ owner_id: skillId, path: l.path, order: l.order }));
  }

  async versions(workspaceId: string, skillId: string): Promise<SkillVersion[]> {
    await this.get(workspaceId, skillId);
    const rows = await this.repo.versions(workspaceId, skillId);
    return rows.map(toSkillVersionDto);
  }

  async restoreVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<Skill> {
    await this.get(workspaceId, skillId);
    const row = await this.repo.restoreVersion(workspaceId, skillId, version);
    if (!row) throw new AppError('not_found', `Version ${version} not found`, 404);
    return toSkillDto(row);
  }

  async stats(workspaceId: string, skillId: string): Promise<SkillStats> {
    await this.get(workspaceId, skillId);
    return this.repo.stats(workspaceId, skillId);
  }

  // ---- Import preview (no DB write — pure parse) ---------------------------

  importPreview(rawName: string, filename: string, contentB64: string): ImportPreview {
    let content: string;
    try {
      content = Buffer.from(contentB64, 'base64').toString('utf8');
    } catch {
      throw new AppError('validation_error', 'Invalid base64 content', 400);
    }
    const lowerFile = filename.toLowerCase();
    if (!lowerFile.endsWith('.md') && !lowerFile.endsWith('.txt')) {
      throw new AppError('validation_error', 'Only .md and .txt files are supported for import', 400);
    }
    return previewMarkdown(rawName, filename, content);
  }

  // ---- Eval cases (using existing eval_cases table) -----------------------

  async listEvalCases(workspaceId: string, skillId: string): Promise<EvalCase[]> {
    await this.get(workspaceId, skillId);
    const rows = await this.repo.listEvalCases(workspaceId, skillId);
    const latestRuns = await this.repo.latestEvalRuns(rows.map((r) => r.id));

    return rows.map((r) => ({
      id: r.id,
      owner_kind: 'skill' as const,
      owner_id: r.ownerId,
      name: r.name,
      input_diff: r.inputDiff ?? '',
      input_files: r.inputFiles,
      input_meta: r.inputMeta,
      expected_output: r.expectedOutput,
      notes: r.notes ?? null,
      last_run: latestRuns.has(r.id)
        ? {
            pass: latestRuns.get(r.id)!.pass,
            ran_at: latestRuns.get(r.id)!.ranAt.toISOString(),
          }
        : null,
    }));
  }

  async createEvalCase(
    workspaceId: string,
    skillId: string,
    input: {
      name: string;
      input_diff: string;
      expected_output?: unknown;
      notes?: string;
    },
  ): Promise<EvalCase> {
    await this.get(workspaceId, skillId);
    const row = await this.repo.insertEvalCase({
      workspaceId,
      skillId,
      name: input.name,
      input_diff: input.input_diff,
      expected_output: input.expected_output,
      notes: input.notes,
    });
    return {
      id: row.id,
      owner_kind: 'skill',
      owner_id: row.ownerId,
      name: row.name,
      input_diff: row.inputDiff ?? '',
      input_files: row.inputFiles,
      input_meta: row.inputMeta,
      expected_output: row.expectedOutput,
      notes: row.notes ?? null,
    };
  }

  async deleteEvalCase(workspaceId: string, caseId: string): Promise<void> {
    const deleted = await this.repo.deleteEvalCase(workspaceId, caseId);
    if (!deleted) throw new NotFoundError(`Eval case ${caseId} not found`);
  }
}
