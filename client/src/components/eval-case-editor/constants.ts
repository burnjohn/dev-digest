import type { EvalExpectedFinding } from "@devdigest/shared";
import type { InputTabConfig } from "./types";

/** Two-column layout per mockup 6 needs more room than the default 720. */
export const MODAL_WIDTH = 960;

/** The skill arm authors a Before AND an After editor side by side with a JSON
 * pane, which does not fit the agent arm's 960. Deliberately a SECOND constant
 * rather than a bump to `MODAL_WIDTH`: the agent modal must not change. */
export const SKILL_MODAL_WIDTH = 1080;

/** The empty-array text the "Expected output" textarea starts at for a blank
 * new case. `[]` (not `""`) so the badge reads "valid JSON" from the first
 * paint, and so `deriveExpectationKind` sees an unambiguous empty case. */
export const EMPTY_EXPECTED_OUTPUT_TEXT = "[]";

/** One blank finding, inserted by the "Finding skeleton" button. Every field the
 * contract requires is present (including `end_line`, which the mockup's
 * cropped screenshot omits but `EvalExpectedFinding` does not make optional)
 * so the appended JSON always round-trips through `safeParseExpectedOutput`. */
export const FINDING_SKELETON: EvalExpectedFinding = {
  severity: "WARNING",
  category: "bug",
  title: "",
  file: "",
  start_line: 1,
  end_line: 1,
};

/** Agent-owned cases (the only arm wired this wave): Diff is the sole live
 * input; Files/PR meta are disabled with an accessible reason (REQ-53/54).
 * `files` carries no reason key — none is seeded in `eval.json` and REQ-54
 * only requires one for `pr_meta`. */
export const AGENT_INPUT_TABS: InputTabConfig[] = [
  { key: "diff", labelKey: "tabs.diff", disabled: false },
  { key: "files", labelKey: "tabs.files", disabled: true },
  { key: "pr_meta", labelKey: "tabs.prMeta", disabled: true, disabledReasonKey: "tabs.prMetaDisabledReason" },
];
