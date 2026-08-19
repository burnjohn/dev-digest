import type { SmartDiffRole } from "@devdigest/shared";

/** Fixed group order — core is the substance of the change, so it always
 *  renders first; boilerplate is the least likely to need review, last. */
export const SMART_DIFF_GROUP_ORDER: readonly SmartDiffRole[] = ["core", "wiring", "boilerplate"];

/** Groups collapsed on first render. Only boilerplate: core/wiring are what a
 *  reviewer opens the tab to look at. */
export const DEFAULT_COLLAPSED_ROLES: ReadonlySet<SmartDiffRole> = new Set(["boilerplate"]);
