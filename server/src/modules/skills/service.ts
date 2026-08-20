import { unzipSync } from 'fflate';
import type { Container } from '../../platform/container.js';
import type {
  Skill,
  SkillImportPreview,
  SkillSummary,
  SkillType,
  SkillVersion,
} from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { SkillsRepository } from './repository.js';
import {
  isExecutableLooking,
  parseSkillMarkdown,
  pickSkillCore,
  toSkillDto,
  toSkillVersionDto,
} from './helpers.js';
import {
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_BODY_BYTES,
  MAX_UPLOAD_BYTES,
} from './constants.js';

/**
 * A1 — skills service. A skill is TEXT AND CONFIG ONLY: it never executes, never
 * declares a tool, and never touches the filesystem or the network. Import
 * therefore parses in memory and returns a PREVIEW; persistence happens later,
 * through the ordinary create route, once the user has confirmed.
 */

export { toSkillDto } from './helpers.js';

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  source?: Skill['source'];
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  /** Author's note about what changed; recorded on the version this save writes. */
  version_message?: string;
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<SkillSummary[]> {
    const rows = await this.repo.listWithUsage(workspaceId);
    return rows.map((r) => ({ ...toSkillDto(r.skill), used_by: r.usedBy }));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      body: input.body,
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const { version_message: versionMessage, ...fields } = patch;
    const row = await this.repo.update(workspaceId, id, fields, versionMessage);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Body history, newest version first. Undefined when not in this workspace. */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map(toSkillVersionDto);
  }

  async getVersion(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(id, version);
    return row ? toSkillVersionDto(row) : undefined;
  }

  /** Agents linking a skill — shown before deleting it. */
  async linkedAgents(
    workspaceId: string,
    id: string,
  ): Promise<Array<{ id: string; name: string }> | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    return this.repo.linkedAgents(id);
  }

  /**
   * Parse an uploaded `.md` or `.zip` into a preview. Persists NOTHING.
   *
   * For an archive we read members into memory to find the skill's markdown
   * core; every other member is reported as ignored and never opened, written,
   * or executed. Member paths are never resolved against a directory, so the
   * classic zip-slip traversal has no surface here — the only thing that leaves
   * this function is text.
   */
  async importPreview(filename: string, contentB64: string): Promise<SkillImportPreview> {
    const bytes = Buffer.from(contentB64, 'base64');
    if (bytes.length === 0) throw new ValidationError('The uploaded file is empty');
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new ValidationError(
        `File is too large (${bytes.length} bytes; max ${MAX_UPLOAD_BYTES})`,
      );
    }

    const isZip = filename.toLowerCase().endsWith('.zip');
    const parsed = isZip
      ? this.parseArchive(filename, bytes)
      : {
          ...parseSkillMarkdown(filename, bytes.toString('utf8')),
          ignored_entries: [] as string[],
          warnings: [] as string[],
        };

    if (Buffer.byteLength(parsed.body, 'utf8') > MAX_BODY_BYTES) {
      throw new ValidationError(`Skill body is too large (max ${MAX_BODY_BYTES} bytes)`);
    }
    if (parsed.body.trim().length === 0) {
      throw new ValidationError('No skill content found in the upload');
    }

    return {
      name: parsed.name,
      description: parsed.description,
      type: parsed.type,
      // Anything that did not come from the editor is flagged at the source
      // level; the UI uses this to badge the skill as third-party.
      source: 'imported_url',
      body: parsed.body,
      ignored_entries: parsed.ignored_entries,
      warnings: parsed.warnings,
    };
  }

  /** Unzip in memory, pick the skill core, report everything else as ignored. */
  private parseArchive(filename: string, bytes: Buffer) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(bytes));
    } catch (err) {
      throw new ValidationError(`Could not read the archive: ${(err as Error).message}`);
    }

    // Directory members come through as zero-length entries with a trailing '/'.
    const paths = Object.keys(entries).filter((p) => !p.endsWith('/'));
    if (paths.length > MAX_ARCHIVE_ENTRIES) {
      throw new ValidationError(
        `Archive has too many entries (${paths.length}; max ${MAX_ARCHIVE_ENTRIES})`,
      );
    }
    const total = paths.reduce((sum, p) => sum + (entries[p]?.length ?? 0), 0);
    if (total > MAX_ARCHIVE_BYTES) {
      throw new ValidationError(
        `Archive is too large uncompressed (${total} bytes; max ${MAX_ARCHIVE_BYTES})`,
      );
    }

    const core = pickSkillCore(paths);
    if (!core) {
      throw new ValidationError(
        `No markdown file found in the archive (${paths.length} entries: ${paths
          .slice(0, 10)
          .join(', ')})`,
      );
    }

    const text = Buffer.from(entries[core]!).toString('utf8');
    const parsed = parseSkillMarkdown(core, text);
    const ignored = paths.filter((p) => p !== core).sort();
    const executable = ignored.filter(isExecutableLooking);

    return {
      ...parsed,
      // Fall back to the archive's own name when the markdown declares none.
      name: parsed.name || filename,
      ignored_entries: ignored,
      warnings: executable.length
        ? [
            `${executable.length} executable-looking file(s) in the archive were NOT imported and never run: ${executable
              .slice(0, 5)
              .join(', ')}`,
          ]
        : [],
    };
  }
}
