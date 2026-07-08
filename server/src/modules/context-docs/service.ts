import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import type { ContextDocument, ContextDocContent } from '@devdigest/shared';
import { ContextDocsRepository } from './repository.js';
import { MAX_OVERLAY_BODY_CHARS } from './constants.js';
import {
  resolveConfinedPath,
  resolveEffectiveContent,
  isPathShapeValid,
  toContextDocumentDto,
} from './helpers.js';

/** A discovered document's metadata BEFORE the (uncached) used_by_agents merge. */
interface DiscoveredDoc {
  path: string;
  tokenCount: number;
}

/** In-process discovery cache entry — everything EXCEPT used_by_agents. */
interface CacheEntry {
  headSha: string;
  foldersKey: string;
  docs: DiscoveredDoc[];
}

/** Deterministic, order-independent hash of the configured folder set. */
function foldersKeyOf(folders: string[]): string {
  return [...folders].sort().join(' ');
}

/**
 * A safe root folder name is a single path segment: no `/`/`\` separators,
 * not `.`/`..`, and never containing `..` (defends against a joined path
 * escaping the clone root, e.g. `../../..`). Used both at configuration time
 * (`setContextFolders`, reject) and defensively at walk time
 * (`walkAndTokenize`, skip) so a bad value already persisted can never drive
 * an out-of-clone `readdir`.
 */
function isSafeFolderName(folder: string): boolean {
  if (folder.includes('/') || folder.includes('\\')) return false;
  if (folder === '.' || folder === '..') return false;
  if (folder.includes('..')) return false;
  return true;
}

/**
 * ContextDocsService — discovery (walk + tokenize), root-folder config, and
 * attachment orchestration for the context-docs module.
 *
 * Zero LLM calls (AC-3) — never touches `container.llm`. Token counts come
 * from `container.tokenizer.count()` only.
 *
 * Discovery (the clone walk + per-document tokenization) is cached in-process
 * per repo, keyed by the repo's current clone HEAD commit + a hash of the
 * effective `context_folders` (§4 Caching). `used_by_agents` is intentionally
 * NOT part of the cached entry — it changes independently on attach/detach —
 * and is recomputed + merged on every call to `listDocuments`.
 */
export class ContextDocsService {
  private _repo: ContextDocsRepository | null = null;
  private discoveryCache = new Map<string, CacheEntry>();

  constructor(private container: Container) {}

  private get repo(): ContextDocsRepository {
    if (!this._repo) {
      this._repo = new ContextDocsRepository(this.container.db);
    }
    return this._repo;
  }

