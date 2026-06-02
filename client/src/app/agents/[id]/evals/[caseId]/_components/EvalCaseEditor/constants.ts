/** Constants for the Eval Case Editor. */

/** Sentinel caseId meaning "create a new case". */
export const NEW_CASE = "new";

/** Input tab keys. */
export const TABS = ["Diff", "PR meta"] as const;
export type EditorTab = (typeof TABS)[number];

/** Fallback name used when the user hasn't typed one. */
export const UNTITLED_CASE = "untitled-case";
