import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { GitClient } from '@devdigest/shared';
import type {
  ContextAttachResponse,
  ContextDocument,
  ContextDocSource,
  ContextDocumentList,
  ContextPreviewResponse,
} from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import type { AppConfig } from '../../platform/config.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { CONTEXT_DOC_EXT, MAX_FILE_SIZE } from './constants.js';
import { estimateTokens, resolveWithinRoot } from './helpers.js';
import { walkContextDocs } from './pipeline/walk-docs.js';
import { ContextRepository, type OwnerId } from './repository.js';
import type { ContextDocs, DocFile, ReadDocumentResult, WalkDocsResult } from './types.js';

/**
 * `context` service (R2). SPEC-01 (Project Context).
 *
 * `ContextServiceDeps` is explicit rather than the whole `Container` — it is
 * structurally satisfied by `Container` with no call-site or container
 * change (`server/INSIGHTS.md`, 2026-08-15). `git` is narrowed to
 * `Pick<GitClient, 'clonePathFor'>` exactly like
 * `adapters/codeindex/ripgrep.ts` — this module never clones or fetches, it
 * only needs the deterministic `<cloneDir>/<owner>/<name>` path.
 *
 * Implements `ContextDocs` (T5's port, `types.ts`) so `container.contextDocs`
 * can be typed against it exactly like `container.repoIntel` — plus the
 * additional HTTP-facing methods `routes.ts` calls directly, which are not
 * part of that cross-module port.
 *
 * REQ-25: this file issues no LLM completion and no embedding request —
 * `deps` below carries no `llm`/`embedder` capability at all, so there is
 * nothing on this file's dependency surface that COULD make one.
 */
export interface ContextServiceDeps {
  db: Db;
  config: Pick<AppConfig, 'contextSearchRoots' | 'contextUploadDir'>;
  git: Pick<GitClient, 'clonePathFor'>;
}

export interface UsageCounts {
  usedByAgents: number;
  usedByDisabledSkillOnly: number;
}

/**
 * REQ-7 — pure combine step over the repository's two raw usage reads. An
 * agent is "reached" if EITHER a direct row or a skill row names it; it is
 * counted in `usedByDisabledSkillOnly` only if NONE of the rows that reached
 * it were direct or via an enabled skill (a direct attachment always counts
 * as a live path, regardless of any skill's enabled state).
 */
export function computeUsageCounts(
  directRows: { path: string; agentId: string }[],
  skillRows: { path: string; agentId: string; skillEnabled: boolean }[],
): Map<string, UsageCounts> {
  const perPath = new Map<string, Map<string, boolean>>();
  const touch = (path: string, agentId: string, viaEnabledOrDirect: boolean) => {
    let agents = perPath.get(path);
    if (!agents) {
      agents = new Map();
      perPath.set(path, agents);
    }
    agents.set(agentId, (agents.get(agentId) ?? false) || viaEnabledOrDirect);
  };
  for (const r of directRows) touch(r.path, r.agentId, true);
  for (const r of skillRows) touch(r.path, r.agentId, r.skillEnabled);

  const result = new Map<string, UsageCounts>();
  for (const [path, agents] of perPath) {
    let usedByAgents = 0;
    let usedByDisabledSkillOnly = 0;
    for (const viaEnabledOrDirect of agents.values()) {
      usedByAgents += 1;
      if (!viaEnabledOrDirect) usedByDisabledSkillOnly += 1;
    }
    result.set(path, { usedByAgents, usedByDisabledSkillOnly });
  }
  return result;
}

export type PreviewOutcome =
  | { ok: true; doc: ContextPreviewResponse }
  | { ok: false; reason: 'repo_not_found' }
  | { ok: false; reason: 'escaped' }
  | { ok: false; reason: 'not_found' };

export class ContextService implements ContextDocs {
  private repo: ContextRepository;

  constructor(private deps: ContextServiceDeps) {
    this.repo = new ContextRepository(deps.db);
  }

  // ---- ContextDocs port -------------------------------------------------

  /** AC-1/AC-9/NFR-1/REQ-37 — delegates straight to T5's pure walk. */
  async listDocuments(cloneDir: string, searchRoots: string[]): Promise<WalkDocsResult> {
    return walkContextDocs(cloneDir, searchRoots);
  }