  /**
   * List documents for a repo: the clone-discovered `.md` inventory UNIONED
   * with the repo's overlay documents (AC-25/AC-27/AC-36). The union is what
   * makes a no-clone repo still surface its uploaded overlays — it runs
   * unconditionally, never gated on `clonePath` or on `discovered` being
   * non-empty. Per document:
   *   - `source`   = overlay (has clone) / overlay-only (no clone) / clone
   *   - `token_count` = recomputed from the OVERLAY body for overlaid paths
   *                     (the overlay is the effective content), else the
   *                     cached clone token count
   *   - `coverage` = used_by_agents ÷ total workspace agents × 100 (0 on no agents)
   *
   * Returns `[]` (never throws) when neither a clone inventory nor any overlay
   * exists — AC-18's empty-state precondition.
   */
  async listDocuments(workspaceId: string, repoId: string): Promise<ContextDocument[]> {
    const repoRow = await this.repo.getRepoForDiscovery(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    const discovered = await this.discoverDocuments(repoId, repoRow); // clone-only, cached
    const usedBy = await this.repo.usedByCounts(workspaceId);
    // AC-36: the overlay fetch is UNCONDITIONAL — never gated behind a clone
    // check — so a repo with no clone still gets its overlay docs merged in.
    const overlays = await this.repo.listOverlays(repoId);
    const total = await this.repo.countWorkspaceAgents(workspaceId);

    const cloneTokenByPath = new Map(discovered.map((d) => [d.path, d.tokenCount]));
    const clonePaths = new Set(discovered.map((d) => d.path));
    const overlayByPath = new Map(overlays.map((o) => [o.path, o.body]));

    // Union: clone-discovered paths first (discovery order), then overlay-only.
    const allPaths = new Set<string>([...clonePaths, ...overlayByPath.keys()]);

    const coverageFor = (used: number): number =>
      total === 0 ? 0 : Math.round((used / total) * 100);

    const docs: ContextDocument[] = [];
    for (const docPath of allPaths) {
      const overlayBody = overlayByPath.get(docPath);
      const hasClone = clonePaths.has(docPath);
      let tokenCount: number;
      let source: ContextDocument['source'];
      if (overlayBody !== undefined) {
        // Overlay wins: recompute token count from the overlay body (uncached,
        // per §4 v2 Recommendation 1 — a handful of docs, DB-only, no FS I/O).
        tokenCount = this.container.tokenizer.count(overlayBody);
        source = hasClone ? 'overlay' : 'overlay-only';
      } else {
        tokenCount = cloneTokenByPath.get(docPath) ?? 0;
        source = 'clone';
      }
      const used = usedBy.get(docPath) ?? 0;
      docs.push(toContextDocumentDto(docPath, tokenCount, used, coverageFor(used), source));
    }
    return docs;
  }

  /**
   * Clone-walk discovery + tokenization, behind the in-process cache. Returns
   * ONLY clone-file documents — callers (`listDocuments`) must NOT treat an
   * empty result as "nothing to show", because overlay documents are merged in
   * separately, outside this cache (AC-36). A cache hit skips the filesystem
   * walk (and every `readFile`/`tokenizer.count` call) entirely.
   *
   * For a repo with no clone / an unreachable clone (null `clonePath` or a
   * throwing `currentHead`), this legitimately produces `[]` and caches it
   * under a `'no-clone'` sentinel head sha keyed by the folder set — so we
   * record "checked, nothing to walk" and don't re-attempt a failing
   * `currentHead` on every request. The overlay merge in `listDocuments` runs
   * outside this cache and therefore still picks up uploads/edits immediately
   * even when this cached clone-walk result is a stable empty array.
   * Invalidated by a HEAD-sha change and explicitly by `setContextFolders`.
   */
  private async discoverDocuments(
    repoId: string,
    repoRow: { clonePath: string | null; owner: string; name: string; folders: string[] },
  ): Promise<DiscoveredDoc[]> {
    const foldersKey = foldersKeyOf(repoRow.folders);

    let headSha = 'no-clone';
    let cloneRoot: string | null = null;
    let repoRef: { owner: string; name: string } | null = null;
    if (repoRow.clonePath) {
      repoRef = { owner: repoRow.owner, name: repoRow.name };
      cloneRoot = this.container.git.clonePathFor(repoRef);
      try {
        headSha = await this.container.git.currentHead(repoRef);
      } catch {
        // Clone path recorded but unreachable/corrupt — fall back to the
        // sentinel; nothing to walk, but we still cache the empty result.
        headSha = 'no-clone';
        cloneRoot = null;
      }
    }

    const cached = this.discoveryCache.get(repoId);
    if (cached && cached.headSha === headSha && cached.foldersKey === foldersKey) {
      return cached.docs;
    }

    const docs =
      cloneRoot && repoRef ? await this.walkAndTokenize(cloneRoot, repoRef, repoRow.folders) : [];
    this.discoveryCache.set(repoId, { headSha, foldersKey, docs });
    return docs;
  }

  /**
   * Walk each configured folder under the clone root (never the whole clone —
   * avoids `.git`/`node_modules`), collect `*.md` files, read + tokenize each.
   */
  private async walkAndTokenize(
    cloneRoot: string,
    repoRef: { owner: string; name: string },
    folders: string[],
  ): Promise<DiscoveredDoc[]> {
    const relativePaths: string[] = [];

    for (const folder of folders) {
      // Defensive re-check: a bad value already persisted (e.g. written
      // before this guard existed, or via direct DB access) must never drive
      // an out-of-clone `readdir` — skip mechanically, same as a missing folder.
      if (!isSafeFolderName(folder)) continue;

      const folderAbs = path.join(cloneRoot, folder);
      let entries: import('node:fs').Dirent[];
      try {
        entries = await readdir(folderAbs, { withFileTypes: true, recursive: true });
      } catch {
        // Folder doesn't exist in this clone — skip, not an error.
        continue;
      }

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        // `entry.parentPath`/`entry.path` (Node ≥20) is the absolute dir
        // containing the entry; fall back to `folderAbs` for older typings.
        const parentAbs =
          (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
          (entry as unknown as { path?: string }).path ??
          folderAbs;
        const absPath = path.join(parentAbs, entry.name);
        const relPath = path.relative(cloneRoot, absPath).replace(/\\/g, '/');
        relativePaths.push(relPath);
      }
    }

    const docs: DiscoveredDoc[] = [];
    for (const relPath of relativePaths) {
      // Re-confine every discovered path defensively — discovery walked only
      // configured folders, so this should always pass; the check stays
      // mechanical/cheap and keeps discovery and read-time confinement
      // exercising the exact same gate (AC-13).
      const confined = resolveConfinedPath(cloneRoot, folders, relPath);
      if (!confined) continue;

      let content: string;
      try {
        content = await this.container.git.readFile(repoRef, relPath);
      } catch {
        continue;
      }
      const tokenCount = this.container.tokenizer.count(content);
      docs.push({ path: relPath, tokenCount });
    }

    return docs;
  }

  /**
   * Read a single document's EFFECTIVE content (overlay if present, else the
   * clone file) for preview/edit (AC-23/AC-25). Supersedes v1's
   * `previewDocument`: the return shape gains `source`, and the overlay is
   * preferred over the clone. Confinement is re-validated fresh via the
   * clone-root-free `isPathShapeValid` (AC-13) so an overlay-only path on a
   * no-clone repo still validates. Returns `undefined` (→ 404) when the path
   * is not confined or neither an overlay nor a clone file exists.
   */
  async getDocumentContent(
    workspaceId: string,
    repoId: string,
    docPath: string,
  ): Promise<ContextDocContent | undefined> {
    const repoRow = await this.repo.getRepoForDiscovery(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    if (!isPathShapeValid(repoRow.folders, docPath)) return undefined;

    const overlay = await this.repo.getOverlay(repoId, docPath);

    let cloneContent: string | undefined;
    if (repoRow.clonePath) {
      const repoRef = { owner: repoRow.owner, name: repoRow.name };
      try {
        cloneContent = await this.container.git.readFile(repoRef, docPath);
      } catch {
        cloneContent = undefined;
      }
    }

    const effective = resolveEffectiveContent(cloneContent, overlay?.body);
    if (!effective) return undefined;
    return { path: docPath, content: effective.content, source: effective.source };
  }

  /**
   * Create or update an overlay document (AC-24/AC-27) — the single upsert that
   * backs both "edit" and "create/upload". NEVER writes to the clone or the git
   * remote; the edit persists only in `doc_overrides`. Validates: `.md`
   * extension, body size cap, and clone-root-free path confinement (AC-13).
   * Returns the resulting document DTO (token count from the new body; `source`
   * = overlay when a clone file exists at the path, else overlay-only).
   */
  async saveDocument(
    workspaceId: string,
    repoId: string,
    docPath: string,
    body: string,
  ): Promise<ContextDocument> {
    const repoRow = await this.repo.getRepoForDiscovery(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    if (!docPath.toLowerCase().endsWith('.md')) {
      throw new ValidationError('Document path must end in ".md"');
    }
    if (body.length > MAX_OVERLAY_BODY_CHARS) {
      throw new ValidationError('Document body is too large');
    }
    if (!isPathShapeValid(repoRow.folders, docPath)) {
      throw new ValidationError('Path must be under a configured root folder');
    }

    await this.repo.upsertOverlay(repoId, docPath, body);

    // Classify source via the cached clone-discovered path set (no fresh FS read).
    const discovered = await this.discoverDocuments(repoId, repoRow);
    const hasClone = discovered.some((d) => d.path === docPath);
    const usedBy = await this.repo.usedByCounts(workspaceId);
    const total = await this.repo.countWorkspaceAgents(workspaceId);
    const used = usedBy.get(docPath) ?? 0;
    const coverage = total === 0 ? 0 : Math.round((used / total) * 100);
    const tokenCount = this.container.tokenizer.count(body);
    return toContextDocumentDto(
      docPath,
      tokenCount,
      used,
      coverage,
      hasClone ? 'overlay' : 'overlay-only',
    );
  }

  /**
   * Delete a document's overlay row (AC-34). NEVER touches clone files — the
   * clone is read-only. `reverted` reports the PRESENTATION consequence: `true`
   * if a clone file exists at the path (the document reverts to clone content),
   * `false` if it was overlay-only (the document disappears). Classification
   * uses the cached clone-discovered set, not a fresh clone read.
   */
  async deleteDocument(
    workspaceId: string,
    repoId: string,
    docPath: string,
  ): Promise<{ reverted: boolean }> {
    const repoRow = await this.repo.getRepoForDiscovery(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const deleted = await this.repo.deleteOverlay(repoId, docPath);
    if (!deleted) throw new NotFoundError('Document overlay not found');
    const discovered = await this.discoverDocuments(repoId, repoRow);
    return { reverted: discovered.some((d) => d.path === docPath) };
  }

  /**
   * Thin, no-workspace-guard passthrough used by `run-executor.ts` at injection
   * time (Step 13). Safe without a workspace guard here because the caller
   * already resolved `repo` from a workspace-scoped lookup before invoking it —
   * mirrors the documented boundary for `agentAttachments`/`skillAttachments`.
   */
  async getOverlayForInjection(
    repoId: string,
    docPath: string,
  ): Promise<{ body: string } | undefined> {
    const overlay = await this.repo.getOverlay(repoId, docPath);
    return overlay ? { body: overlay.body } : undefined;
  }

  /** Effective context folders for a repo (default set when unconfigured). */
  async getContextFolders(workspaceId: string, repoId: string): Promise<string[]> {
    const folders = await this.repo.getContextFolders(workspaceId, repoId);
    if (folders === undefined) throw new NotFoundError('Repo not found');
    return folders;
  }

  /**
   * Set a repo's configured root folders. Invalidates the repo's discovery
   * cache entry (folder change alters discovery scope) — the next
   * `listDocuments` call re-walks the clone.
   */
  async setContextFolders(workspaceId: string, repoId: string, folders: string[]): Promise<void> {
    if (folders.some((f) => f.trim().length === 0)) {
      throw new ValidationError('Folder names must not be empty');
    }
    if (folders.some((f) => !isSafeFolderName(f))) {
      throw new ValidationError(
        'Folder names must be a single path segment (no "/", "\\", ".", or "..")',
      );
    }
    const ok = await this.repo.setContextFolders(workspaceId, repoId, folders);
    if (!ok) throw new NotFoundError('Repo not found');
    this.discoveryCache.delete(repoId);
  }

  // ---- agent/skill attachments ---------------------------------------------
  //
  // Ownership boundary: these methods do NOT re-validate that `agentId`/
  // `skillId` belong to `workspaceId` — that guard already happened in the
  // caller (`AgentsService.get`/`SkillsService.get` 404-check) BEFORE
  // delegating here, per the Step 4/5 split documented in the plan. Do not
  // call these directly from a route without that upstream guard.

  async agentAttachments(agentId: string): Promise<{ path: string; order: number }[]> {
    return this.repo.agentAttachments(agentId);
  }

  async setAgentAttachments(
    agentId: string,
    paths: string[],
  ): Promise<{ path: string; order: number }[]> {
    await this.repo.setAgentAttachments(agentId, paths);
    return this.repo.agentAttachments(agentId);
  }

  async skillAttachments(skillId: string): Promise<{ path: string; order: number }[]> {
    return this.repo.skillAttachments(skillId);
  }

  async setSkillAttachments(
    skillId: string,
    paths: string[],
  ): Promise<{ path: string; order: number }[]> {
    await this.repo.setSkillAttachments(skillId, paths);
    return this.repo.skillAttachments(skillId);
  }
}
