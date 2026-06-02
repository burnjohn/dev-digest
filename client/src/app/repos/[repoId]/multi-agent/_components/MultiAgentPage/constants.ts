/** Constants for the Multi-Agent Review page (route entry). */

/** The two body layouts the run can be shown in. */
export const VIEWS = ["columns", "tabs"] as const;
export type ViewMode = (typeof VIEWS)[number];

/** Search-param keys this page deep-links. */
export const PARAM = {
  pr: "pr",
  view: "view",
  agent: "agent",
  conflicts: "conflicts",
  trace: "trace",
} as const;

/** The "on" value for boolean-ish params. */
export const CONFLICTS_ON = "1";
