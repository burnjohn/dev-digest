import type { IconName } from "@devdigest/ui";
import type { RiskBriefLevel, RiskBriefSources } from "@devdigest/shared";

/** SPEC-02 "Design review — Gaps": no high/medium/low colour scale exists yet —
    the shipped `SEV` map (`vendor/ui/primitives/tokens.ts:6-14`) is
    CRITICAL/WARNING/SUGGESTION/INFO, a different scale with a different
    cardinality. This is a NEW three-level map, deliberately NOT an alias of
    `SEV` — aliasing `high -> CRITICAL` would tie this card to a scale that
    changes for reasons that have nothing to do with a PR's risk level.

    Drives BOTH the risk-level badge and every risk row's severity icon, so
    the whole card never shows more than these three glyphs (REQ-46). */
export const RISK: Record<RiskBriefLevel, { c: string; bg: string; icon: IconName }> = {
  low: { c: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
  medium: { c: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  high: { c: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon" },
};

/** The five SCALAR `sources` fields (AC-32) — `md_files` is deliberately
    excluded here, since it is an array with no status of its own (AC-40
    covers it separately). Order fixes the order names appear in the composed
    "Built without …" sentence: contract-declaration order, so `md_files`'s
    "documentation" (appended separately in helpers.ts) always reads last. */
export const SCALAR_SOURCE_KEYS = [
  "intent",
  "blast",
  "pr_body",
  "linked_issue",
  "file_list",
] as const satisfies readonly (keyof Omit<RiskBriefSources, "md_files">)[];
