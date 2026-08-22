import type { Skill, SkillVersion } from '@devdigest/shared';
import { unzipSync, strFromU8 } from 'fflate';
import type { Container } from '../../platform/container.js';
import { SkillsRepository } from './repository.js';
import type { SkillStats } from './repository.js';
import { toSkillDto, toSkillVersionDto } from './helpers.js';
import { ValidationError } from '../../platform/errors.js';

export type { SkillStats };

export interface CreateSkillInput {
  name: string;
  description?: string;
  type?: 'rubric' | 'convention' | 'security' | 'custom';
  source?: 'manual' | 'imported_url' | 'extracted' | 'community';
  body: string;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: 'rubric' | 'convention' | 'security' | 'custom';
  source?: 'manual' | 'imported_url' | 'extracted' | 'community';
  body?: string;
  enabled?: boolean;
  version_message?: string;
}

export interface ImportPreviewResult {
  name: string;
  description: string;
  type: 'rubric' | 'convention' | 'security' | 'custom';
  source: 'imported_url';
  body: string;
  ignored_files: string[];
}

const MAX_IMPORT_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * A1 — skills service. Business logic for the Skills tab.
 *
 * A Skill = name + description + type + source + body + enabled + versioned.
 * Body changes are versioned via `skill_versions` (repository).
 */
export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = container.skillsRepo;
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description ?? '',
      type: input.type ?? 'custom',
      source: input.source ?? 'manual',
      body: input.body,
      enabled: input.enabled,
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
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.version_message !== undefined ? { message: patch.version_message } : {}),
    });
    return row ? toSkillDto(row) : undefined;
  }

  /**
   * Config history for a skill, newest version first. Workspace-scoped: returns
   * undefined when the skill isn't in this workspace (the route maps that to 404).
   */
  async listVersions(
    workspaceId: string,
    skillId: string,
  ): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  /**
   * Restore a skill to a previous body version. Returns undefined when the skill
   * or the requested version doesn't exist in this workspace.
   */
  async restore(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<Skill | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const row = await this.repo.restore(workspaceId, skillId, version);
    return row ? toSkillDto(row) : undefined;
  }

  /** Usage and finding stats for a skill. Returns undefined when not found. */
  async stats(workspaceId: string, skillId: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    return this.repo.stats(skillId);
  }

  /**
   * Parse a file upload and return a preview of what would be created — WITHOUT
   * persisting anything. Supports .md and .zip only. Max 5 MB.
   */
  importPreview(filename: string, base64: string): ImportPreviewResult {
    const buf = Buffer.from(base64, 'base64');

    if (buf.byteLength > MAX_IMPORT_SIZE) {
      throw new ValidationError(
        `File too large: ${buf.byteLength} bytes (max ${MAX_IMPORT_SIZE} bytes)`,
      );
    }

    const lower = filename.toLowerCase();

    if (lower.endsWith('.md')) {
      const text = buf.toString('utf-8');
      const name = extractMarkdownTitle(text) ?? stemFromFilename(filename);
      return {
        name,
        description: '',
        type: 'custom',
        source: 'imported_url',
        body: text,
        ignored_files: [],
      };
    }

    if (lower.endsWith('.zip')) {
      const entries = unzipSync(new Uint8Array(buf));
      const paths = Object.keys(entries);

      // Find SKILL.md first, then fall back to the first top-level *.md
      const skillMdPath = paths.find((p) => p.toUpperCase() === 'SKILL.MD');
      const firstMdPath =
        skillMdPath ??
        paths.find((p) => !p.includes('/') && p.toLowerCase().endsWith('.md'));

      if (!firstMdPath) {
        throw new ValidationError('No .md file found in the zip archive');
      }

      const bodyBytes = entries[firstMdPath];
      if (!bodyBytes) {
        throw new ValidationError(`Could not read ${firstMdPath} from the zip archive`);
      }
      const body = strFromU8(bodyBytes);
      const name = extractMarkdownTitle(body) ?? stemFromFilename(firstMdPath);

      const ignoredFiles = paths.filter((p) => p !== firstMdPath && !p.endsWith('/'));

      return {
        name,
        description: '',
        type: 'custom',
        source: 'imported_url',
        body,
        ignored_files: ignoredFiles,
      };
    }

    throw new ValidationError(
      `Unsupported file type: "${filename}". Only .md and .zip are supported.`,
    );
  }
}

// ---- private helpers -------------------------------------------------------

/** Extract the first # heading from markdown text, or undefined. */
function extractMarkdownTitle(text: string): string | undefined {
  const match = text.match(/^#\s+(.+)/m);
  return match?.[1]?.trim();
}

/** Return the filename stem (no extension, no path). */
function stemFromFilename(filename: string): string {
  const base = filename.split('/').pop() ?? filename;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}