  /**
   * AC-20/AC-21/AC-23/AC-30 — read one document fresh from disk and format
   * its `### <path>` block. `git.readFile` THROWS for a missing file
   * (`server/INSIGHTS.md`, 2026-08-17); this wraps the read so a vanished or
   * out-of-bounds document degrades to `null` rather than throwing.
   */
  async readDocument(baseDir: string, relativePath: string): Promise<ReadDocumentResult | null> {
    const resolved = await resolveWithinRoot(baseDir, relativePath);
    if (resolved === null) return null;
    try {
      const body = await readFile(resolved, 'utf8');
      return { body, block: `### ${relativePath}\n${body}` };
    } catch {
      return null;
    }
  }

  /** REQ-18 — the single effective-list rule; see `types.ts` for the full contract doc. */
  async resolveEffectiveAttachments(agentId: string, repoId: string): Promise<string[]> {
    const [agentRows, skillIds] = await Promise.all([
      this.repo.getAgentAttachments(agentId, repoId),
      this.repo.getEnabledLinkedSkillIds(agentId),
    ]);
    const skillRows = await this.repo.getSkillAttachments(skillIds, repoId);

    const bySkill = new Map<string, string[]>();
    for (const row of skillRows) {
      const list = bySkill.get(row.skillId) ?? [];
      list.push(row.path);
      bySkill.set(row.skillId, list);
    }

    const seen = new Set<string>();
    const result: string[] = [];
    const push = (path: string) => {
      if (!seen.has(path)) {
        seen.add(path);
        result.push(path);
      }
    };
    for (const row of agentRows) push(row.path);
    for (const skillId of skillIds) {
      for (const path of bySkill.get(skillId) ?? []) push(path);
    }
    return result;
  }

  // ---- Discovery / preview / upload (routes.ts callers) -----------------

  /** GET /repos/:repoId/context. `null` => the repo does not exist in this workspace (route 404s). */
  async listForRepo(workspaceId: string, repoId: string): Promise<ContextDocumentList | null> {
    const repo = await this.repo.getRepoForWorkspace(workspaceId, repoId);
    if (!repo) return null;

    const cloneDirAbs = this.deps.git.clonePathFor({ owner: repo.owner, name: repo.name });
    const uploadDirAbs = this.uploadDirFor(workspaceId, repoId);

    const [walkResult, uploadFiles, directUsage, skillUsage] = await Promise.all([
      this.listDocuments(cloneDirAbs, this.deps.config.contextSearchRoots),
      this.listUploadedDocs(uploadDirAbs),
      this.repo.getDirectUsage(repoId),
      this.repo.getSkillUsage(repoId),
    ]);
    const usage = computeUsageCounts(directUsage, skillUsage);

    const repoDocs = await Promise.all(
      walkResult.files.map((f) => this.buildContextDocument(cloneDirAbs, f, 'repo', usage)),
    );
    const uploadDocs = await Promise.all(
      uploadFiles.map((f) => this.buildContextDocument(uploadDirAbs, f, 'upload', usage)),
    );
    const documents = [...repoDocs, ...uploadDocs].filter((d): d is ContextDocument => d !== null);

    return {
      documents,
      total: documents.length,
      bounded: walkResult.stats.bounded,
      bound: walkResult.stats.bound,
    };
  }

  /** GET /repos/:repoId/context/preview. Read-only: never writes, never touches mtime (AC-3). */
  async previewDocument(workspaceId: string, repoId: string, path: string): Promise<PreviewOutcome> {
    const repo = await this.repo.getRepoForWorkspace(workspaceId, repoId);
    if (!repo) return { ok: false, reason: 'repo_not_found' };

    const cloneDirAbs = this.deps.git.clonePathFor({ owner: repo.owner, name: repo.name });
    const uploadDirAbs = this.uploadDirFor(workspaceId, repoId);

    const fromClone = await this.tryReadWithin(cloneDirAbs, path);
    if (fromClone) return { ok: true, doc: fromClone };
    const fromUpload = await this.tryReadWithin(uploadDirAbs, path);
    if (fromUpload) return { ok: true, doc: fromUpload };

    // Neither root could produce bytes. Distinguish "escapes both roots"
    // (REQ-30 — refuse, never open) from "resolves but nothing is there"
    // (a plain 404) by re-checking containment alone, with no read.
    const [containedInClone, containedInUpload] = await Promise.all([
      resolveWithinRoot(cloneDirAbs, path),
      resolveWithinRoot(uploadDirAbs, path),
    ]);
    if (containedInClone === null && containedInUpload === null) {
      return { ok: false, reason: 'escaped' };
    }
    return { ok: false, reason: 'not_found' };
  }

