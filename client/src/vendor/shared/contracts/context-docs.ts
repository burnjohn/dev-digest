import { z } from 'zod';

/**
 * Project Context Folder contracts.
 * Consumed by: client Project Context page, Agent Editor Context tab, Skill
 * editor "Project context to use" section, `context-docs` server module.
 *
 * Attachments are stored as PATHS ONLY — never document text (see AC-7).
 */

// ---- Context document (list item — Project Context page and editor rows) ----
// `source` and `coverage` are v2 additions (design-mock parity):
//   - source: where the effective content comes from — `clone` (file only),
//     `overlay` (edited file, overlay wins), or `overlay-only` (uploaded, no
//     clone file). Computed at read/merge time, never stored (AC-25/AC-27).
//   - coverage: used_by_agents ÷ total workspace agents × 100, `0` when the
//     workspace has no agents (AC-28).
export const ContextDocument = z.object({
  path: z.string(),
  category: z.string(),
  token_count: z.number().int().min(0),
  used_by_agents: z.number().int().min(0),
  coverage: z.number().int().min(0).max(100),
  source: z.enum(['clone', 'overlay', 'overlay-only']),
});
export type ContextDocument = z.infer<typeof ContextDocument>;

// ---- Single document content (GET /repos/:id/context-docs/content?path=…) ----
// Overlay-aware read: `content` is the effective body (overlay if present, else
// clone file) and `source` reports which one it was (AC-23/AC-25).
export const ContextDocContent = z.object({
  path: z.string(),
  content: z.string(),
  source: z.enum(['clone', 'overlay', 'overlay-only']),
});
export type ContextDocContent = z.infer<typeof ContextDocContent>;

// ---- Edit/upload request (PUT /repos/:id/context-docs) ----
// Single upsert endpoint for both "edit an existing doc" (AC-24) and
// "create/upload a new one" (AC-27/AC-32). `body` may be empty (an empty
// document is valid — 0 tokens); `path` non-empty and (in the service, not
// here) confined to a configured root folder + `.md` extension.
export const SaveContextDocBody = z.object({ path: z.string().min(1), body: z.string() });
export type SaveContextDocBody = z.infer<typeof SaveContextDocBody>;

// ---- Delete request (DELETE /repos/:id/context-docs) ----
// Removes the overlay row (AC-34); the clone file, if any, is never touched.
export const DeleteContextDocBody = z.object({ path: z.string().min(1) });
export type DeleteContextDocBody = z.infer<typeof DeleteContextDocBody>;

// ---- Repo root-folder configuration (PUT /repos/:id/context-folders) ----
export const ContextFolders = z.object({
  folders: z.array(z.string().min(1)),
});
export type ContextFolders = z.infer<typeof ContextFolders>;

// ---- Attachment request body (per agent and per skill) ----
export const ContextDocAttachment = z.object({
  document_paths: z.array(z.string()),
});
export type ContextDocAttachment = z.infer<typeof ContextDocAttachment>;

// ---- Attachment response shapes (GET /agents/:id/context-docs, GET /skills/:id/context-docs) ----
export const AgentContextDocLink = z.object({
  owner_id: z.string(),
  path: z.string(),
  order: z.number().int(),
});
export type AgentContextDocLink = z.infer<typeof AgentContextDocLink>;

export const SkillContextDocLink = z.object({
  owner_id: z.string(),
  path: z.string(),
  order: z.number().int(),
});
export type SkillContextDocLink = z.infer<typeof SkillContextDocLink>;
