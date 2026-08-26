/**
 * context module — local types + the `ContextDocs` port interface.
 *
 * SPEC-01 (Project Context). This module's pure layer (`helpers.ts`,
 * `pipeline/walk-docs.ts`) produces the shapes below; `ContextDocs` is the
 * facade `container.contextDocs` will expose so a review run
 * (`modules/reviews/run-executor.ts`) can reach this module's read surface
 * without importing it directly — `modules/**` may not import another
 * module (onion §2 rule 2), so a port on the container is the only door,
 * exactly as `container.repoIntel` already is for `repo-intel`
 * (`modules/repo-intel/types.ts` is the precedent this is modelled on).
 */
import type { ContextDocType } from '../../vendor/shared/contracts/context-api.js';

// ---------------------------------------------------------------------------
// Discovery (the bounded walk) — pipeline/walk-docs.ts
// ---------------------------------------------------------------------------

/**
 * One `.md` document found by the walk, before any contract mapping (no
 * `token_estimate`, `source`, or `used_by_agents` — those are the service's
 * job in a later task). Pure filesystem facts only.
 */
export interface DocFile {
  /** Forward-slash, repository-relative (relative to `cloneDir`). */
  path: string;
  /** The nearest `specs`/`docs`/`insights` ancestor directory name (AC-1). */
  type: ContextDocType;
  /** Bytes on disk. */
  size: number;
  /** `Stats.mtimeMs` — maps onto `ContextDocument.updated_at` (an ISO string) at the contract boundary; never carried as a second, parallel field. */
  mtimeMs: number;
  /** `true` once `size` exceeds `MAX_FILE_SIZE` (AC-8) — listed, never dropped. */
  oversized: boolean;
}

/** Why a configured search root did not contribute to the walk (REQ-37). */
export type SkippedRootReason = 'missing' | 'escaped';

export interface SkippedRoot {
  /** The configured root value, verbatim. */
  root: string;
  reason: SkippedRootReason;
}

export interface WalkDocsStats {
  /** Matching `.md` files found across every surviving root, before the AC-9 bound is applied. */
  totalCandidates: number;
  /** `true` once `totalCandidates` exceeded `MAX_INDEXED_FILES` (AC-9). */
  bounded: boolean;
  /** The bound itself, so the caller can name it verbatim (AC-9, NFR-4). */
  bound: number;
  /** Roots skipped because they did not exist on disk, or resolved outside `cloneDir` (REQ-37). */
  skippedRoots: SkippedRoot[];
}

export interface WalkDocsResult {
  files: DocFile[];
  stats: WalkDocsStats;
}

// ---------------------------------------------------------------------------
// Run-time read (helpers.ts::formatDocBlock + resolveWithinRoot)
// ---------------------------------------------------------------------------

export interface ReadDocumentResult {
  /** The document's raw body text, exactly as read from disk — never split, never CRLF-normalised. */
  body: string;
  /** REQ-21 — `### <path>` on its own first line, then `body` verbatim. What reaches the `specs` prompt slot. */
  block: string;
}

/**
 * The module's cross-boundary read surface (see file header). T7 implements
 * it over this task's pure walk + helpers; T12 (`run-executor`) consumes it
 * through `container.contextDocs`.
 */
export interface ContextDocs {
  /** AC-1, AC-9, NFR-1, REQ-37 — the bounded, ancestor-filtered document walk. */
  listDocuments(cloneDir: string, searchRoots: string[]): Promise<WalkDocsResult>;

  /**
   * AC-20/AC-21/AC-23/AC-30 — read one document's CURRENT text from disk
   * (a repo clone or the upload dir, whichever `baseDir` is) and format it
   * as the `### <path>` block for the `## Project context` slot, refusing a
   * `relativePath` that resolves outside `baseDir`. Returns `null` for a
   * missing, unreadable, or out-of-bounds document — the caller is the one
   * that turns that into a `missing` manifest entry (AC-23); this method
   * never throws for it.
   */
  readDocument(baseDir: string, relativePath: string): Promise<ReadDocumentResult | null>;

  /**
   * T7 addition to this port (see this file's header — T7 owns this file
   * too, per its integrator notes; T5's two methods above are unchanged).
   *
   * AC-18/REQ-18 — the SINGLE effective-document-list rule the run uses: an
   * agent's own attachments in stored position order, followed by each
   * ENABLED linked skill's attachments in `agent_skills.order`, restricted
   * to `repoId`, de-duplicated by path with the earliest occurrence kept.
   * `T12` (`run-executor`) consumes this through `container.contextDocs`
   * instead of re-deriving the traversal — this is the "exported" rule the
   * plan's T7 block refers to. Returns repository-relative paths only; the
   * caller reads each one via `readDocument`.
   */
  resolveEffectiveAttachments(agentId: string, repoId: string): Promise<string[]>;
}
