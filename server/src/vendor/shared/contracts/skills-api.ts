import { z } from 'zod';
import { Skill } from './knowledge.js';

/**
 * Wire types owned by the `skills` module.
 *
 * `Skill` itself (the stored entity) lives in `knowledge.ts` alongside the other
 * knowledge-layer contracts. These are the *API* shapes layered on top of it —
 * new wire type → new file, never edit another module's contract.
 */

/**
 * A skill plus how many agents link it. Powers the list card's meta row and the
 * "this will be unlinked from N agents" line in the delete confirmation.
 *
 * `used_by` counts LINKS, not enabled links — a linked-but-disabled skill still
 * shows up here, because unlinking it is still a change the user is making.
 */
export const SkillListItem = Skill.extend({ used_by: z.number().int() });
export type SkillListItem = z.infer<typeof SkillListItem>;

/**
 * An immutable snapshot of a skill body, written every time the body changes
 * (and only the body — renaming or toggling `enabled` does not create one).
 * Keyed by the composite `(skill_id, version)` primary key.
 */
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  /**
   * Optional audit note: an author's save message, or the server-authored
   * `Restored from vN` line. `.nullable()` and NOT `.nullish()` on purpose —
   * the route declares `response: { 200: z.array(SkillVersion) }` as its DTO
   * gate, so a required-but-nullable field is always on the wire and the client
   * never has to tell `undefined` from `null` for one meaning.
   */
  message: z.string().nullable(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

/**
 * Body of `POST /skills/:id/restore` — write an OLD version's text forward as a
 * new one.
 *
 * The client sends a version NUMBER, never a body. `skill_versions` rows are
 * append-only (nothing in the repository ever UPDATEs one), so a version number
 * is a permanently stable handle on immutable text: a stale version cache can
 * never cause a wrong write, only a failure to list a newer version. That is
 * what lets this endpoint carry no `If-Match` and no precondition.
 */
export const SkillRestoreRequest = z.object({
  version: z.number().int().positive(),
});
export type SkillRestoreRequest = z.infer<typeof SkillRestoreRequest>;
