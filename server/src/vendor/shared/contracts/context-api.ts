import { z } from 'zod';
import { SpecFile } from './platform.js';

/**
 * Project Context API — the wire contract for `server/specs/SPEC-01-project-context.md`.
 *
 * Discovery, preview, attachment and upload of the `.md` documents (`specs`/`docs`/`insights`)
 * a reviewer agent or skill can read at run time under the `## Project context` prompt heading.
 * `SpecFile` (`contracts/platform.ts:281`) already carries `path`/`content`/`size`/`updated_at`
 * and is reused here via `.extend()` rather than re-declared — `updated_at` doubles as the
 * document's mtime (spec §"Inputs and provenance": "Document path, size, mtime … Contract:
 * `SpecFile`").
 */

// ---- Discovery (AC-1) ----

/** The nearest `specs` | `docs` | `insights` ancestor directory a document was found under. */
export const ContextDocType = z.enum(['specs', 'docs', 'insights']);
export type ContextDocType = z.infer<typeof ContextDocType>;

/** Where a document's bytes live: discovered in the repo checkout, or uploaded (AC-4). */
export const ContextDocSource = z.enum(['repo', 'upload']);
export type ContextDocSource = z.infer<typeof ContextDocSource>;

/**
 * One document row, as listed on the Project Context page and in both `Context` tabs
 * (AC-1, AC-6, AC-7, AC-8). Extends `SpecFile` — `path`/`size`/`updated_at` (mtime) — with the
 * fields this feature adds; `content` stays `SpecFile`'s own nullish field and is not populated
 * by the list endpoint (see `ContextPreviewResponse` for that).
 */
export const ContextDocument = SpecFile.extend({
  type: ContextDocType,
  /** `ceil(chars / 4)`, server-computed (AC-2, NFR-2). Client renders it with a `≈` prefix. */
  token_estimate: z.number().int(),
  /** `true` once the file's on-disk size exceeds the 400 KB bound (AC-8, NFR-4). */
  oversized: z.boolean(),
  source: ContextDocSource,
  /**
   * REQ-7's `Used by N agents` chip (AC-7): every agent in the workspace — enabled or not —
   * that reaches this document under AC-18's traversal with the `skills.enabled` filter removed.
   */
  used_by_agents: z.number().int(),
  /**
   * Of `used_by_agents`, how many reach this document ONLY through a disabled skill — the
   * `(1 via a disabled skill)` parenthetical (AC-7). A subset of `used_by_agents`, never summed
   * into it by the client.
   */
  used_by_disabled_skill_only: z.number().int(),
});
export type ContextDocument = z.infer<typeof ContextDocument>;

/** `GET /repos/:repoId/context` response. */
export const ContextDocumentList = z.object({
  documents: z.array(ContextDocument),
  total: z.number().int(),
  /** `true` once the walk hit NFR-4's 5,000-candidate-file bound before exhausting the search roots (AC-9). */
  bounded: z.boolean(),
  /** The bound itself, so the client can name it verbatim (e.g. "the first 5,000 files") — NFR-4. */
  bound: z.number().int(),
});
export type ContextDocumentList = z.infer<typeof ContextDocumentList>;

// ---- Preview (AC-3) ----

/**
 * A single document's current text, read on demand for the preview pane. Reuses `SpecFile`
 * as-is — the shape already carries `content`, which the list response leaves unset.
 */
export const ContextPreviewResponse = SpecFile;
export type ContextPreviewResponse = z.infer<typeof ContextPreviewResponse>;

// ---- Attachment (AC-10 through AC-18; NFR-5) ----

/**
 * The replace-set write behind an agent's or skill's `Context` tab (NFR-5): the COMPLETE
 * ordered list of attached paths for one owner, scoped to one repository. Never a partial
 * diff — the server does not reconcile adds/removes against a prior set.
 */
export const ContextAttachRequest = z.object({
  repo_id: z.string().uuid(),
  /** Complete ordered set of repository-relative paths; position = index in this array. */
  paths: z.array(z.string()),
});
export type ContextAttachRequest = z.infer<typeof ContextAttachRequest>;

/**
 * Echoes what was persisted. Per NFR-5, the client does NOT apply this to the rendered rows —
 * it keeps the order it already holds, which is what keeps AC-14 true across a round trip.
 */
export const ContextAttachResponse = z.object({
  repo_id: z.string().uuid(),
  paths: z.array(z.string()),
});
export type ContextAttachResponse = z.infer<typeof ContextAttachResponse>;

// ---- Upload (AC-4, AC-31) ----

/**
 * Body of the upload endpoint. No multipart plugin is added for this: the file's text travels
 * as a plain JSON string, comfortably inside Fastify's existing 1 MB `bodyLimit` (`app.ts:49`)
 * for the 400 KB per-document bound (AC-8, NFR-4). The stored filename is derived server-side
 * with `path.basename` (AC-31) — `filename` here is the untrusted, browser-submitted name.
 */
export const ContextUploadRequest = z.object({
  filename: z.string().min(1),
  content: z.string(),
});
export type ContextUploadRequest = z.infer<typeof ContextUploadRequest>;
