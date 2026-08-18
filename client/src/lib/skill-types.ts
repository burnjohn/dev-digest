import type { SkillType } from "@devdigest/shared";

/**
 * The selectable skill types, in display order.
 *
 * Client-local mirror of the `SkillType` Zod enum, for the same reason
 * `lib/feature-models.ts` mirrors `FEATURE_MODELS`: the client can only import
 * TYPES from the vendored shared package — importing a runtime VALUE (here,
 * `SkillType.options`) pulls `vendor/shared/index.ts` into the webpack bundle,
 * whose `./contracts/*.js` re-exports Next's webpack can't resolve. The `SkillType`
 * annotation is what makes a drift from the contract a compile error.
 *
 * Lives in `lib/` rather than beside the skills list because the conventions route
 * also offers this select, and a route may not import from another route.
 */
export const SKILL_TYPES: SkillType[] = ["rubric", "convention", "security", "custom"];