  /**
   * POST /repos/:repoId/context/upload. REQ-4/REQ-31: `.md` only, within the
   * 400 KB bound, the stored filename is `path.basename` of the submitted
   * one — never the raw browser-submitted name — and it is written only
   * under `<contextUploadDir>/<workspaceId>/<repoId>/`.
   */
  async uploadDocument(
    workspaceId: string,
    repoId: string,
    filename: string,
    content: string,
  ): Promise<ContextDocument> {
    const repo = await this.repo.getRepoForWorkspace(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');

    const safeName = basename(filename);
    if (safeName.length === 0 || extname(safeName).toLowerCase() !== CONTEXT_DOC_EXT) {
      throw new ValidationError(`Only ${CONTEXT_DOC_EXT} files can be uploaded`, { filename: safeName });
    }
    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > MAX_FILE_SIZE) {
      throw new ValidationError('Document exceeds the 400 KB upload limit', { path: safeName });
    }

    const uploadDirAbs = this.uploadDirFor(workspaceId, repoId);
    const targetPath = join(uploadDirAbs, safeName);
    // basename() alone already strips `..`/separators; re-confirm containment
    // defensively rather than trust that invariant silently (REQ-30's rule
    // applied to the WRITE side, not just the read side).
    const contained = await resolveWithinRoot(uploadDirAbs, safeName);
    if (contained === null) {
      throw new ValidationError('Invalid upload filename', { filename: safeName });
    }

    try {
      await mkdir(uploadDirAbs, { recursive: true });
      await writeFile(targetPath, content, 'utf8');
    } catch (err) {
      // Edge case: "The upload target directory is not writable" — name the
      // directory in the error, leave the existing listing untouched.
      throw new AppError(
        'upload_write_failed',
        `Could not write to the upload directory: ${uploadDirAbs}`,
        500,
        { cause: err instanceof Error ? err.message : String(err) },
      );
    }

    const st = await stat(targetPath);
    return {
      path: safeName,
      content: null,
      size: st.size,
      updated_at: new Date(st.mtimeMs).toISOString(),
      type: 'docs',
      token_estimate: estimateTokens(safeName, st.size, st.mtimeMs, content.length),
      oversized: false, // already rejected above
      source: 'upload',
      used_by_agents: 0, // a brand-new path — nothing could have attached to it yet
      used_by_disabled_skill_only: 0,
    };
  }

  // ---- Attachments (routes.ts callers) -----------------------------------

  /** GET /agents|skills/:id/context. `null` => owner not found in this workspace, or repo not found. */
  async getAttachments(
    owner: OwnerId,
    workspaceId: string,
    repoId: string,
  ): Promise<ContextAttachResponse | null> {
    const ownerOk =
      owner.kind === 'agent'
        ? await this.repo.agentExistsInWorkspace(workspaceId, owner.id)
        : await this.repo.skillExistsInWorkspace(workspaceId, owner.id);
    if (!ownerOk) return null;
    const repo = await this.repo.getRepoForWorkspace(workspaceId, repoId);
    if (!repo) return null;

    const rows = await this.repo.listAttachments(owner, repoId);
    return { repo_id: repoId, paths: rows.map((r) => r.path) };
  }

  /**
   * POST /agents|skills/:id/context — the replace-set write (NFR-5). REQ-8
   * validates each named path against the 400 KB bound before persisting;
   * REQ-30 refuses any path that resolves outside both roots. A path that
   * resolves but is not currently readable (deleted since discovery) is NOT
   * refused here — AC-23 handles a missing document at RUN time, and the
   * spec never requires a document to exist at attach time.
   */
  async setAttachments(
    owner: OwnerId,
    workspaceId: string,
    repoId: string,
    paths: string[],
  ): Promise<ContextAttachResponse> {
    const ownerOk =
      owner.kind === 'agent'
        ? await this.repo.agentExistsInWorkspace(workspaceId, owner.id)
        : await this.repo.skillExistsInWorkspace(workspaceId, owner.id);
    if (!ownerOk) {
      throw new NotFoundError(owner.kind === 'agent' ? 'Agent not found' : 'Skill not found');
    }
    const repo = await this.repo.getRepoForWorkspace(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');

    const cloneDirAbs = this.deps.git.clonePathFor({ owner: repo.owner, name: repo.name });
    const uploadDirAbs = this.uploadDirFor(workspaceId, repoId);

    for (const path of paths) {
      const outcome = await this.statAttachedPath(cloneDirAbs, uploadDirAbs, path);
      if (outcome === 'escaped') {
        throw new ValidationError('Path is outside the allowed directories', { path });
      }
      if (typeof outcome === 'number' && outcome > MAX_FILE_SIZE) {
        throw new ValidationError('Document exceeds the 400 KB attach limit', { path });
      }
    }

    await this.repo.replaceAttachments(owner, workspaceId, repoId, paths);
    return { repo_id: repoId, paths };
  }

  // ---- Private helpers ----------------------------------------------------

  private uploadDirFor(workspaceId: string, repoId: string): string {
    return join(this.deps.config.contextUploadDir, workspaceId, repoId);
  }

  private async tryReadWithin(baseDir: string, path: string): Promise<ContextPreviewResponse | null> {
    const resolved = await resolveWithinRoot(baseDir, path);
    if (resolved === null) return null;
    try {
      const content = await readFile(resolved, 'utf8');
      const st = await stat(resolved);
      return { path, content, size: st.size, updated_at: new Date(st.mtimeMs).toISOString() };
    } catch {
      return null;
    }
  }

  /** Resolves `path` against both roots; returns its byte size, `'escaped'`, or `null` (contained but absent). */
  private async statAttachedPath(
    cloneDirAbs: string,
    uploadDirAbs: string,
    path: string,
  ): Promise<number | null | 'escaped'> {
    for (const baseDir of [cloneDirAbs, uploadDirAbs]) {
      const resolved = await resolveWithinRoot(baseDir, path);
      if (resolved === null) continue;
      try {
        const st = await stat(resolved);
        return st.size;
      } catch {
        continue; // contained but nothing there yet — keep checking the other root
      }
    }
    const [containedInClone, containedInUpload] = await Promise.all([
      resolveWithinRoot(cloneDirAbs, path),
      resolveWithinRoot(uploadDirAbs, path),
    ]);
    return containedInClone === null && containedInUpload === null ? 'escaped' : null;
  }

  /** Flat (non-recursive) `.md` listing of the upload dir — its own layout has no `specs`/`docs`/`insights` ancestor for T5's walk to key off. Type badge defaults to `docs` (an implementer discretion call — see this task's report). */
  private async listUploadedDocs(uploadDirAbs: string): Promise<DocFile[]> {
    let entries: Dirent[];
    try {
      entries = (await readdir(uploadDirAbs, { withFileTypes: true })) as Dirent[];
    } catch {
      return []; // no uploads yet for this (workspace, repo)
    }
    const out: DocFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (extname(entry.name).toLowerCase() !== CONTEXT_DOC_EXT) continue;
      const full = join(uploadDirAbs, entry.name);
      try {
        const st = await stat(full);
        out.push({
          path: entry.name,
          type: 'docs',
          size: st.size,
          mtimeMs: st.mtimeMs,
          oversized: st.size > MAX_FILE_SIZE,
        });
      } catch {
        continue; // vanished between readdir and stat
      }
    }
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return out;
  }

  /** `DocFile` + usage counts → the wire `ContextDocument` (AC-2's token estimate needs the actual char count, so this reads the file once). */
  private async buildContextDocument(
    baseDir: string,
    file: DocFile,
    source: ContextDocSource,
    usage: Map<string, UsageCounts>,
  ): Promise<ContextDocument | null> {
    let chars: number;
    try {
      const content = await readFile(join(baseDir, file.path), 'utf8');
      chars = content.length;
    } catch {
      return null; // vanished between the walk and this read — drop it rather than list a phantom row
    }
    const counts = usage.get(file.path) ?? { usedByAgents: 0, usedByDisabledSkillOnly: 0 };
    return {
      path: file.path,
      content: null,
      size: file.size,
      updated_at: new Date(file.mtimeMs).toISOString(),
      type: file.type,
      token_estimate: estimateTokens(file.path, file.size, file.mtimeMs, chars),
      oversized: file.oversized,
      source,
      used_by_agents: counts.usedByAgents,
      used_by_disabled_skill_only: counts.usedByDisabledSkillOnly,
    };
  }
}
